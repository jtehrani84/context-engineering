# Refutation Needs the Right Oracle (P0 — the fourth sibling of the proof family)

The other three siblings guard positive states (`proof-before-claim.md`, `findings-are-perishable.md`, `claims-faithful-to-source.md`). This one guards the negative verdict: a judgment of **FALSE** — "fabricated," "hallucinated," "invented," "no such record," "unsupported" — **that outran its evidence because it was tested against the wrong source.**

A false-fabrication verdict is *more* expensive than a fabrication, because the whole point of an audit is trust: the reader takes "this is fabricated" as authoritative and acts on it — deletes a real finding, discredits a working system, tells a leader that verifiable facts are made up. A wrong RED burns the same trust a real bug would, and it hides behind the auditor's authority.

## Why this is an AI-dev problem specifically

When one agent researches, audits, AND renders the verdict, no second party ever crosses it. The agent holds one source in context, checks the disputed claim against *that*, finds it absent, and writes "fabricated." And auditing has a convenience gradient of its own: "I caught the machine hallucinating" is a tidier story than "the data was mostly right and my method was sloppy." So the convenient direction for a *verdict* is toward MORE fabrication findings.

Worked example: a set of data points was labeled "fabrication-heavy" after being checked against a single quarterly filing — a document that by design lists no new lawsuits, no exec hires, no CRM contacts. A firewalled re-check against the source each claim would *actually* live in flipped the verdict: 13 of 15 were real. One root cause: **absence from a source that could never have contained the claim was read as disproof.**

## The rule

**Before you render any verdict of FALSE, ask "if this were TRUE, where would it live?" and check THAT source. Absence from a source that wouldn't contain the claim even if it were true is not evidence of anything. A refutation is itself a claim and carries the same burden of proof as the thing it refutes. If the source where the claim would be true wasn't checked, the honest tag is UNVERIFIED — never FABRICATED.**

| Evidence: "is this claim actually false?" | Trust |
|----------|-------|
| Absent from the one document I had open | **none** — wrong-oracle absence proves nothing |
| Absent from a source that by design wouldn't list it | **none** — wrong oracle |
| Contradicts a source, but a *different* source could reconcile them | **claim** — reconcile before refuting |
| Absent from the source where it WOULD live, and that source is authoritative + current | **inference** — "not found where expected," not "fabricated" |
| **Independently absent/contradicted across every source it could plausibly come from** | **proof** it's false |

## Match the oracle to the claim

Route the claim to where it would be true before refuting. A newly-filed lawsuit lives in court dockets / legal-news, not the company's own filing. An exec hire lives in the newsroom / press, not a prior financial statement. A CRM record lives in the CRM, not a public web page. A forward guidance figure ≠ a trailing actual. If the right oracle is unreachable, you have not refuted the claim — you've failed to verify it.

## What to say when you can't check the right oracle

Downgrade, don't invert: "the figure isn't in the filing, but I did not check the press release where a change like this would actually be announced — UNVERIFIED, not fabricated." Never let "I didn't find it where it wouldn't be" read as "it isn't real."
