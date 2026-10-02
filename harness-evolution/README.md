# Harness Evolution — a measured, gated change process for your quality guard

The idea comes from published research on evolving agent harnesses by selection, applied here by hand: freeze the model, and *evolve the harness* by selection — propose a change to a component, score it against a verifier, and admit it only if it improves without regressing elsewhere.

Here the component is your **voice/quality guard** (`../tools/aiscore.mjs` + your overlay). Before this, guard changes were *asserted* — "I added a banned word and the regex tests still pass." That tells you the pattern fires, not whether the guard got better at separating your writing from AI slop, and not whether the change quietly overfit. This makes it **measured and gated** instead.

## What it does

`harness-eval.mjs` scores the labeled corpus (`corpus.json`) with the real verifier and reduces it to one number per split:

```
badness    = aiScore + 10 × hardBans + 5 × cadenceFlags   (the guard's combined verdict on a passage)
separation = mean(ai badness) − mean(human badness)        (one scalar; higher = better guard)
fitness    = separation − 15 × falseHardBans               (flagging your own clean writing is disqualifying)
```

Separation captures both failure modes at once: missing slop pulls `mean_ai` down, false-flagging clean writing pulls `mean_human` up. Either way the number drops.

The corpus is split **tune** / **heldout**. You tune the guard against tune; heldout is never used for tuning, so it's the overfit check (the research calls it anti-cheat).

## Use it

```
node harness-eval.mjs                       # score the corpus, print the scorecard
node harness-eval.mjs --save baseline.json  # freeze the current scorecard as the gate baseline
node harness-eval.mjs --gate baseline.json  # after a guard change → ADMIT / REJECT (exit 1 = REJECT)
```

A change is **admitted** only if tune fitness improves AND held-out doesn't regress past δ=5 (preserve-and-extend). Wire `--gate` into a pre-commit or CI step so a guard change can't land unless it's a real improvement.

## Calibrate it (important)

`corpus.json` ships as a **generic seed** (`corpus.seed.json`) — synthetic public passages so the eval runs out of the box. It is NOT your voice. Your first job:

1. Add your own clean writing (`label: "human"`, `origin: "self"`) and known AI-slop (`label: "ai"`), split into `tune` / `heldout`.
2. `node harness-eval.mjs --save baseline.json` to set your starting line.
3. Grow the held-out split over time — a bigger corpus is a stronger gate.

See `../VOICE-ONBOARDING.md` for the full calibration flow.

## Honest scope (don't overclaim it)

- It evaluates the **guard** (did detection improve), NOT generation quality (did the writing improve). Grading output quality needs the model in the loop and isn't this tool.
- The verifier is a **proxy**. Optimizing the number while the real target — a human expert's read — diverges is the Goodhart trap. Don't chase separation to infinity; a clean number is not a clean voice.
- At small n the **jackknife band is coverage-limited, not a confidence interval.** Grow the corpus before trusting the separation number, and read a `FRAGILE` verdict as "this call hinges on one passage."
- No text-only guard beats a determined adaptive impersonator — that's provenance, not detection (see `../VOICE-ONBOARDING.md`).
