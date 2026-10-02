# The Voice System — one pipeline

The kit's answer to "does this sound human, and does it sound like *us*?" is one layered pipeline, not four disconnected checks. A text is **CLEAN only when the deterministic engine AND a gestalt judge both pass** — a clean automated score alone certifies nothing.

## The layers

| Layer | What | Where | Ships |
|---|---|---|---|
| 0 | Generic AI-writing detector (0–100 score) | `avoid-ai-writing/` (vendored MIT, © Conor Bronsdon) | in code, generic |
| 1–3 | Banned words / phrases / openers | `avoid-ai-writing` + your overlay | generic in code; yours once you fill the overlay |
| 4 | **Structural** tells — parallel cards, announced hedges, aphorisms, cadence/flow | `../rules/structural-voice.md` | described in the rule; arrives in code in the next release |
| — | **Your calibration** — your overused words, your tells, your exemptions | `voice-overlay.mjs` | **EMPTY until you onboard** |
| 5 | **Gestalt judge** — reads a passage as an expert would; can VETO a clean score | `../skills/voice-judge.md` (`/voice-judge`) | a skill prompt, generic |

Layer 0, the rule text in layer 4 and the judge are the same for everyone. Only the overlay carries a person's voice — so it's the only piece that ships blank. Layer 4 is a written rule today, not a detector: the engine flags only what the vendored detector and your overlay catch.

## How the pieces connect

- **`aiscore.mjs`** runs layers 0–3 + your overlay and prints a score + hard-bans + any cadence flags your overlay defines. It reads the fuse and, until you calibrate, labels every verdict *"generic-only, NOT calibrated to you."*
- **`voice-setup.mjs`** is the fuse: `UNCALIBRATED / PARTIAL / CALIBRATED`. It refuses to let a clean generic score masquerade as "sounds like me."
- **`voice-tell-gate.py`** (hook) runs `aiscore` automatically on written `.md`/`.html`/`.txt` files and nudges.
- **`/voice-judge`** (layer 5) is the human-shaped read that catches what regex can't — and can overrule a clean score.
- **`../harness-evolution/harness-eval.mjs`** is the evolve-and-gate loop: it lets you change the guard and prove on a held-out split that it got *better*, not just different.

## The rule

**CLEAN only if the engine AND the judge both pass.** This exists because of a real failure: a draft scored near-perfect on the deterministic engine and an expert reader clocked it as AI in two sentences. The number was clean; the writing wasn't. The judge is the layer that catches that; never ship on a clean engine score alone.

## Stakes tiering

- **Scratch / internal note** — the engine score is enough.
- **Anything a customer, leader, or the public reads** — engine + structural rules + the judge + a human read. The bar scales with who's hurt if it's wrong.

## The honest ceiling

Calibration makes the guard catch lazy slop AND stop false-flagging your own clean writing. It does **not** beat someone who deliberately imitates you and adapts, and this kit has no test that says it would. Against a determined impersonator the durable answer is **provenance** (who typed it), not text detection. Calibrate for the slop and the false-positives; don't trust it past that. See `../VOICE-ONBOARDING.md`.
