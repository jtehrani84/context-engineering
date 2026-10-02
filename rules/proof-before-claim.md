# Proof-Before-Claim (P0 — applies to every "done")

One of four sibling epistemic-discipline rules: **proof-before-claim** (this file), `findings-are-perishable.md`, `claims-faithful-to-source.md`, `refutation-needs-the-right-oracle.md`. Together they stop an agent from confidently telling you something is true when nothing is behind it. This one stops the **stale GREEN**: reporting *shipped / deployed / built / fixed* with nothing running behind the claim.

## Why this is an AI-dev problem specifically

On a human team the work passes through hands — author → reviewer → deployer → QA — and each hand independently checks the previous one's claim. When one agent writes, fixes, AND deploys, that chain collapses to a single point. No second party ever crosses the work, so nobody notices when "deployed" and "actually serving" diverge. The person relying on the agent (often not a developer) has no way to tell "verified" from "asserted confidently" — both look like a green checkmark and a confident sentence.

So there is one failure class, not many: *AI claims done, nothing behind it.* It only wears different costumes — the code throws on every request, the write landed zero rows, the route was never committed — because the agent operates at every layer.

## The rule

**A claim of done requires a proof artifact — a signal from the thing actually running — not reasoning, not a commit, not a clean source tree, not a prior note (even your own).**

Rank the evidence honestly before reporting:

| Evidence | What it proves | Trust |
|----------|----------------|-------|
| A memory / prior note says "shipped" | intent was recorded | **claim** (weakest) |
| Source on disk contains the code | an edit exists somewhere | **claim** (wrong branch? never saved?) |
| Compiles / type-checks / commits / tests green | code *shape* is valid | shape only, never effect |
| **Live response / row COUNT / container hash / fresh trace** | the work *ran and had effect* | **proof** |

Before writing "shipped / deployed / working / fixed / live," capture the matching proof:

- **Deployed a service or site** → hash or fetch the *running* artifact, not the local file.
- **Wrote to a datastore** → COUNT the object before and after; the count must increase. 0 = FAIL.
- **Untyped runtime (Apps Script, raw JS, shell)** → execute the changed path once; a commit is not proof.
- **A field / route / function a note names** → verify it exists in the running system before relying on it.

## Honest scope (don't overclaim the guards either)

A PostToolUse hook can *nudge* but cannot *prove* — it fires on the tool call with no before/after delta. The proof is always an executable artifact you run and read (a health probe, a COUNT query, a fresh trace). Building a guard doesn't exempt the guard from this rule: prove the guard runs, and that it can FAIL, before claiming it works.

## What to say when you can't prove it

If a proof artifact isn't obtainable (no deploy access, an auth wall, a service unreachable), say so and name what's unverified: "code edited + committed, NOT verified against the running system — needs a live check once reachable." Never let "edited" silently become "shipped." Vague-and-honest beats confident-and-wrong.

*Team note: the kit ships `hooks/scripts/deploy-proof-gate.py`, which reminds Claude to prove a deploy on the running system (and names your repo's `verify-deploy.sh` if it has one). It nudges by default; set `KIT_PROOF_GATES=block` to make it a block. Add your own `verify-deploy.sh` so the proof is one command.*
