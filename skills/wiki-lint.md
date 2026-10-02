Health-check the wiki. Find issues and fix them.

## Checks to Run

Read every file in `~/[YOUR-PROJECT]/wiki/` and analyze:

### 1. Orphan Pages
Pages with NO inbound links from other wiki pages. Every page should be reachable from at least one other page.

### 2. Dead Links
Links that point to pages that don't exist. Either the target was never created or was renamed.

### 3. Contradictions
Facts stated differently on different pages. Flag with specific file paths and line numbers.

### 4. Stale Information
Pages that reference dates, versions, or statuses that may be outdated. Cross-reference with:
- Current git state
- Memory files in `~/.claude/projects/[YOUR-PROJECT-PATH]/memory/`
- Actual file system state

### 5. Missing Pages
Concepts, tools, or entities mentioned repeatedly across wiki pages but with no dedicated page.

### 6. Thin Pages
Pages with less than 5 lines of content. These should either be expanded or merged into a parent page.

### 7. Index Completeness
Compare `wiki/index.md` entries against actual files in the wiki directories. Flag:
- Files that exist but aren't in the index
- Index entries that point to files that don't exist

### 8. Cross-Reference Density
Pages in `wiki/concepts/` and `wiki/projects/` should have at least 2 outbound links. Isolated pages aren't contributing to the knowledge graph.

## Report Format

Write the report to `wiki/lint-report.md`:

```markdown
# Wiki Lint Report — YYYY-MM-DD

## Summary
- Total pages: N
- Orphan pages: N
- Dead links: N  
- Contradictions: N
- Stale entries: N
- Missing pages: N
- Thin pages: N
- Index gaps: N

## Health Score: X/10

## Issues Found

### Critical (fix now)
...

### Warning (fix soon)
...

### Info (nice to have)
...

## Suggested Actions
1. ...
```

After writing the report, offer to fix the issues automatically.

## Write Nudge Timestamp

```bash
echo "YYYY-MM-DDTHH:MM:SS" > ~/.claude/projects/[YOUR-PROJECT-PATH]/memory/.last-wiki-lint
```

## Append to Log
```
## [YYYY-MM-DD] lint | Wiki health check
- Health score: X/10
- Issues found: N (N critical, N warning, N info)
- Auto-fixed: N
```
