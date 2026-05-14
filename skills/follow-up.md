# /follow-up

Post-interaction capture. After any meeting, conversation, or significant exchange — capture outcomes, action items, and draft the follow-up.

## Trigger
When the user says: "follow up", "post-meeting", "capture outcomes", "what happened in that meeting", "meeting notes for [X]"

## Workflow

### 1. Gather context
Ask (if not provided):
- Who was in the meeting/conversation?
- What was discussed? (key topics, decisions, surprises)
- What did you commit to?
- What did they commit to?
- What's the logical next step?

### 2. Structure the capture

```
## Meeting Capture: [Topic/Company/Person]
**Date:** [today]
**Attendees:** [names]

### Key Outcomes
- [Decision #1]
- [Decision #2]
- [Key insight or surprise]

### Action Items
| # | Action | Owner | Due |
|---|--------|-------|-----|
| 1 | [specific task] | [name] | [date] |
| 2 | [specific task] | [name] | [date] |
| 3 | [specific task] | [name] | [date] |

### Open Questions
- [Anything unresolved that needs follow-up]

### Memory Notes
[Anything worth remembering for next time — preferences, politics, sensitivities]
```

### 3. Draft the follow-up email

Using /draft rules (under 150 words):
- Reference ONE specific moment from the conversation
- Confirm action items with owners and dates
- Propose next meeting with a specific date
- Start with substance, not "great meeting today"

### 4. Save context

Offer to save relevant information:
- Update wiki/people/ pages with new context
- Save a memory file if a decision or preference was revealed
- Update project wiki if relevant to an active project

## Rules
- Send follow-ups within 2 hours of the meeting (note this in the output)
- Never fabricate action items — if unclear, mark as "[CONFIRM]"
- Keep the email follow-up under 150 words
- Always propose a specific next meeting date (not "let's reconnect sometime")
- If attendees included people you don't have wiki pages for, suggest creating them
