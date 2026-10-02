# /provenance-audit — Check a "Fabricated" Verdict Against the Right Source

Before any claim is called false, fabricated, or hallucinated, route it to the source where it would be true and check that source. Returns CONFIRMED, REFUTED, or UNVERIFIED per claim, with the oracle named. This is the runnable half of `rules/refutation-needs-the-right-oracle.md`.

**Use when:** an audit, a review, or a model-versus-source comparison is about to write "fabricated", "hallucinated", "no such record", or "unsupported" about a batch of claims, and someone will act on that verdict. Telling a reader that verifiable facts are made up costs you more than missing a real fabrication.

**Do not use for:** checking whether your own draft is faithful to its sources (use `/claim-audit`), or for a one-off claim you can check in a single lookup.

**The failure it stops.** An auditor tests a batch of claims against the one document in front of it, finds them absent, and calls them fabricated. But that document could never have held them: a periodic financial filing lists no newly filed lawsuits, no executive hires, no CRM records, and no chat threads, by design. Routed to the source where each claim would actually live, most of such a batch can turn out to be real.

## How to run

This is a multi-agent workflow (route, check in firewalled lanes, skeptic pass on every REFUTED). It needs the Workflow tool, which is an orchestration opt-in in Claude Code.

```
Workflow({ name: "provenance-audit", args: {
  claims: ["<disputed claim 1>", "<disputed claim 2>"],
  context: "<optional: where the claims came from, which record is the correct one>",
  lanes: ["web", "crm", "chat", "docs"]
} })
```

`lanes` lists the lanes whose tools you have actually connected (default: all four). A claim whose right oracle sits in a lane you did not list comes back UNVERIFIED. A bare array of claim strings also works.

## The lanes stay isolated

- **web**: public web search and fetch only. It sees only the public claim text. Never put a customer name next to a deal amount, a record ID, or internal chat content in a web query.
- **crm**: your CRM connector only, pinned to the correct record (beware near-duplicate accounts). Never calls a web tool.
- **chat**: your team-chat connector only. Never calls a web tool.
- **docs**: product documentation search only.

## Reading the result

- **CONFIRMED**: the right oracle supports the claim, with a verbatim excerpt and a source.
- **REFUTED**: the right oracle was reached and truly lacks or contradicts the claim, with the quote or the exact zero-result query. Every REFUTED goes through a skeptic pass that tries to overturn it. `falseFabricationsCaught` lists the ones that flipped.
- **UNVERIFIED**: the right oracle was not reached. This is the honest default. Never report it as fabricated.

## After it completes

1. Lead with the tally and the `falseFabricationsCaught` list. The point of the run is the wrong RED verdicts it caught.
2. Rewrite the audit so every "fabricated" that survived names the oracle it was tested against, and every un-run lane says UNVERIFIED.
3. Stamp the result with what it audited and when (`rules/findings-are-perishable.md`): a verdict about a source is a claim about that source's current contents.
