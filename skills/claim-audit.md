# /claim-audit — Source-Faithfulness Audit

Adversarially audit an external-facing artifact: extract every factual and causal claim, re-verify each against its cited source, and flag inversions, "documented" flattening, and circular reasoning before the artifact ships. Takes an artifact path as the argument.

**Use when:** a customer-, Support-, CSM-, or leadership-facing artifact (an HTML handoff, a briefing, a technical analysis, an email about to go out) asserts facts or a causal mechanism, and someone will read it and act on it as authoritative. "Well written" is not the bar. "Faithful to source" is.

**Do not use for:** code, scratch notes, or internal working files (the `claim-faithfulness-gate` hook stays quiet on those by design). For voice and structure use `/content-review`. For a plan that asserts facts about code use `/plan-audit`. For a verdict that calls something false or fabricated use `/provenance-audit`.

**The failure it stops.** An author writes "enabling X leaves Y untouched" when the release note it retrieved says X can break Y, a convenient-direction inversion. Or it labels a causal chain "each documented" when the pivot step is an inference. Both read as confidently true to the agent that wrote them, because the agent holds the source and the prose in the same context. An independent pass catches them. See `rules/claims-faithful-to-source.md`.

## How to run

This is a multi-agent workflow (extract claims, re-verify each against source, adversarially re-check the flagged ones, write the punch list). It needs the Workflow tool, which is an orchestration opt-in in Claude Code. If you have not enabled it, say so and offer to do a single-pass manual re-read for a short artifact instead.

```
Workflow({ name: "claim-audit", args: "<absolute-path-to-artifact>" })
```

Pass the sources explicitly for anything high-stakes, so claims are checked against ground truth and not the model's memory:

```
Workflow({ name: "claim-audit", args: { artifactPath: "<path>", register: "technical", sources: "<source excerpts or doc paths the claims rest on>" } })
```

**Always pass `sources` for a high-stakes artifact.** An agent that re-reads only the artifact can re-confirm its own inversion.

## Register

`register` sets the bar so the audit does not false-flag legitimate seller language as an overclaim.

- `technical` (default): bound every factual and causal claim to its source. Use for specs, briefs, and architecture reviews.
- `vision`: directional claims ("our platform helps every team move faster", a bold thesis) are the register working as intended. Flag one only when it is dressed as measured data, meaning a statistic, a percentage, or a benchmark with no source.

In both registers, never present a vision claim as a measured fact. Register scopes the bar, never the faithfulness.

## What it returns

Per claim: a tag, a faithful or unfaithful verdict, and a fix for the unfaithful ones. Overall: `ship-ready`, `ship-after-fixes`, or `needs-rework`, plus a prioritized punch list. Inversions and circular evidence rank highest. It also returns a `bound_once` list: any caveat stated more than once, with the one place it should live. A true bound stated once reads as rigor; the same bound repeated reads as defensive fluff.

## Tags

- **DOCUMENTED**: the cited source states the claim. Safe.
- **INFERRED**: the source states the premises and the claim joins them. The artifact must label it an inference or hypothesis, never "documented".
- **UNSUPPORTED**: neither stated nor cleanly inferable. Cut it or find a source.

## After it completes

1. Lead with the verdict and the critical items. Do not bury an inversion under a list of nits.
2. Apply the fixes, then apply the `bound_once` collapses.
3. An audit finding can itself be wrong. If two passes disagree about what a source says, read the source.
4. Say what you could not check. A source you could not retrieve downgrades its claims to unconfirmed; it does not make them pass.
