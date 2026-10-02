# /plan-audit — Adversarial Audit of a "Code-Verified" Plan

Adversarially audit a plan that calls itself code-verified: extract its claims, try to refute each one against the real code, re-check the high-stakes ones independently, and judge by build impact. Takes a plan file path as the argument.

**Use when:** a plan asserts facts about existing code at file:line granularity, those facts drive fix decisions (delete or populate, prompt-tune or config-edit), and someone will build or deploy directly from it. A wrong assertion ships a broken deploy. "Mostly right" is not the bar.

**Do not use for:** purely strategic plans with no code claims. Use `/content-review` for those.

## How to run

This is a multi-agent workflow (fan-out refutation, independent re-check, judge). It needs the Workflow tool, which is an orchestration opt-in in Claude Code. If you have not enabled it, say so and offer to run it once you have.

```
Workflow({ name: "plan-audit", args: "<absolute-path-to-plan.md>" })
```

With an explicit codebase root, or a source doc the plan corrects:

```
Workflow({ name: "plan-audit", args: { planPath: "<path>", codebaseRoot: "<repo-root>", inputDoc: "<doc-the-plan-corrects>" } })
```

## What each verdict means

VERIFIED (matches exactly), IMPRECISE (directionally right, detail wrong), REFUTED (materially wrong), UNVERIFIABLE (needs a live run you could not do). Each claim also carries a build impact if it is wrong: cosmetic, wasted-effort, wrong-fix, broken-deploy, or safety. The judge sorts by that axis.

## After it completes

1. Pull the judge markdown from `result.judge.markdown`, the counts, and `flipped` (verdicts that changed on the independent re-check).
2. **Coverage gate (mandatory).** If any broken-deploy or safety claim lost its re-check to an agent failure, verify it by hand before you sign off. Never let a broken-deploy verdict rest on an unconfirmed agent.
3. Write the audit to `<plan-dir>/<PLAN-NAME>-AUDIT-<date>.md`. Stamp the top with `Audited: <plan> @ <modified time or git SHA>` and a one-line re-verify recipe, so a later reader knows which version of the plan the findings describe (`rules/findings-are-perishable.md`). Add a footer: counts, what flipped, what you hand-verified, what is UNVERIFIABLE.
4. Lead with the overall verdict (SAFE-AS-WRITTEN, SAFE-WITH-CORRECTIONS, or NOT-SAFE), then the must-fix-before-building list. If the plan corrected a prior doc, say whether each correction held.

## Related

- `/execution-truth` proves "did a row actually land?" This command proves "is the plan telling the truth about the code?"
- Rule: `rules/testing-quality.md` (persistence proof) and `rules/proof-before-claim.md`.
