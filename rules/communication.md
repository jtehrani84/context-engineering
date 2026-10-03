# Communication & Professional Writing Rules

## Voice & Anti-Slop

All content must sound like a real professional wrote it. AI-sounding output is a dealbreaker.

### Drafts Go Through the Voice Check First
- Anything the user might send (a chat message, an email, a post, a comment) is written first to a `drafts/` folder
  in the project, as `drafts/YYYY-MM-DD-<slug>.md`. The voice hook checks any file under `drafts/` at any length,
  so the draft is scored before the user sees it. Show it only after that check comes back clean, or after fixing
  what it flagged.
- When a draft has to appear in the chat, put it in a fenced block with the info string `draft` (` ```draft `). The
  draft gate checks only what is inside that fence when the reply ends, not the explanation around it.
- A hard-banned word or phrase in a draft means revise it before finishing. List softer tells under the draft for the
  user to decide. If the flagged text is the user's own words or a verbatim quote, say it was flagged; don't
  rephrase it silently.
- Drafts can hold private text, so keep `drafts/` out of git (add it to `.gitignore`).

### Banned Words (50+)
delve, leverage, ecosystem, unlock, empower, streamline, harness, holistic, robust, seamless, cutting-edge, utilize, facilitate, solutioning, ideation, learnings, synergy, paradigm, transformative, pivotal, groundbreaking, spearhead, foster, bolster, fortify, underpin, cornerstone, linchpin, bedrock, tapestry, multifaceted, nuanced, comprehensive, innovative, disruptive, game-changing, best-in-class, world-class, state-of-the-art, next-generation, mission-critical, end-to-end, full-stack, deep-dive, double-click, unpack, circle back, move the needle, low-hanging fruit, table stakes, north star

### Banned Phrases
- "In today's rapidly evolving..."
- "It's worth noting..."
- "well-positioned to"
- "uniquely positioned"
- "ushering in a new era"
- "actionable insights"
- "In an era of..."
- "at the forefront of"
- "As [Company] continues to..."

### Banned Structures
- Never start with "In today's..." / "As [Company]..."
- Never use "[X] is not just [Y] — it's [Z]"
- Never use "Furthermore/Moreover/Additionally" more than once total
- Never use three consecutive sentences starting with the same word

### 10 Writing Rules
1. Start specific (number, name, fact) — never a pleasantry
2. Mix sentence lengths (short punches between longer explanations)
3. Use contractions (it's, don't, we'll — sounds human)
4. Direct address ("you" not "one" or "users")
5. Take a stance (opinions > neutrality)
6. Vary paragraph openings (no pattern repetition)
7. Cut throat-clearing (delete the first sentence of most paragraphs)
8. One idea per sentence
9. Verbs over nouns ("we analyzed" not "an analysis was performed")
10. Name things specifically ("the Q4 pipeline review" not "the meeting")

## Email Drafting
- Under 200 words. Professionals scan, they don't read.
- Start with a specific fact, reference, or number — never a pleasantry.
- One specific ask per email with a suggested date/time.
- Match the recipient's seniority:
  - Executive: strategic, concise, bold claims with data
  - Manager: tactical, outcome-focused, specific timelines
  - Peer/Technical: precise details, honest about tradeoffs
- Sign off simply ("Best," or "Thanks,") with the name and title from your CLAUDE.md profile; never invent a sign-off

## Slack Messages
- Keep under 3 sentences for channel messages
- Use threads for detail
- Lead with the action or decision, not context
- Bold the key takeaway in longer messages
- Never post walls of text — use bullets or blocks

## Executive Summaries
- One page maximum (aim for half a page)
- Lead with the "so what" — the decision needed or insight discovered
- 3-bullet structure: situation, finding, recommendation
- Numbers over adjectives ("34M users" not "massive user base")
- End with a specific next step and owner
- For a half-page summary, skip headers and write flowing paragraphs

## Meeting Follow-Ups
- Send within 2 hours of the meeting
- Reference ONE specific moment from the conversation, which shows you were present
- Confirm action items with owners and dates
- Propose the next meeting with a specific date
- Keep under 150 words

## External vs Internal
- External (clients, partners, the public): lead with their world and their metrics. Keep your own product and team names to the minimum the reader needs.
- Internal: be candid. Name products, tradeoffs and open risks plainly.
- Never send an internal message externally or vice versa. Double-check the audience before drafting.

## Presentation Talking Points
- Speaker notes are delivery coaching, not a narration of the slide
- Bad: "This slide presents the order-volume bottleneck..."
- Good: "Pause after the number. Let them react. The goal is to make the tension land."
- Include pivot points ("If they push back on X, go to slide Y") and the transition phrase into the next slide

## Banned Email Patterns
- "I hope this finds you well" — start with substance
- "Per our conversation" — reference what was discussed
- "Please don't hesitate to reach out" — give a specific next step
- "As discussed" without specifics — say what was discussed
- "Best regards" / "Warm regards" — just "Best," or "Thanks,"
- "Circling back" — state the update
- "Wanted to touch base" — state the purpose
- "Take offline" — say when and how
