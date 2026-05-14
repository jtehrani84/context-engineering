# /design-doc

Architecture or system design document. Produces a structured design proposal for any technical system or complex project.

## Trigger
When the user says: "design doc", "architecture for [X]", "system design", "how should I architect [X]", "design document for [X]"

## Workflow

### 1. Understand the problem
Ask (if not clear):
- What system or feature are you designing?
- What problem does it solve? (user pain, business need, technical debt)
- What are the hard constraints? (performance, scale, cost, team size)
- What exists today? (current state, what you're building on)
- Who needs to approve this?

### 2. Produce the design document

```
## Design Document: [System/Feature Name]
**Author:** [name]
**Date:** [today]
**Status:** Draft / Review / Approved

### Problem Statement
[2-3 sentences: what's broken, missing, or needed. Why now?]

### Goals
- [Primary goal — the must-have]
- [Secondary goal — nice to have]
- [Non-goal — explicitly out of scope]

### Current State
[Brief description of what exists today and its limitations]

### Proposed Design

#### Overview
[High-level description of the solution — 3-5 sentences]

#### Architecture
[Key components and how they interact]
- Component A: [responsibility]
- Component B: [responsibility]
- Data flow: A -> B -> C

#### Key Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| [decision point] | [what we chose] | [why] |
| [decision point] | [what we chose] | [why] |

### Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| [option] | [benefits] | [drawbacks] | [reason rejected] |
| [option] | [benefits] | [drawbacks] | [reason rejected] |

### Risks & Mitigations
- **Risk:** [what could go wrong]
  **Mitigation:** [how to handle it]
- **Risk:** [what could go wrong]
  **Mitigation:** [how to handle it]

### Implementation Plan
1. [Phase 1: scope and timeline]
2. [Phase 2: scope and timeline]
3. [Phase 3: scope and timeline]

### Success Metrics
- [How you'll know this worked — measurable]
- [Second metric]

### Open Questions
- [Things still undecided that need input]
```

## Rules
- Always include "Alternatives Considered" — shows you thought broadly before narrowing
- "Non-goals" are as important as goals — prevent scope creep
- Key Decisions table is the most valuable artifact (prevents re-litigating)
- If you don't know the answer to something, put it in "Open Questions" — don't guess
- Keep diagrams text-based (ASCII or mermaid) unless explicitly asked for images
- Total output: 400-800 words depending on complexity
