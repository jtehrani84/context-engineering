# /wiki-lint

Wiki health check. Finds broken links, orphaned pages, stale content, and structural issues.

## Trigger
When the user says: "wiki lint", "check the wiki", "wiki health", "broken links?", "wiki maintenance"

## Workflow

### 1. Structural check
- Does wiki/index.md exist and list all pages?
- Are all directories populated (people, entities, concepts, projects, tools, events, insights)?
- Are template files present in wiki/people/?

### 2. Link validation
For every wiki page:
- Extract all internal links (relative paths)
- Verify each target exists
- Report dead links with source -> broken target

### 3. Orphan detection
- Pages that exist but aren't linked from index.md
- Pages that exist but aren't linked from any other page
- People pages never referenced in memory or other wiki pages

### 4. Content quality
- Pages with no content beyond the template structure
- Pages not modified in 90+ days (potentially stale)
- Duplicate content (same entity described in two places)

### 5. Report

```
## Wiki Health Report: [date]

### Structure: [PASS/FAIL]
- Index: [exists/missing]
- Directories: [all present / missing: X]
- Templates: [present/missing]

### Links: [N broken / N total]
| Source | Broken Link |
|--------|-------------|
| [page] | [target that doesn't exist] |

### Orphans: [N found]
- [page not linked from anywhere]

### Stale Pages: [N pages >90 days]
- [page] — last modified [date]

### Empty Pages: [N]
- [page with only template content]

### Suggested Actions
1. [Fix broken link: source -> correct target]
2. [Link orphan from index.md]
3. [Review/update stale page]
```

## Rules
- Run after any bulk wiki update (post /ingest, post /curate)
- Don't auto-delete orphans — they might be intentionally standalone
- Stale doesn't mean wrong — some reference pages don't change often
- Always suggest the fix, don't just report the problem
- Keep report concise — focus on actionable issues only
