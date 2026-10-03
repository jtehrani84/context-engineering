<!-- built from docs/src/09-review-packet.md for the public edition at tools commit cc4c915 -->
# Review Packet

This chapter is for an outside reviewer. It lists what the voice system claims, the evidence for each claim, what is still undecided, the known limits, and a command that reproduces the public numbers from scratch. Counts are from the facts file at tools commit cc4c915 (2026-10-03).

The most useful findings are a claim below that a fresh run contradicts, a human document from the public corpora that the deterministic layer rejects, a spelling or encoding that hides a pinned phrase or an injection from the checks, and any way to get ADMIT out of the gate on text it did not score.

Send findings as an issue on the starter kit repository, github.com/jtehrani84/context-engineering. Include the command you ran, the commit, and the output. Do not paste private writing into an issue; describe it, or reproduce the effect on public or made-up text.

## What the System Does

The system scores a piece of writing for signs that a model wrote it, and blocks or flags it before it is sent. It has five layers: text normalization, a deterministic score from a vendored detector (51 categories, pinned at 58a95fc), a personal overlay of the writer's own tells, a judge panel of 4 models where no juror shares the drafter's vendor, and a send hook that blocks sends and nudges on file writes. [Architecture](02-architecture.md) has the data flow and [Reference](05-reference.md) has every flag, exit code and check.

The design goal is near-zero rejects on human writing. The deterministic layer alone can only REJECT or return INCONCLUSIVE; only the judges can ADMIT.

## Claims and Evidence

Each claim names its evidence and whether a reviewer can reproduce it with public data alone. "Facts file" means the number is filled from `docs/facts.json`, which records for each value whether it was measured at the build commit or recorded from an earlier one; "study" means a one-time measurement recorded in an evidence file.

| # | Claim | Evidence | Reproduce Publicly |
|---|---|---|---|
| 1 | The deterministic layer rejects 0 of 18,335 documents in the pinned public human corpora. | facts file (measured at cc4c915 on 2026-10-03), `calibration/human-fp-budget.mjs` | yes, see [Reproduce](#reproduce-the-public-numbers) |
| 2 | No pinned structure and no injection pattern matches any document in those corpora. | same run; the script fails on a single hit | yes |
| 3 | The judge panel rejected 0 of 400 human documents and caught 101 of 154 generated AI drafts. | study, `judge/JUDGE.md` (2026-10-02) | needs your own access to the four judge models; the sample lists are not shipped |
| 4 | A judge from the drafter's own vendor rates that vendor's drafts as less AI-like (about 12 points on n = 4 documents). | study, `case-study/RESULTS.md` (2026-09-29) | demonstration only; no interval |
| 5 | The gate never returns ADMIT on text it did not score: a broken or hung scorer gives ERROR, exit 4, with no judge called. | `prose-gate.unit.test.mjs`, 119 of 119 cases; verification run broke the scorer 13 ways (2026-10-02) | yes, the unit suite runs locally |
| 6 | Typing a pinned phrase or an injection with look-alike, invisible, bidi or tag characters does not hide it. | 111 normalization cases; verification attack table, 24 of 24 spellings and 9 of 9 injections caught after ca26e8a | partly; the attack suite is not shipped |
| 7 | Text addressed to a grader in a wording the 10 injection patterns list is rejected before any judge sees it. | 40 must-fire and 25 must-stay-silent injection cases | yes, unit suite |
| 8 | The send hook blocks on its block tier and denies a send when its scorer or normalizer fails, for tool calls its matcher routes to it. | `hook-tests/voice-tell-gate.test.py` on `hook/voice-tell-gate.py`, 552 of 552 cases | yes; the starter kit ships them as `tools/hook/` and `tools/hook-tests/` from its 2026-10-02 release that added these docs (`docs/voice/`), and the kit at 9505301 does not |
| 9 | The system cannot detect a model deliberately imitating a specific writer. | `VOICE-SYSTEM.md` "The ceiling": mimicry recall 0 of 11 (2026-09-21) | no; the reference writing is private |
| 10 | Generated tables come from the code, numbers in the phrases `facts.mjs` lists are checked against the facts file, other numbers cite an evidence file and are checked by review, and the build fails when a listed number disagrees with a fresh run. | `docs/tools/verify-docs.mjs`, 70 of 70 docs-tool cases (they test the checker, not every sentence) | no; the docs tools stay in the private repo. The shipped `facts.json` and `BUILD.json` let a reviewer compare printed numbers with the recorded values |

Claims 3, 4 and 9 rest on study files in the author's private evidence directory. [Decision Log](07-decision-log.md) gives each study's commit, numbers and reopen condition, and [Calibration and Evidence](06-calibration-and-evidence.md) gives the method.

## Reproduce the Public Numbers

One command, run from the tools directory (`tools/` in the starter kit, or `~/.claude/tools` after install). It downloads the four public corpora at their pinned versions, checks every file against its sha256, then scores every document locally:

```bash
bash calibration/fetch-public-corpora.sh && node calibration/human-fp-budget.mjs
```

Check first that `calibration/human-fp-budget.mjs` and `prose-gate.mjs` exist in your copy. The starter kit ships both under `tools/` from its 2026-10-02 release that added these docs (`docs/voice/`); the kit at 9505301 does not, so on an older clone run `git pull` first. Requirements: Node (no npm packages), bash, curl and tar, network access for the download, and the detector clone at the pinned commit (see [Runbooks](04-runbooks.md)). The corpora go to `$VOICE_CORPORA`, by default `~/.cache/voice-system/corpora`; a second run reuses them once they verify. Scoring makes no network call and sends no text anywhere.

What to expect. A table with one row per corpus (n, rejects, rejects by score, pinned hits, injection hits), a line `pooled public: R of N rejected; CLI cross-check K/K agree`, and a final line starting `PASS:`. The numbers in this packet are R = 0 and N = 18,335 (measured at cc4c915 on 2026-10-03). A `FAIL:` line names which condition broke: the budget, a pinned or injection hit on a human document, a document count that differs from the recorded one (a different corpus version), or a disagreement between the in-process verdict and the CLI.

Two local suites reproduce claims 5 and 7 with no download:

```bash
node aiscore.test.mjs && node prose-gate.unit.test.mjs
```

The docs tools stay in the private repo. The owner checks the docs against a fresh run of everything local with `node docs/tools/verify-docs.mjs --fresh`, which re-runs each suite and fails when a listed number differs from what the run measures.

## Open Decisions

These are choices the owner has not made yet. Each one lists what the evidence says so far.

**1. Case sensitivity on one overlay structure.** One structure in the author's overlay matches a phrase mid-sentence and misses the same phrase at the start of a sentence. Fixing it adds send-hook blocks, because the structure has critical severity. It hit 1 pre-2022 human document and 0 AI drafts, and it has been lint-only in the gate since 1de0ab1. The send hook now blocks the sentence-start form on its own (Decision Log, D14); the overlay structure is unchanged.

**2. Cadence out of the score can be reverted.** 05da726 set the cadence weight to 0; the capped variant from eb21f5c is one flag away (`--cadence-weight`). The capped variant catches one more AI draft in-sample (4 of 124 against 3) and leaves the nearest human document 3 points under the det bar instead of 22. The AUC gain and zero human rejects favor leaving cadence out. On the held-out half both variants caught 2 of 62 AI drafts, so the difference is within noise.

**3. The GPT juror is a new live dependency.** It is the one change that moved recall on Anthropic drafts (26 of 94 to 49 of 94). If it is unavailable, the panel asks the spare juror, and a lone consensus juror cannot reject (Architecture, The Gate), so the failure mode is INCONCLUSIVE. A smaller GPT model was not tested as a cheaper substitute.

**4. No human-labeled validation of the judges.** The 0 of 400 human figure is measured on public prose that carries era and medium cues, the AI side has no held-out set, and the labels on the pinned-phrase catches come from three model labelers. A small blind, human-labeled set that includes modern business email is the missing check.

## Known Limits

- **Old, formal human text.** Every public human corpus predates 2022 and is blog, standards, design-document or Usenet prose. Rejecting none of it says little about a modern writer's email or chat.
- **One AI generation run.** The AI drafts come from one run: four vendors, 16 prompt topics. Every long-AI catch of the shipped pin comes from 2 of the 6 long-draft topics, and the pin was written to match drafts in that set, so its recall on unseen AI is unmeasured (Calibration and Evidence, Known Limits).
- **Low deterministic recall by design.** With cadence out of the score, the deterministic layer catches 3 of 124 fresh AI drafts. The judges carry recall; in det-only mode the expected result on AI text is INCONCLUSIVE.
- **Writers who know the rules.** The pinned phrase is a tripwire. Any drafter given the same ban list avoids it by construction.
- **Injection wordings outside the list.** The deterministic injection check matches 10 pattern rows. Other wordings pass it by design and rely on the prompt fence and the jurors; in the live test, seven unlisted wordings, each run on two panels, fooled no juror.
- **Normalization is a fixed table.** It folds 572 confusables from UTS #39 v18.0.0 and removes known invisible classes. A character class outside the table is not covered until it is added.
- **Judge noise.** Repeat runs of the previous panel changed 12.3% of AI gestalt calls and 9.7% of final AI verdicts, and no human verdict (0 of 200). For the current panel, 8 of 94 Anthropic drafts (8.5%) changed verdict between runs.
- **Mimicry.** A model told to imitate a specific writer was caught 0 of 11 times. A pass means "not obviously AI" and nothing about authorship.
- **Detector drift.** Raw scores depend on the vendored detector at 58a95fc. Upstream has changed about 1,350 lines of its pattern file since; moving the pin means re-running the budget and the full-gate evaluation.
- **Private evidence.** The judge, self-bias and mimicry studies are recorded in files that are not shipped. The decision log reports their numbers and dates; a reviewer can rerun the method on their own data but cannot recheck the original samples.
