# /voice-check

Anti-slop scanner. Finds and flags AI-sounding language in any content.

## Trigger
When the user says: "voice check", "slop check", "does this sound human?", "check the voice on this", "anti-slop scan"

## Workflow

### 1. Get the content
- If a file path is provided: read that file
- If text is pasted: scan that text
- If neither: scan the last generated output in this conversation

### 2. Scan against the full banned list

**Banned Words (50+):**
delve, leverage, ecosystem, unlock, empower, streamline, harness, holistic,
robust, seamless, cutting-edge, utilize, facilitate, solutioning, ideation,
learnings, synergy, paradigm, transformative, pivotal, groundbreaking,
spearhead, foster, bolster, fortify, underpin, cornerstone, linchpin,
bedrock, tapestry, multifaceted, nuanced, comprehensive, innovative,
disruptive, game-changing, best-in-class, world-class, state-of-the-art,
next-generation, mission-critical, end-to-end, full-stack, deep-dive,
double-click, unpack, circle back, move the needle, low-hanging fruit,
table stakes, north star

**Banned Phrases:**
- "In today's rapidly evolving..."
- "It's worth noting..."
- "well-positioned to"
- "uniquely positioned"
- "ushering in a new era"
- "actionable insights"
- "In an era of..."
- "at the forefront of"
- "As [Company] continues to..."
- "Furthermore/Moreover/Additionally" (more than once)

**Banned Structures:**
- Opening with "In today's..."
- Opening with "As [Company]..."
- The "[X] is not just [Y] -- it's [Z]" construction
- Three or more sentences starting with the same word
- Paragraphs that are all the same length (monotonous rhythm)

### 3. Report

```
## Voice Check: [PASS / FAIL]

**File:** [path or "inline content"]
**Word count:** [X]
**Violations found:** [N]

### Violations
| # | Word/Phrase | Line | Suggested Fix |
|---|------------|------|---------------|
| 1 | [match] | [N] | [replacement] |
| 2 | [match] | [N] | [replacement] |

### Structural Issues
- [Any banned structures found]

### Verdict
[PASS: 0 violations] or [FAIL: N violations — fix before sending]
```

### 4. Quick-fix offer
If FAIL, offer: "Want me to rewrite the flagged sections? I'll keep your meaning but fix the voice."

## Replacement Guide (use when fixing)
- leverage -> use, build on, apply
- ecosystem -> tools, community, [the specific thing]
- unlock -> enable, get, open up
- empower -> let, give [person] the ability to
- seamless -> smooth, simple, easy
- robust -> reliable, solid, thorough
- cutting-edge -> new, latest, modern
- streamline -> simplify, speed up, reduce steps
- holistic -> complete, full-picture, across [specific scope]
- utilize -> use
- facilitate -> help, run, enable
- comprehensive -> complete, full, thorough
- innovative -> new, different, [describe what's actually new]

## Rules
- Zero tolerance: even 1 banned word is a FAIL
- Context matters: "leverage" in a code comment about Git is fine; in professional content it's not
- Don't flag quoted text (someone else's words in quotes)
- Don't flag code variable names or technical terms
- The test: read it out loud. If you'd cringe saying it to a colleague, it fails.
