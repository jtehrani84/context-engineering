# /morning-brief

Daily intelligence briefing. Context load for the start of your day.

## Trigger
When the user says: "morning brief", "what's new?", "catch me up", "morning", "brief me", "what did I miss?"

## Workflow

### 1. Check overnight intelligence

**Wiki inbox (if exists):**
Read `wiki/inbox.md` — any items queued overnight by crons or previous sessions.

**Recent memory files:**
Check memory directory for files modified in the last 24 hours. These are corrections, decisions, or discoveries from yesterday that carry forward.

**Git status:**
```bash
git status --short
git log --since="yesterday" --oneline
```
What changed? Any uncommitted work from yesterday?

### 2. Check open work

**Uncommitted changes:** Files modified but not committed (leftover from yesterday's session).

**Active branches:** Any feature branches with pending work.

**Blocked items:** Anything noted as blocked in recent session files.

### 3. Check calendar context (if available)

If the user has mentioned today's schedule or if there's context:
- What's on the agenda today?
- What needs prep?
- Any deadlines hitting today?

### 4. Produce the briefing

```
## Morning Brief: [today's date]

### Overnight Intel
- [Items from wiki/inbox.md or cron outputs]
- [Or: "No overnight intelligence gathered. Consider enabling crons."]

### Yesterday's Context
- [What was worked on (from git log)]
- [Decisions made (from memory files)]
- [Anything left unfinished]

### Today's Focus
- [Top priority based on open work]
- [Second priority]
- [Prep needed for: [meetings/deadlines]]

### Unfinished Business
- [Uncommitted changes in: [files]]
- [Open branch: [branch-name] — [what it contains]]
- [Blocked: [item] — waiting on [what]]

### System Status
- Memory files: [total count]
- Wiki pages: [total count]
- Last cron run: [timestamp or "not configured"]
```

### 5. Offer next actions

Based on the brief, suggest:
- "Run /research-prep [topic] for your meeting?"
- "Commit yesterday's changes?"
- "Process inbox items into wiki pages?"

## Rules
- Keep the brief under 200 words. This is a scan, not a read.
- Lead with what's actionable, not what's informational.
- If there's nothing overnight (no crons, no inbox), say so in one line and move on.
- Don't fabricate urgency. If it's a quiet morning, say "clear deck today."
- Always end with a concrete suggested action.
