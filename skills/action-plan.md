# /action-plan

Multi-step initiative planning. Takes any goal and produces a structured plan with stakeholders, phases, milestones, and risk mitigation.

## Trigger
When the user says: "action plan", "plan for [initiative]", "how do I execute [X]", "build a plan", "project plan for [X]"

## Workflow

### 1. Scope the initiative
Ask (if not clear):
- What's the goal? (specific outcome, not vague aspiration)
- What's the timeline? (hard deadline vs preferred)
- Who needs to be involved? (decision makers, contributors, blockers)
- What resources do you have? (budget, tools, people, access)
- What's already been tried or decided?

### 2. Build the plan

```
## Action Plan: [Initiative Name]

### Goal
[One sentence: specific, measurable outcome]

### Timeline
- Start: [date]
- Key checkpoint: [date + what should be true by then]
- Target completion: [date]

### Stakeholder Map
| Person/Role | Interest | Influence | Your Strategy |
|-------------|----------|-----------|---------------|
| [name] | [what they want] | [H/M/L] | [how to engage them] |
| [name] | [what they want] | [H/M/L] | [how to engage them] |

### Phases

**Phase 1: [Name]** — [timeline]
- [ ] [Specific deliverable]
- [ ] [Specific deliverable]
- Success criteria: [how you know this phase is done]

**Phase 2: [Name]** — [timeline]
- [ ] [Specific deliverable]
- [ ] [Specific deliverable]
- Success criteria: [how you know this phase is done]

**Phase 3: [Name]** — [timeline]
- [ ] [Specific deliverable]
- [ ] [Specific deliverable]
- Success criteria: [how you know this phase is done]

### Risks & Mitigations
| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| [what could go wrong] | [H/M/L] | [H/M/L] | [what to do about it] |
| [what could go wrong] | [H/M/L] | [H/M/L] | [what to do about it] |

### Dependencies
- [X] depends on [Y] completing first
- [External dependency: waiting on [who/what]]

### Next Action
**Today:** [the single thing to do right now to start momentum]
```

## Rules
- Every phase has explicit success criteria (not just tasks)
- Maximum 4 phases — if it's longer, break into sub-initiatives
- Always include a "Next Action" that can happen TODAY
- Stakeholder map is mandatory for multi-person initiatives
- Be honest about risks — don't pretend everything will go smoothly
- Timeline should be realistic, not aspirational
- Keep total output under 600 words
