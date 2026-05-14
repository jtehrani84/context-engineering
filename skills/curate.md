# /curate

Memory and knowledge base maintenance. Surfaces stale content, processes inbox, and keeps the system healthy.

## Trigger
When the user says: "curate", "clean up memory", "maintenance", "process inbox", "what's stale?"

## Workflow

### 1. Staleness scan

Check memory files for age:
```bash
find ~/.claude -path "*/memory/*.md" -type f -mtime +45
```

Files unchanged for 45+ days may be:
- Still accurate (mark as reviewed)
- Outdated (update or archive)
- Redundant (merged into a rule or wiki page)

Report: "[N] memory files older than 45 days. Review?"

### 2. Process inbox

Read `wiki/inbox.md`:
- Items from overnight crons
- Notes queued from previous sessions
- Intel digest items marked ADOPT NOW

For each inbox item:
- Route to appropriate wiki page (create or update)
- Update wiki/index.md if new pages created
- Remove processed items from inbox

### 3. Orphan detection

Check for:
- Wiki pages not linked from index.md
- Memory files not referenced in MEMORY.md
- People pages with no recent mentions
- Entity pages with no edges in the knowledge graph

### 4. Promotion check

Look for patterns in memory that should become rules:
- Same correction made 3+ times -> candidate for rules/ file
- Same pattern used in 3+ sessions -> candidate for /skillify
- Same context loaded manually -> candidate for session-init routing

### 5. Report

```
## Curation Report: [date]

### Inbox
- Processed: [N] items
- Routed to: [list of wiki pages updated]
- Remaining: [N] items (need human decision)

### Staleness
- Files >45 days: [N]
- Recommend review: [list top 3]
- Recommend archive: [list if obvious]

### Orphans
- Unlinked wiki pages: [list]
- Unreferenced memory: [list]

### Promotion Candidates
- [Pattern] -> suggested rule
- [Workflow] -> suggested /skillify

### Health Score
- Memory files: [N total]
- Wiki pages: [N total]
- Graph nodes: [N]
- Graph edges: [N]
- Inbox backlog: [N items]
```

## Rules
- Never delete memory files without explicit approval — archive instead
- Process inbox completely before doing staleness review
- Promotion suggestions are just that — ask before creating new rules
- Run this weekly (Sunday is ideal) for best results
- Keep the report under 200 words unless there are issues to resolve
