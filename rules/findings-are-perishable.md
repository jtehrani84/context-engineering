# Findings Are Perishable (P0 — the mirror of proof-before-claim)

One of four sibling epistemic rules (see `proof-before-claim.md`). That rule stops a **stale GREEN** — reporting done with nothing behind it. This one stops the mirror failure, a **stale RED**: acting on a prior finding ("X is broken / Y doesn't work / Z is an open issue") after the thing it audited has changed, so the finding silently expired but still reads as current truth.

A stale RED costs as much as a stale GREEN. It sends you to "fix" something already fixed — burning a remediation cycle and eroding trust the same way shipping a real bug does.

## Why this is an AI-dev / memory problem specifically

The system stores **perishable findings** the same as **durable facts**. "This module has 13 exported functions" is durable. "The report fabricates its totals" is perishable — it is only true relative to *a specific version of the data that produced the report*. Memory frontmatter, audit docs, and recall record both identically: no version anchor, no expiry, no re-verify trigger. When a later, unrelated job regenerates the artifact, every finding about the old version goes stale at once — and nothing flags it. A reader (human or agent) reads the dated doc as the present.

It compounds with **artifact sprawl**: one issue accretes 3–5 dated snapshot docs, each frozen, none reconciled, none marked superseded. You can't tell which one is live.

## The rule

**A finding is a claim about a specific artifact version. Before acting on any prior finding — especially one that triggers expensive remediation (regen, redeploy, refactor) — re-verify it against the CURRENT artifact. Different version → the finding is STALE until re-run. The prior finding is not current truth; the fresh re-run is.**

| Evidence: "is this finding still true?" | Trust |
|----------|-------|
| A dated audit doc says "X is broken" | **stale claim** until you check the artifact version it audited |
| Memory says "X is broken" | same — point-in-time, may have expired |
| The audited artifact is unchanged since the finding (same stamp/SHA/timestamp) | finding still holds |
| **A fresh re-run of the finding's own check against the current artifact** | **current truth** |

## Four light layers

1. **Stamp every finding with what it audited.** Top of any audit/verdict doc, and in the memory pointing to it: `Audited: <artifact> @ <version|SHA|timestamp>`. An unstamped finding is already stale.
2. **Re-verify before remediating.** Compare the finding's stamp to the current artifact's. Same → trust it. Different → re-run the check before spending a cycle. Give each audit doc a one-line re-verify recipe so re-running is one step, not archaeology.
3. **Regeneration and deploy are invalidation events.** When you regen data or deploy code, note which open findings that just invalidated. A regen must never silently leave a stale RED standing.
4. **One living status page per issue** (status + last-verified stamp, edited in place), not a pile of dated snapshots.

## What to say when you can't re-verify

If the artifact is unreachable, say so and name it: "finding dated <X> against <artifact>@<X>; current artifact is @<Y> — NOT re-verified, may be stale." Never let a dated RED silently read as current.
