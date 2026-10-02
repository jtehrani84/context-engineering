---
name: feedback-anti-slop-words
description: "Banned AI-sounding words in generated content. Applies to every email, deck, doc and summary Claude writes."
metadata:
  type: feedback
  last_verified: 2026-01-15
---

# Anti-Slop: Banned Words in Generated Content

Source: user correction during email drafting.

## What Happened
User asked for a customer follow-up email. Output contained 8 AI-sounding words
in a single paragraph: leverage, ecosystem, unlock, empower, seamless, robust,
cutting-edge, streamline.

## User's Correction
"Never use those words. They sound like AI wrote it. No leverage, ecosystem,
unlock, empower, seamless, robust, cutting-edge, streamline, utilize, harness,
holistic, delve, or any word that makes you sound like a marketing bot."

## Rule
All generated content must sound like a real human wrote it. The following words
are permanently banned from any output (emails, decks, docs, code comments):

### Banned Words
delve, leverage, ecosystem, unlock, empower, streamline, harness, holistic,
robust, seamless, cutting-edge, utilize, facilitate, solutioning, ideation,
learnings, synergy, paradigm, transformative, pivotal, groundbreaking,
spearhead, foster, bolster, fortify, underpin, cornerstone, linchpin,
bedrock, tapestry, multifaceted, nuanced, comprehensive, innovative,
disruptive, game-changing, best-in-class, world-class, state-of-the-art,
next-generation, mission-critical

### Replacements
- leverage --> use, build on, apply
- ecosystem --> tools, community, network, [the specific thing]
- unlock --> enable, get, open up
- empower --> let, give the ability to, equip
- seamless --> smooth, simple, easy
- robust --> reliable, thorough, solid
- cutting-edge --> new, latest, modern
- streamline --> simplify, speed up, reduce steps

## Context
This applies to ALL content generation: customer emails, internal docs, slide
speaker notes, meeting summaries, chat messages. The test is: "Would a real
person say this out loud in a conversation?" If not, rewrite it.
