# /system-health

Audit the health of your Claude Code persistent context architecture. Reports across all layers.

## Trigger
When the user says: "system health", "audit my setup", "system check", "how healthy is my claude"

## Workflow

Run these checks and report a scorecard:

### 1. Memory Health
- Count total memory files in project memory directory
- Check MEMORY.md line count (warn if over 200)
- Find memory files not modified in 30+ days (candidates for archive)
- Find memory files with no backlinks from MEMORY.md index (orphans)

### 2. Wiki Health
- Count total wiki pages
- Check wiki/index.md for dead links (pages referenced but missing)
- Check for orphan pages (exist but not in index)
- Check wiki/inbox.md for pending items

### 3. Rules Health
- Count rules in ~/.claude/rules/
- Grep for contradictions (same file path in multiple rules with different guidance)
- Check rules files modification dates (stale = unchanged in 60+ days)

### 4. Hooks Health
- Count scripts in ~/.claude/hooks/scripts/
- Verify each .py file is syntactically valid (python3 -c "import ast; ast.parse(open('file').read())")
- Check if hooks are wired in settings.json
- Report any hooks that exist as files but aren't configured

### 5. Skills Health
- Count skills in ~/.claude/skills/ and ~/.claude/commands/
- Identify skills with 0 invocations (if usage tracking exists)
- Check for skill files with syntax errors

### 6. MCP Health
- List configured servers from .mcp.json and settings.json
- Report total tool count
- Flag any servers that haven't been called this session

### 7. Graph Health (if graph exists)
- Count nodes and edges
- Find orphaned entities (nodes with no edges)
- Find entities pointing to deleted files
- Report last indexing timestamp

### 8. Context Overflow
- Check if context-mode plugin is installed
- Report FTS5 database size if exists

### 9. Crons Health (if crons exist)
- Check launchd job status (launchctl list | grep claude)
- Report last successful run timestamps from logs
- Flag any jobs with non-zero exit codes

### 10. Overall Score
Compute a 0-10 health score:
- 10: Everything clean, no orphans, no stale items, all systems green
- 7-9: Minor staleness or a few orphans
- 4-6: Significant maintenance needed
- 0-3: System degraded, major gaps

## Output Format

```
## System Health Report — [Date]
**Score: [X]/10**

| Layer | Status | Items | Issues |
|-------|--------|-------|--------|
| Memory | [OK/WARN] | [count] | [orphans, stale] |
| Wiki | [OK/WARN] | [count] | [dead links, inbox pending] |
| Rules | [OK] | [count] | [none] |
| Hooks | [OK/WARN] | [count] | [unwired, syntax errors] |
| Skills | [OK] | [count] | [unused] |
| MCP | [OK] | [count] servers, [count] tools | [unreachable] |
| Graph | [OK/WARN] | [nodes]/[edges] | [orphaned entities] |
| Overflow | [OK] | [size] | [none] |
| Crons | [OK/WARN] | [count] jobs | [failed runs] |

### Action Items
1. [Most urgent fix]
2. [Second priority]
3. [Third priority]
```

## Visual Report
After collecting all data, generate a visual HTML dashboard:
1. Read the template at `~/context-engineering/templates/reports/system-health.html`
2. Replace all `{{PLACEHOLDER}}` tokens with actual values
3. Write the populated HTML to `/tmp/system-health-report.html`
4. Run `open /tmp/system-health-report.html` to display in browser

## Rules
- Run non-destructively — read only, never modify
- Report facts, not opinions
- If a layer doesn't exist (no graph, no crons), report "Not configured" not "Broken"
- Under 300 words for terminal output (full detail goes to HTML report)
