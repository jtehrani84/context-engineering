# /context-load

Cross-project context restore. Loads relevant state from another project into the current session.

## Trigger
When the user says: "context load", "load context from [project]", "switch context", "bring in [project] context", "what was I doing on [project]?"

## Workflow

### 1. Identify the source project
- Check `~/.claude/projects/` for available project memory directories
- If ambiguous, list available projects and ask which one

### 2. Load relevant context
From the source project's memory:
- Read MEMORY.md (index of all topic files)
- Identify the 3-5 most recently modified memory files
- Scan for active decisions, open questions, and blockers

### 3. Surface the state

```
## Context Load: [Project Name]

### Last Session
- Date: [last modified date of memory files]
- Focus: [what was being worked on]
- Status: [where things left off]

### Active Decisions
- [Decision 1 from memory]
- [Decision 2 from memory]

### Key Context (carry forward)
- [Important fact/constraint from memory]
- [Important fact/constraint from memory]
- [Important fact/constraint from memory]

### Open Questions
- [Anything unresolved]

### Suggested First Action
[What to do to pick up where you left off]
```

### 4. Offer to set routing
"Should I add this project to your session-init routing table so this context loads automatically when you work in that directory?"

## Rules
- Only load the most relevant 3-5 items — don't dump the entire memory
- Focus on decisions and state, not history
- If the project has been dormant for 30+ days, mention that (context may be stale)
- Don't modify the source project's memory — read only
- Suggest updating stale items if they look outdated
