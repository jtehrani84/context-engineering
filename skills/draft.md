# /draft

Professional content drafting with anti-slop enforcement and audience-appropriate tone. Produces emails, messages, proposals, and other written content.

## Trigger
When the user says: "draft an email", "write a message", "draft [content type]", "email to [person]", "write up [topic]"

## Workflow

### 1. Understand the context
Ask (if not clear):
- Who is the audience? (role, seniority, relationship)
- What's the purpose? (inform, request, propose, follow up)
- What's the one specific ask or outcome you want?
- Any context from a recent meeting or conversation?

### 2. Draft the content

Apply these rules:
- **Under 200 words** for emails (150 is better)
- **Start with substance** — first sentence is a fact, reference, or number
- **One ask per message** with a specific date/time when requesting action
- **Match seniority:**
  - Executive: strategic, concise, bold claims backed by data
  - Manager/Director: tactical, outcome-focused, specific timelines
  - Peer/Technical: precise, honest about tradeoffs, collaborative tone
- **Voice-check** against the full banned word list (50+ words)

### 3. Output format

```
---
**To:** [recipient]
**Subject:** [specific, not generic]
---

[Email body — under 200 words, starts with substance]

Best,
[Your name]
---

**Word count:** [N]
**Voice check:** [PASS/FAIL]
**Tone match:** [Executive/Manager/Peer]
```

### 4. If voice check fails
Automatically rewrite flagged sections and present the clean version.

## Rules
- First sentence must be specific (number, reference, fact)
- Never start with "I hope this finds you well" or any banned opener
- Sign off with "Best," or "Thanks," — nothing elaborate
- If replying to a thread, reference one specific point from the previous message
- End with a concrete next step (not "let me know if you have questions")
- Use contractions (it's, don't, we'll) — sounds human
- One paragraph per idea, max 3-4 short paragraphs
- If the email exceeds 200 words, cut it and explain what was removed
