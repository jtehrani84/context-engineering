# /weekly-report

Status report from git history, memory files, and session activity. Produces a structured summary of what was accomplished.

## Trigger
When the user says: "weekly report", "status report", "what did I do this week?", "week in review"

## Workflow

### 1. Gather data

```bash
# Git activity
git log --since="1 week ago" --oneline --stat

# Memory file changes
find ~/.claude -name "*.md" -newer /tmp/weekago -type f 2>/dev/null | head -20

# Wiki changes
find wiki/ -name "*.md" -newer /tmp/weekago -type f 2>/dev/null | head -20
```

### 2. Categorize work

Group commits and changes into categories:
- **Features/Deliverables** — new things built or shipped
- **Improvements** — enhancements to existing work
- **Fixes** — bugs resolved, issues addressed
- **Research/Learning** — new knowledge acquired
- **Process** — workflow improvements, automation added

### 3. Produce the report

```
## Weekly Report: [date range]

### Summary
[2-3 sentences: what was the main thrust of this week's work?]

### Key Deliverables
- [Deliverable 1] — [impact/outcome]
- [Deliverable 2] — [impact/outcome]
- [Deliverable 3] — [impact/outcome]

### Activity Breakdown
| Category | Items | Highlights |
|----------|-------|-----------|
| Features | [N] | [key item] |
| Improvements | [N] | [key item] |
| Fixes | [N] | [key item] |
| Research | [N] | [key item] |

### Metrics
- Commits: [N]
- Files changed: [N]
- Memory files created: [N]
- Wiki pages added/updated: [N]

### Blockers Resolved
- [What was blocking + how it was resolved]

### Carried to Next Week
- [Items not completed + why]

### Patterns Noticed
- [Any recurring themes, tools adopted, or decisions made]
```

## Rules
- Report facts, not feelings. Numbers and specifics over narrative.
- Group by impact (what shipped), not by time (what happened Monday)
- Keep under 300 words — a manager should scan this in 60 seconds
- If it was a light week, say so honestly
- Always include "carried to next week" for continuity
