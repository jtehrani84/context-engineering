# /execution-truth — Runtime-Prove What a System Claims

Runtime-prove every write, endpoint, and optional step a system claims: live, silent-zero, stale, or ghost. Execution truth, not code review. The answer to "did a row actually land?"

**Use when:** you suspect, or want to rule out, silently dead features: objects written by code that lands 0 rows, advertised endpoints that 404, optional pipeline steps that report green and write nothing.

**The bar.** Code that looks right is not the bar. Only a successful write or SELECT, a row count, or an HTTP probe of the running process proves a feature works. Metadata lies: a column can exist in a schema-describe result, in a migration file, and in deployed code, and still reject a write.

## How to run

This is a multi-agent workflow (parallel runtime probes, adversarial re-verify, synthesize). It needs the Workflow tool, which is an orchestration opt-in in Claude Code. It also needs a target you name: there are no defaults, so it can never run against a system you did not pick.

```
Workflow({ name: "execution-truth-sweep", args: {
  root: "<path to the repo under sweep>",
  datastore: "<how to reach the datastore the system writes to: a psql service name, a CLI profile, an admin endpoint>",
  apiBase: "<https://base-url-of-the-live-API>",
  statusPath: "<optional: the endpoint that lists advertised routes>",
  srcDir: "<optional: server source directory, defaults to root>"
} })
```

If any of `root`, `datastore`, or `apiBase` is missing, the workflow returns an error and does nothing.

## Safety rails (the workflow enforces these; confirm they held)

- **Direct tooling only.** Exact counts matter, so no output-compressing tools.
- **Data stays local.** Never post record data off the machine.
- **Safe endpoint probes.** A POST endpoint gets an empty `{}` body and a 12-second timeout: 400 or 422 means live, 404 means ghost, 410 means gone. Never send a real account ID or company, because that triggers a real run with real writes.
- **Unreachable means UNVERIFIABLE.** If the live API sits on an internal network you cannot reach, the check comes back UNVERIFIABLE, not guessed.
- **Use a sandbox org.** The sweep runs read-only queries, but point it at a non-production alias unless you have a reason not to.

## After it completes

1. Take `result.synth.markdown` (truth table, ranked ghost list, execution-proof checklist) and write it to `<dir>/EXECUTION-TRUTH-SWEEP-<date>.md`. Stamp the top with `Audited: <system> @ <commit SHA or deploy revision>` and the args you ran with, so the findings can be re-verified instead of trusted (`rules/findings-are-perishable.md`).
2. Note `disputed`: verdicts the adversarial re-check corrected.
3. Lead with what is live, then the ranked silent-zero and ghost list, and whether the first ghost was the only one or the first of several.

## Related

- `/plan-audit` audits the plan that fixes what this finds.
- Rule: `rules/testing-quality.md` (persistence proof) and `rules/proof-before-claim.md`.
