# /week-plan

Weekly planning. Reviews current state, priorities, and produces a focused plan for the week ahead.

## Trigger
When the user says: "week plan", "plan the week", "weekly planning", "what should I focus on this week?"

## Workflow

### 1. Gather context

**Active projects:**
- Check wiki/projects/ for current status
- Check git branches for in-progress work
- Check memory for open action items

**Recent activity:**
```bash
git log --since="1 week ago" --oneline
```

**Open items:**
- Unfinished work from last week
- Items in wiki/inbox.md not yet processed
- Deadlines approaching (check memory files)

### 2. Produce the plan

```
## Week Plan: [date range]

### Last Week Recap
- Completed: [list key achievements]
- Carried over: [anything not finished]
- Learned: [notable decisions or discoveries]

### This Week's Priorities

**Priority 1: [Most important thing]**
- Why now: [urgency/importance]
- Done when: [specific criteria]
- Time needed: [estimate]

**Priority 2: [Second priority]**
- Why now: [urgency/importance]
- Done when: [specific criteria]
- Time needed: [estimate]

**Priority 3: [Third priority]**
- Why now: [urgency/importance]
- Done when: [specific criteria]
- Time needed: [estimate]

### Meetings & Prep Needed
- [Day]: [meeting] — prep with /research-prep
- [Day]: [meeting] — prep with /research-prep

### Blocked / Waiting
- [Item]: waiting on [who/what] since [date]

### Week's Theme
[One sentence: what's the overarching focus this week?]
```

## Rules
- Maximum 3 priorities. More than 3 means nothing is prioritized.
- Each priority has a "done when" — no vague goals
- Include a "last week recap" to maintain continuity
- If something has been "carried over" for 3+ weeks, flag it for decision (do it or drop it)
- Keep the plan under 300 words — this is a compass, not a novel
- End with a theme that gives the week coherence
