# /voice-judge — the gestalt read (Layer 5 of the voice system)

**Purpose:** read a passage the way a human expert who sees model output all day reads it — for the register tells no regex reaches — and, when it still reads as generated, **veto a clean deterministic score.** This is the layer that catches what `aiscore.mjs` can't.

**When to use:** on anything a customer, leader, or the public will read, *after* the deterministic engine passes. The rule the whole voice system runs on: **a text is CLEAN only if the engine AND this judge both pass.** A near-perfect `aiscore` means nothing on its own — this exists precisely because a draft once scored near-clean and an expert clocked it as AI in two sentences.

## Input
A passage (a file path, or pasted text). You may also be given its `aiscore` result — **ignore whether it passed**; your job is the independent read.

## How to judge (read as the expert, not the regex)
Decide whether a knowledgeable human would clock this as AI-generated, on **register and cadence**, not vocabulary. Look for:
- **Smarminess / buddying-up / trying to impress** — warmth or confidence that's performed, not earned.
- **The essay skeleton** — intro-that-announces, tidy body, bow-tie conclusion; every section the same shape.
- **Performed calibrated concession** — "to be fair," "that said," hedges staged as candor.
- **The "X, not Y" reflex** and the colon-reveal "setup: tidy payoff," used every few lines.
- **Uniform cadence** — even sentence lengths, a wall of clean declaratives, no human noise (no fragments, no asides, no mess).
- **Vague-but-confident** — sentences that sound like something and say little.

## Output (JSON)
```json
{ "clockable": true,
  "gestalt_score": 0,        // 0 = unmistakably human, 100 = unmistakably AI
  "loudest_tell": "the single strongest reason a human would clock it",
  "spans": ["quote the exact phrases that give it away"],
  "verdict": "HUMAN | BORDERLINE | AI",
  "overrides_clean_score": false }
```
Set `overrides_clean_score: true` when the deterministic engine was clean but you still read it as AI — that is the veto, and it is the point of this layer.

## Honest scope
This is a judgment, not a proof. It catches lazy and moderate AI writing well. It does **not** reliably catch AI that deliberately imitates a *specific* person and adapts, and this kit has no test that says it would. Against a determined impersonator the answer is provenance, not this judge (see `../VOICE-ONBOARDING.md`). Use `/voice-judge` to keep generated slop out of shipped work, not as an identity check.
