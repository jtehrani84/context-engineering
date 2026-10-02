# /weekly-report

Status report generator. Summarizes what happened this week from git history, memory files, and session activity.

## Trigger
When the user says: "weekly report", "what did I ship this week?", "status report", "weekly summary", "what happened this week?"

## Workflow

### 1. Gather data from 4 sources

**Git log (last 7 days):**
```bash
git log --since="7 days ago" --oneline --all
```
Count: commits, files changed, lines added/removed.

**Memory files created/modified (last 7 days):**
```bash
find ~/.claude/ -name "*.md" -mtime -7 -type f
```
List new memory files (corrections, decisions, feedback captured).

**Wiki pages touched:**
```bash
find [project-wiki-dir] -name "*.md" -mtime -7 -type f
```

**Skills or hooks modified:**
```bash
find ~/.claude/commands/ ~/.claude/hooks/ -mtime -7 -type f
```

### 2. Categorize activity

Group everything into:
- **Shipped:** Completed work (merged PRs, deployed services, finished deliverables)
- **In Progress:** Active work (open branches, partial implementations)
- **Blocked:** Waiting on something external (approvals, access, dependencies)
- **System Growth:** New rules, skills, memory files, hooks added (the compound loop in action)

### 3. Produce the report

```
## Weekly Report: [date range]

### Shipped
- [Specific deliverable + outcome, not just "worked on X"]
- [Include metrics where possible: "deployed rev 00287, 375 tests passing"]

### In Progress
- [What's being built + % estimate + ETA]

### Blocked
- [What's waiting + who/what it's waiting on + suggested unblock]

### System Growth
- [New skills, rules, or hooks added]
- [Memory files captured: X new corrections/decisions]
- [Estimated time saved by automation: X minutes/week]

### Key Numbers
| Metric | This Week | Trend |
|--------|-----------|-------|
| Commits | [N] | [up/down/flat] |
| Memory files created | [N] | |
| Skills used | [list] | |
| Meetings prepped | [N] | |

### Next Week Focus
- [Top 3 priorities based on what's in progress + unblocked work]
```

## Rules
- Report facts, not aspirations. Only list what actually happened.
- "Shipped" means done-done. In someone's hands or deployed. Not "mostly finished."
- Keep the whole report under 300 words. Executives scan.
- If nothing shipped, say so honestly. Better than inflating progress.
- Include system growth — it shows the compounding investment paying off.
- One line per item. No paragraphs in a status report.
