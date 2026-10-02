# Voice System — Onboarding (calibrate it to YOU)

The voice guard ships the detector and the calibration fuse, and it's generic until you calibrate it. Out of the box the engine runs the vendored detector (banned words, phrases and generic AI patterns), and `/voice-judge` adds a gestalt read that can veto a clean score. The structural and cadence checks (announced hedges, aphorisms, parallel cards, rhythm) are described in `rules/structural-voice.md` and arrive in code in the next release. Until then they only exist in the engine if you write them into your overlay (Step 3). The engine can't yet know *your* voice: protect your real writing from being false-flagged, or catch AI wearing *your* register specifically.

That last part is the only thing you have to add, and it's the only thing that couldn't ship — because a voice profile is a person, and a person doesn't transfer. Until you calibrate, the **fuse** (`tools/voice-setup.mjs`) keeps the guard honest: every verdict is labeled *"generic-only, NOT calibrated to you,"* so a clean score never gets mistaken for *"this sounds like me."*

**Read this before you start — what calibration does and doesn't buy.** It makes the guard catch lazy slop AND stop flagging your own clean writing as AI. It does **not** make it beat someone who deliberately imitates you and adapts, and this kit has no test that says it would. Against a determined impersonator the durable answer is provenance (who typed it), not text detection. Calibrate for the slop and the false-positives; don't trust it past that.

---

## Step 1 — Collect 20–40 samples of your own writing

Two disciplines, both learned the hard way:

- **Authorship.** Use text *you* actually typed — Slack messages, chat, raw notes. **Not** anything a model drafted for you and you edited, even under your byline. AI-assisted prose contaminates the "human" class with the exact thing you're trying to detect. If you didn't type it, it doesn't count.
- **Scrub.** No customer names, deal values, account IDs, credentials, or anything sensitive. You want your *voice*, not your data. Style survives scrubbing; the specifics must go.

Pull across your registers — how you write thinking-out-loud, how you write to a peer, how you write when it's polished. They differ, and the guard should know all of them.

## Step 2 — Derive your signature

Measure, don't guess. For your samples, look at: average sentence length and how much it varies; how often you write fragments; whether you start sentences lowercase; ellipsis vs. em-dash habits; how often you open with a question; the words and openers you reach for repeatedly. These become your calibration. (This is exactly how a measured profile is built — from real usage, not a staged sample.)

## Step 3 — Fill your overlay

Copy `tools/voice-overlay.skeleton.mjs` → `tools/voice-overlay.mjs` and populate:
- `TEAM_WORDS` — words *you* overuse that read as AI when stacked (your personal tells, on top of the generic banned list).
- `TEAM_PHRASES` — openers/phrases you would never actually write.
- `TEAM_STRUCTURES` — your structural tells as `{id, severity, test(text)}` (a cadence beat you fall into, a punctuation reflex).
- `EXEMPTIONS` — deliberate devices to *never* flag: a signature line you genuinely use, a verbatim quote.

Set `CALIBRATED = true` once the arrays are real. The engine (`aiscore.mjs`) picks the overlay up automatically.

## Step 4 — Seed the eval corpus

In `harness-evolution/corpus.json`, add your samples labeled `origin: 'self'` (human class) alongside some known-AI passages (ai class). The shipped seed is marked `seed: true` so it never counts as *your* calibration. Split into `tune` and `heldout` — heldout is never used to tune, so it's your overfit check.

## Step 5 — Set a baseline and gate changes

```
node harness-evolution/harness-eval.mjs --save baseline.json     # your starting separation score
node harness-evolution/harness-eval.mjs --gate baseline.json     # after any guard change: ADMIT / REJECT
```
This is the evolve-by-selection loop: a change to your guard is admitted only if it improves on tune AND doesn't regress on heldout. It's what keeps the guard from rotting into a score you game instead of a guard that works. Grow the heldout split as you go — a bigger corpus is a better gate.

## Step 6 — Check the fuse

```
node tools/voice-setup.mjs            # human status + your next step
node tools/voice-setup.mjs --check    # STATE: UNCALIBRATED / PARTIAL / CALIBRATED (exit 0 only when CALIBRATED)
```
When it reads `CALIBRATED`, the guard stops labeling its scores "generic-only" and starts standing behind them for your voice — with the ceiling above still in force.

---

*The detector and the fuse are the same for everyone. The calibration is yours, and it's the part that has to be earned per person — which is the whole point.*
