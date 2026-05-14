# /graph-query

Query the knowledge graph. Find relationships, connections, and related files across your wiki and memory.

## Trigger
When the user says: "graph query", "what's related to [X]?", "connections for [X]", "who mentions [X]?", "knowledge graph", "what do I know about [X]?"

## Workflow

### 1. Identify the query
- Entity name (person, company, concept)
- Relationship type (REFERENCES, RELATES_TO)
- Or: general exploration ("show me the graph")

### 2. Query the SQLite graph

```python
import sqlite3
from pathlib import Path

# Find the graph database
graph_path = Path.home() / ".claude" / "graph.sqlite"
# Or check project memory: ~/.claude/projects/*/memory/graph.sqlite

conn = sqlite3.connect(str(graph_path))

# Find a node
cursor = conn.execute(
    "SELECT id, node_type, name, file_path FROM nodes WHERE name LIKE ?",
    (f"%{query}%",)
)

# Find edges from/to a node
cursor = conn.execute("""
    SELECT n2.name, n2.node_type, e.edge_type, e.confidence
    FROM edges e
    JOIN nodes n2 ON e.target_id = n2.id
    WHERE e.source_id = ?
""", (node_id,))
```

### 3. Present results

```
## Graph Query: [search term]

### Direct Matches
- [Node name] ([type]) — [file path]

### References (this entity is mentioned in)
| File | Type | Confidence |
|------|------|-----------|
| [file] | [memory/wiki/rule] | [0-1.0] |

### Related Files (share 3+ entities)
| File | Shared Entities | Confidence |
|------|----------------|-----------|
| [file] | [N] | [0-1.0] |

### Entity Network
[Entity] connects to:
- [Related entity 1] (via [N] shared files)
- [Related entity 2] (via [N] shared files)

### Graph Stats
- Total nodes: [N]
- Total edges: [N]
- Node types: [breakdown]
```

### 4. Suggest actions
- "Read [related file] for more context?"
- "This connects to [entity] — want me to pull that wiki page?"
- "3 memory files mention this — review them?"

## Rules
- If the graph database doesn't exist yet, explain that it builds automatically from Write/Edit operations
- Fuzzy match on names (partial matches are fine)
- Sort results by confidence (strongest connections first)
- Maximum 10 results per category to keep output scannable
- If no results found, suggest: "Try a different spelling, or check if the entity has been mentioned in any wiki/memory files"
