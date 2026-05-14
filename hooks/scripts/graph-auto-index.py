#!/usr/bin/env python3
"""
Knowledge Graph Auto-Indexer — PostToolUse hook on Write|Edit

When any wiki, memory, or entity page is written/edited, this hook:
1. Upserts a node for the file in the local SQLite graph
2. Scans content for entity mentions (people, companies, concepts)
3. Creates REFERENCES edges between the file and mentioned entities
4. Computes RELATES_TO edges between files sharing 3+ entities

The graph grows automatically from your work. No manual maintenance.
Runs in <100ms for a single file.

Schema auto-creates on first run. No setup required beyond registering the hook.
"""

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

# Auto-detect project paths
HOME = Path.home()
CLAUDE_DIR = HOME / ".claude"

# Find the project memory directory (works with any project path)
def find_project_dir():
    projects_dir = CLAUDE_DIR / "projects"
    if not projects_dir.exists():
        return None
    for d in projects_dir.iterdir():
        if d.is_dir() and (d / "memory").exists():
            return d
    return None

PROJECT_DIR = find_project_dir()
GRAPH_DB = PROJECT_DIR / "memory" / "graph.sqlite" if PROJECT_DIR else CLAUDE_DIR / "graph.sqlite"
MEMORY_DIR = str(PROJECT_DIR / "memory") if PROJECT_DIR else ""

# Find wiki directory (check common locations)
WIKI_DIR = ""
for candidate in [Path.cwd() / "wiki", HOME / "wiki", CLAUDE_DIR / "wiki"]:
    if candidate.exists():
        WIKI_DIR = str(candidate)
        break
# Also check parent of cwd
if not WIKI_DIR:
    for p in Path.cwd().parents:
        if (p / "wiki").exists():
            WIKI_DIR = str(p / "wiki")
            break

RULES_DIR = str(CLAUDE_DIR / "rules")
PEOPLE_DIR = os.path.join(WIKI_DIR, "people") if WIKI_DIR else ""
ENTITIES_DIR = os.path.join(WIKI_DIR, "entities") if WIKI_DIR else ""


def ensure_schema(conn):
    """Create graph schema if it doesn't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_type TEXT NOT NULL,
            name TEXT NOT NULL,
            canonical_name TEXT NOT NULL,
            file_path TEXT,
            properties TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(node_type, canonical_name)
        );

        CREATE TABLE IF NOT EXISTS edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL,
            target_id INTEGER NOT NULL,
            edge_type TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            properties TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(source_id, target_id, edge_type),
            FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
        CREATE INDEX IF NOT EXISTS idx_nodes_canonical ON nodes(canonical_name);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
    """)


def read_stdin_safe():
    if sys.stdin.isatty():
        return {}
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def canonicalize(name: str) -> str:
    return re.sub(r"[^a-z0-9_'.]", "", name.lower().strip().replace(" ", "_").replace("-", "_"))


def matches_term(content: str, term: str) -> bool:
    if len(term) < 5:
        return bool(re.search(r"\b" + re.escape(term) + r"\b", content, re.IGNORECASE))
    return term.lower() in content


def classify_file(file_path: str) -> str | None:
    """Return node_type if the file belongs to a tracked directory."""
    if MEMORY_DIR and file_path.startswith(MEMORY_DIR) and file_path.endswith(".md"):
        if os.path.basename(file_path) == "MEMORY.md":
            return None
        return "memory"
    if WIKI_DIR and file_path.startswith(WIKI_DIR) and file_path.endswith(".md"):
        base = os.path.basename(file_path)
        if base in ("inbox.md", "log.md", "index.md"):
            return None
        if PEOPLE_DIR and file_path.startswith(PEOPLE_DIR):
            return "person"
        if ENTITIES_DIR and file_path.startswith(ENTITIES_DIR):
            return "entity"
        return "wiki"
    if file_path.startswith(RULES_DIR) and file_path.endswith(".md"):
        return "rule"
    return None


def update_file_in_graph(file_path: str, node_type: str):
    """Incrementally update a single file's node and REFERENCES edges."""
    os.makedirs(GRAPH_DB.parent, exist_ok=True)
    conn = sqlite3.connect(str(GRAPH_DB), timeout=3)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)

    try:
        basename = os.path.basename(file_path)
        if node_type == "wiki" and WIKI_DIR:
            rel = file_path.split("/wiki/")[1] if "/wiki/" in file_path else basename
            name = rel
        else:
            name = basename.replace(".md", "")
        cname = canonicalize(basename.replace(".md", ""))

        # Upsert the file node
        conn.execute(
            "INSERT INTO nodes (node_type, name, canonical_name, file_path, properties) "
            "VALUES (?, ?, ?, ?, '{}') "
            "ON CONFLICT(node_type, canonical_name) DO UPDATE SET "
            "file_path = excluded.file_path, updated_at = datetime('now')",
            (node_type, name, cname, file_path),
        )
        conn.commit()

        # Get the node ID
        row = conn.execute(
            "SELECT id FROM nodes WHERE node_type = ? AND canonical_name = ?", (node_type, cname)
        ).fetchone()
        if not row:
            conn.close()
            return
        file_node_id = row[0]

        # Load all entity/person search terms
        entity_rows = conn.execute(
            "SELECT id, name, canonical_name, properties FROM nodes "
            "WHERE node_type IN ('person', 'entity', 'company')"
        ).fetchall()

        search_terms: dict[int, list[str]] = {}
        for eid, ename, ecname, props in entity_rows:
            terms = [ename.lower()]
            terms.append(ecname.replace("_", " "))
            try:
                aliases = json.loads(props).get("aliases", [])
                for a in aliases:
                    if len(a) > 2:
                        terms.append(a.lower())
            except Exception:
                pass
            search_terms[eid] = list(set(terms))

        # Read file content
        try:
            content = Path(file_path).read_text().lower()
        except Exception:
            conn.close()
            return

        # Delete old REFERENCES edges FROM this file
        conn.execute(
            "DELETE FROM edges WHERE source_id = ? AND edge_type = 'REFERENCES'",
            (file_node_id,),
        )

        # Scan for entity mentions and create REFERENCES edges
        found_entities: set[int] = set()
        for eid, terms in search_terms.items():
            for t in terms:
                if len(t) < 3:
                    continue
                if matches_term(content, t):
                    conn.execute(
                        "INSERT OR IGNORE INTO edges (source_id, target_id, edge_type, confidence, properties) "
                        "VALUES (?, ?, 'REFERENCES', 1.0, '{}')",
                        (file_node_id, eid),
                    )
                    found_entities.add(eid)
                    break

        # Compute RELATES_TO edges (files sharing 3+ non-stop entities)
        conn.execute(
            "DELETE FROM edges WHERE edge_type = 'RELATES_TO' AND (source_id = ? OR target_id = ?)",
            (file_node_id, file_node_id),
        )

        if found_entities:
            total_files = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE file_path IS NOT NULL"
            ).fetchone()[0]
            freq_threshold = max(total_files * 0.25, 5)

            stop_entities: set[int] = set()
            freq_rows = conn.execute(
                "SELECT target_id, COUNT(*) as cnt FROM edges "
                "WHERE edge_type = 'REFERENCES' GROUP BY target_id HAVING cnt > ?",
                (freq_threshold,),
            ).fetchall()
            for eid, _ in freq_rows:
                stop_entities.add(eid)

            non_stop = found_entities - stop_entities
            if len(non_stop) >= 3:
                other_files = conn.execute(
                    "SELECT DISTINCT source_id FROM edges "
                    "WHERE edge_type = 'REFERENCES' AND source_id != ? "
                    "AND target_id IN ({})".format(",".join("?" * len(non_stop))),
                    (file_node_id, *non_stop),
                ).fetchall()

                for (other_id,) in other_files:
                    shared = conn.execute(
                        "SELECT COUNT(*) FROM edges e1 "
                        "JOIN edges e2 ON e1.target_id = e2.target_id "
                        "WHERE e1.source_id = ? AND e2.source_id = ? "
                        "AND e1.edge_type = 'REFERENCES' AND e2.edge_type = 'REFERENCES' "
                        "AND e1.target_id NOT IN ({})".format(
                            ",".join("?" * len(stop_entities)) if stop_entities else "-1"
                        ),
                        (file_node_id, other_id, *stop_entities) if stop_entities else (file_node_id, other_id),
                    ).fetchone()[0]

                    if shared >= 3:
                        confidence = min(shared / 5, 1.0)
                        conn.execute(
                            "INSERT OR IGNORE INTO edges (source_id, target_id, edge_type, confidence, properties) "
                            "VALUES (?, ?, 'RELATES_TO', ?, ?)",
                            (file_node_id, other_id, confidence, json.dumps({"shared_entity_count": shared})),
                        )

        conn.commit()

    except Exception:
        pass
    finally:
        conn.close()


def main():
    hook_input = read_stdin_safe()
    if not hook_input:
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    node_type = classify_file(file_path)
    if not node_type:
        sys.exit(0)

    if os.path.exists(file_path):
        update_file_in_graph(file_path, node_type)
    else:
        # File was deleted — clean up
        if GRAPH_DB.exists():
            try:
                conn = sqlite3.connect(str(GRAPH_DB), timeout=3)
                conn.execute("PRAGMA foreign_keys = ON")
                ensure_schema(conn)
                conn.execute("DELETE FROM nodes WHERE file_path = ?", (file_path,))
                conn.commit()
                conn.close()
            except Exception:
                pass

    sys.exit(0)


if __name__ == "__main__":
    main()
