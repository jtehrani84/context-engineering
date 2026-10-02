# Tiered, Cost-Aware Model Orchestration

Multi-step and multi-agent work should not run one flagship model for everything. Pick the
model, the effort level, and the tool for each task. Use a cheaper model where it is enough and
the strongest one only where answer quality turns on it.

## Capability tiers (vendor-neutral)

Tiers describe capability, not price, and every vendor has them under different names. Map your
available models to these two buckets using your provider's own documentation, and check actual
pricing and quotas in the vendor portal:

- **Standard tier.** Fast, lower cost per token. Routine coding, high-volume extraction,
  classification, search and summarization, latency-sensitive calls, mechanical passes.
- **Premium tier.** Flagship reasoning models. Hard synthesis, adversarial review, long-horizon
  planning, and any decision where a wrong answer is expensive.

Model availability depends on which tools and gateways your team has configured. Don't hardcode
model names into shared rules or prompts; put them in config so the mapping can change.

## The pattern

- **Fan-out legs run Standard tier at low to standard effort.** Mappers, extractors, searchers,
  and formatters do the wide work.
- **The one hard step runs Premium tier at high effort.** Synthesis, the judge, the adversarial
  verify pass, and the final call that the user will act on. A 14-agent audit needs the flagship
  on the synthesis step, not on all 14 agents.
- **Right tool, not just right model.** Don't launch a multi-agent workflow to write one
  paragraph or read one file; a direct read or edit costs less and is faster. Match model,
  effort, tool, and agent count to the task.
- **Prefer a different vendor for the judge.** A model judging its own family's output
  tends to favor it. When the stakes justify it, route the review to a model from another lab.
- **Data class gates everything.** Whatever the tier, customer, deal, or confidential content
  only goes to models and gateways your organization has approved for that data. Decide the data
  class first, then choose a model from the allowed set.

## Don't optimize the cost itself

The target is the best answer per dollar, not the cheapest answer. Never weaken the synthesis or
verification step to save tokens. If you can't tell whether a leg is load-bearing, treat it as
Premium.

## A cheap model is safe when a deterministic check verifies it

Going cheap is defensible when something that can't be talked out of a wrong answer checks the
output. Examples: compare a compressed log's source hash and verbatim quotes against the original
and fall back to the original on any mismatch; run the test suite on generated code; validate a
JSON schema; diff a generated file against a spec. Where such a gate exists, use the Standard
tier and let the gate catch misses. Where none exists, the cheap model's output is a draft, and
a stronger model or a human has to review it.

Model fit is a starting point, not law. Match the shape of the task to the tier, measure on your
own data before promoting a cheaper pick to default, and keep the check that would catch a miss.

Related: `proof-before-claim.md` (a gate is only trusted after you've seen it fail),
`security.md` (data handling).
