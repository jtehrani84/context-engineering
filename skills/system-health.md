# /system-health

System diagnostics. Checks that hooks are firing, rules are loading, graph is growing, and the whole context architecture is working.

## Trigger
When the user says: "system health", "diagnostics", "is everything working?", "check my setup", "debug hooks"

## Workflow

### 1. Check rules

```bash
ls -la ~/.claude/rules/
```
- Are rule files present?
- Are they non-empty?
- Any syntax issues? (check for valid markdown headers)

### 2. Check hooks

```bash
ls -la ~/.claude/hooks/scripts/
```
- Are hook scripts present and executable?
- Do they have valid Python syntax? (`python3 -c "import ast; ast.parse(open('file').read())"`)
- Are they referenced in settings.json?

### 3. Check settings

```bash
cat ~/.claude/settings.json
```
- Are hooks registered under the correct lifecycle events?
- Are permissions configured?
- Are environment variables set?

### 4. Check knowledge graph

```python
import sqlite3
from pathlib import Path

db = Path.home() / ".claude" / "graph.sqlite"
if db.exists():
    conn = sqlite3.connect(str(db))
    nodes = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    edges = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    # Report counts
```

### 5. Check wiki structure

```bash
find ~/.claude/wiki -type f -name "*.md" | wc -l
cat ~/.claude/wiki/index.md | head -5
```

### 6. Check memory

```bash
find ~/.claude -path "*/memory/*.md" -type f | wc -l
```

### 7. Produce the report

```
## System Health: [date]

### Rules [PASS/WARN/FAIL]
- Files: [N] found in ~/.claude/rules/
- Loading: [all valid / issues found]
- Issues: [if any]

### Hooks [PASS/WARN/FAIL]
- Scripts: [N] found in ~/.claude/hooks/scripts/
- Executable: [all/some/none]
- Registered in settings: [yes/no/partial]
- Issues: [if any]

### Settings [PASS/WARN/FAIL]
- File exists: [yes/no]
- Hooks configured: [N lifecycle events]
- Permissions: [N allow / N deny rules]
- Issues: [if any]

### Knowledge Graph [PASS/WARN/FAIL]
- Database: [exists/missing]
- Nodes: [N]
- Edges: [N]
- Last updated: [date]
- Growth: [healthy/stagnant/not started]

### Wiki [PASS/WARN/FAIL]
- Pages: [N]
- Index: [exists/missing]
- Inbox: [N items pending]

### Memory [PASS/WARN/FAIL]
- Files: [N]
- Last modified: [date]

### Overall: [HEALTHY / NEEDS ATTENTION / BROKEN]

### Suggested Fixes
1. [Specific fix if anything is wrong]
```

## Rules
- This is a diagnostic tool — report facts, don't make changes
- If something is broken, provide the exact command to fix it
- "WARN" means working but suboptimal. "FAIL" means not functioning.
- A system with 0 memory files is not broken — it's new. Note it as "building."
- Don't flag empty wiki directories as failures — they fill over time
