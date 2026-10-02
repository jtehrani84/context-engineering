# /graph-query

Query the local knowledge graph to discover relationships between files, people, entities, and concepts.

## Trigger
When the user says: "what relates to", "show me connections", "graph query", "what mentions [X]", "related files", "knowledge graph"

## How the Graph Works

The graph lives at `~/.claude/projects/[project]/memory/graph.sqlite`. It auto-populates from the `graph-auto-index.py` hook — every time you write or edit a wiki page, memory file, or entity page, the hook indexes it.

**Node types:** memory, wiki, person, entity, rule
**Edge types:** REFERENCES (file mentions entity), RELATES_TO (files share 3+ entities)

## Workflow

### 1. Determine Query Type

- **"What relates to [X]?"** → Find the node for X, traverse RELATES_TO edges
- **"What mentions [person/company]?"** → Find all REFERENCES edges pointing to that entity
- **"Show me the graph for [topic]"** → Full subgraph: node + all edges + neighbors
- **"What's connected to [file]?"** → Direct neighbors via any edge type

### 2. Execute Query

```python
import sqlite3
from pathlib import Path

# Find graph database
projects_dir = Path.home() / ".claude" / "projects"
graph_db = None
for d in projects_dir.iterdir():
    candidate = d / "memory" / "graph.sqlite"
    if candidate.exists():
        graph_db = candidate
        break

if not graph_db:
    print("No graph database found. The graph builds automatically as you work.")
    print("Write or edit wiki/memory/entity pages and the hook will index them.")
else:
    conn = sqlite3.connect(str(graph_db))
    # Example queries below
```

### 3. Common Queries

**Find all files that mention a person:**
```sql
SELECT n2.node_type, n2.name, n2.file_path
FROM edges e
JOIN nodes n1 ON e.target_id = n1.id
JOIN nodes n2 ON e.source_id = n2.id
WHERE n1.name LIKE '%[SEARCH_TERM]%'
AND e.edge_type = 'REFERENCES'
ORDER BY n2.updated_at DESC;
```

**Find related files (share entities):**
```sql
SELECT n2.name, n2.node_type, e.confidence,
       json_extract(e.properties, '$.shared_entity_count') as shared
FROM edges e
JOIN nodes n1 ON e.source_id = n1.id
JOIN nodes n2 ON e.target_id = n2.id
WHERE n1.name LIKE '%[FILE_NAME]%'
AND e.edge_type = 'RELATES_TO'
ORDER BY e.confidence DESC;
```

**Graph stats:**
```sql
SELECT node_type, COUNT(*) as count FROM nodes GROUP BY node_type;
SELECT edge_type, COUNT(*) as count FROM edges GROUP BY edge_type;
```

**Most connected entities (hubs):**
```sql
SELECT n.name, n.node_type, COUNT(e.id) as connections
FROM nodes n
JOIN edges e ON n.id = e.target_id
WHERE e.edge_type = 'REFERENCES'
GROUP BY n.id
ORDER BY connections DESC
LIMIT 20;
```

### 4. Output Format

```
## Knowledge Graph Query: [what was asked]

### Direct Matches
- [file/entity] — [type] — [path]

### Related (via shared entities)
- [file] relates to [file] — shared: [entity list] — confidence: [X]

### Graph Stats
- Nodes: [N] (memory: X, wiki: X, person: X, entity: X, rule: X)
- Edges: [N] (REFERENCES: X, RELATES_TO: X)
- Most connected: [top 3 entities]
```

## Rules
- If graph doesn't exist yet, explain that it builds automatically from work
- Show file paths so user can Read the related content
- For large results, summarize and offer to drill deeper
- The graph is read-only in this skill — the hook handles all writes
