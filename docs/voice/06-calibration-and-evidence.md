<!-- built from docs/src/06-calibration-and-evidence.md for the public edition at tools commit c558a2f -->
# Calibration and Evidence

This chapter describes how the voice system is measured and lists the numbers behind its current settings. Counts come from the facts file, measured at tools commit c558a2f on 2026-10-03. Numbers that come from a one-time study cite the evidence file and date instead.

The system can fail in two ways. It can reject text a person wrote (a false positive), or it can admit text a model wrote (a miss). The settings put the first one near zero and accept a partial catch rate on the second, because a rejected human message costs the writer trust in the tool, while a missed AI draft still goes to the judge panel. The deterministic layer is tuned against human text first; the judges carry most of the recall.

## What Is Measured

| Measurement | Data | Command | Calls a Model |
|---|---|---|---|
| Human false-positive budget | pinned public corpora, fetched and checked by sha256 | `node calibration/human-fp-budget.mjs` | no |
| Full-gate evaluation | labeled sets, run through `prose-gate.mjs --det-only` | `node calibration/gate-eval.mjs` | no |
| Unit and regression suites | synthetic fixtures | see [Test Suites](#test-suites) | no |
| Judge panel false positives and recall | public human documents and generated AI drafts | one-time study, see [Judge Panel](#judge-panel) | yes |
| Your own overlay | your samples, split into tune and held-out | `node onboarding/calibrate-user.mjs` | no, unless you pass `--judge-drafts` |

Everything except the judge study runs locally. The facts file makes no external call, so suites that reach a judge are recorded as not run.

## The Human False-Positive Budget

`calibration/human-fp-budget.mjs` is a standing gate: every change to a check has to pass it. It scores each document in the public corpora with the shipped code in one process (the same path as `prose-gate.mjs --det-only`), and checks a sample of documents against the real CLI so the in-process path cannot drift from what ships.

The corpora are pinned to fixed versions by `calibration/fetch-public-corpora.sh` and checked file by file against `calibration/public-corpora.sha256`. All of them were written before 2022, before large language models were common writing tools:

| Corpus | Version | License | Documents | Rejected |
|---|---|---|---|---|
| 18F blog posts, 2015 to 2021 | github.com/18F/18f.gsa.gov @ 292605ab | CC0, US government work | 421 | 0 |
| Python PEPs | github.com/python/peps @ f2f542d | public domain or CC0 | 576 | 0 |
| IETF RFCs, a fixed list of 18 | rfc-editor.org | IETF trust | 18 | 0 |
| 20 Newsgroups, by-date split | qwone.com, 1992 to 1993 Usenet | research use | 17,320 | 0 |
| Pooled public | | | 18,335 | 0 |

The fetch downloads 429 18F files; the cleaning step keeps the 421 that hold post text. Status of this run: measured at c558a2f on 2026-10-03.

The script fails (exit 1) when:

- the pooled public reject count exceeds the recorded baseline in `calibration/human-fp-budget.json` plus a margin of max(2, 0.01% of n), rounded up;
- any pinned structural tell (rule C) or any judge-directed injection pattern hits any human document, because a check that rejects on its own must cost zero real people;
- a corpus is missing or its document count differs from the recorded one, which means a different version was fetched;
- the in-process verdict and the CLI verdict disagree on any cross-checked document;
- the hook lane is over its baseline or could not run. The verdict above never runs the send hook's own word list and "As <Name>" check, so the script also passes every document through them (`calibration/hook-lexicon.py`, counts only, the built-in company names) and fails when a set's documents the hook would deny pass the `hookLexicon` baseline plus the same margin. That baseline is re-recorded on its own with `--write-hook-baseline` (Decision Log, D19).

The recorded baseline was measured 2026-10-02 at tools commit 892b20b and is re-recorded only with a reviewed reason (`--write-baseline`). Zero rejects on these corpora is a measurement on older, formal and technical prose. It does not cover a modern writer's business email or chat, and [Known Limits](#known-limits) lists what that leaves open.

## Rules That Reject on Their Own

The deterministic layer (`prose-gate.mjs --det-only`) rejects a text for one of three reasons. Calibration treats each one separately, because each has its own false-positive cost:

| Rule | Rejects When | Calibrated By |
|---|---|---|
| Score | the adjusted detector score reaches the det bar (40) | the human budget above, and the evidence classification below |
| Rule C | a pinned structure matches; 1 structure is pinned today | zero hits required on every human document in the budget |
| Injection | text addressed to a grader matches one of 10 pattern rows (7 types) | zero hits required on every human document in the budget |

Every other check (the overlay's structures and words, and the cadence lint) prints as must-fix and never rejects in the gate on its own. The send hook uses a different policy: it blocks on severity and its own lexicon. [Reference](05-reference.md) lists both.

### Which Detector Categories Count

The vendored detector reports 51 categories. A study on 2026-10-01 tested each one for whether it fires more on AI drafts than on human documents of the same length, using 124 fresh AI drafts from four models and a human sample that includes the public corpora above plus private sets. Only categories that held up add to the adjusted score:

| Class | Categories | Effect on the Score |
|---|---|---|
| Counted | 9 | add points |
| Not counted: noise (fires on humans as often as on AI) | 20 | print, 0 points |
| Not counted: untested (no hit on a fresh AI draft, at least one on a human document) | 19 | print, 0 points |
| Not counted: style (a writing rule, not a sign of AI) | 2 | print, 0 points |
| Not counted: lint (weight 0 in the detector already) | 1 | print, 0 points |
| Unclassified | 0 | none; a new category must be classified before it ships |

The counted set is two categories with measured lift (placeholder text such as "[Company Name]", and heavy bold formatting) plus seven that never fired on any human document or AI draft in the study. Synthetic fixtures show each of the seven fires, and they cost nothing measured, so they stay. Source: `ai-evidence.mjs`, and evidence file `recal/FINAL.md` (2026-10-02).

Two numbers from that study bound what the score can do. With the cadence checks out of the score, the held-out ranking AUC between human documents and AI drafts was 0.737 for short documents and 0.841 for long ones. Without the drafts that contain placeholder text, the short-document AUC falls to 0.593 (95% interval 0.498 to 0.701). The short-document score leans on one easy tell.

## Full-Gate Evaluation

`calibration/gate-eval.mjs` runs every item in a set of labeled collections through the shipped `prose-gate.mjs --det-only` CLI and counts verdicts. It measures the verdict code as it ships. The expected result is no REJECT on any human set and no ADMIT anywhere, since the deterministic layer alone can only reject or return INCONCLUSIVE. An ERROR is retried once and then counted; the count must be zero.

The labeled collections include private writing, so per-set counts appear only in the internal edition. The public reproduction is the human budget above.

## Judge Panel

The judge panel decides most AI cases, because the deterministic layer rejects few AI drafts by design. With at least two jurors answering, the panel rejects when every juror marks the text clockable, or when their mean AI-ness score reaches the default bar of 50. A lone surviving juror cannot reject. The judge is never from the drafter's vendor; [Reference](05-reference.md) has the panel per drafter.

These numbers come from a one-time study, evidence file `judge/JUDGE.md` (2026-10-02, pre-registered before the held-out half was scored). It used 400 human documents drawn from the public corpora and 154 generated AI drafts from four vendors. No private writing went to a judge.

| Measurement | Previous Panel | Current Panel | Note |
|---|---|---|---|
| Human documents rejected | 0 of 400 | 0 of 400 | 200 in-sample, 200 held out; 95% upper bound about 1% |
| Anthropic drafts caught | 26 of 94 | 49 of 94 | repeated on a second sample: 33 vs 49 |
| All AI drafts caught | 78 of 154 (50.6%) | 101 of 154 (65.6%) | |
| Adversary drafts caught | 7 of 30 | 13 of 30 | drafted under the anti-AI writing rules |

The change between the two panels put the GPT juror on drafts from Anthropic models, human writers and unknown drafters, where the Gemini juror had been weak (AUC 0.83 on Opus drafts). Each juror separates human documents from AI drafts well when used as a ranker: AUC 0.989 for Grok, 0.901 for Gemini, 0.975 to 0.988 for Claude (two runs), and 0.967 to 0.999 for GPT depending on the drafter. The GPT juror returned 0 errors in 938 calls, with a median of 8 seconds.

Repeat runs show how noisy the panels are. For the previous panel, no verdict on 200 human documents changed between runs; across 154 AI drafts, 19 (12.3%, 95% interval 8.0 to 18.5) changed the gestalt call and 15 (9.7%) changed the final verdict. For the current panel, 8 of the 94 Anthropic drafts (8.5%) changed verdict between runs, against 16.0% for the previous panel on the same drafts (`judge/JUDGE.md`, Test-Retest).

What the study does not settle:

- The AI side has no held-out set, and the Gemini swap was chosen after watching Gemini miss the same 94 drafts.
- More than half of the jurors' "not AI" calls on human documents cite the date or the medium. The 0 of 400 is optimistic for a modern writer whose text carries no era cues.
- The most polished human prose (18F posts) scored highest and produced both single-juror "clockable" calls.
- The labels on the AI side are "a model wrote this," known by construction. No blind human labeled any of it.

### The Ceiling: Deliberate Mimicry

The system catches generic AI writing. It does not catch a model told to imitate a specific person. Mimicry recall was 0 of 11 with a three-judge consensus (Wilson 95% interval 0 to 0.26, and 0 under leave-one-out); evidence: `VOICE-SYSTEM.md` "The ceiling," measured 2026-09-21. A stylometry check that scored 11 of 11 turned out to measure length: a rule of "more than 40 words" also scores 11 of 11. On the 2026-10-02 adversary set, panel recall was 23% to 43% depending on the panel.

A passing result means "not obviously AI." It never means "written by this person." Authorship is a question of who typed the text, which a detector cannot answer.

## Calibrating Your Own Overlay

The overlay is the one layer that carries a person's voice, so each user calibrates their own. `onboarding/profile-build.mjs` splits your samples into a tune set and a held-out set by content hash. `onboarding/calibrate-user.mjs` then runs the two checks that act on what you send, on every held-out sample:

- the gate, `prose-gate.mjs --det-only` (no judge is called for a sample);
- the installed send hook, given the sample as a synthetic send (nothing is sent).

Your own writing has to come through clean. In standard strictness a held-out sample fails when the gate rejects it or the hook blocks it; with `--strict` a nudge also counts. The target is zero failures. Each failure names the check that fired and suggests a change. With `--ai-drafts <dir>` the same checks run on AI drafts in your topics and report how many they catch. With `--judge-drafts` the gate may send those drafts, and only those, to the judges your config allows.

The network is switched off in `calibrate-user.mjs` and in every Node process it starts. Output names samples by id (s01, s02, and so on), never by text. The report records the overlay and engine hashes, so `voice-doctor.mjs` can tell when a later change makes it stale. [Getting Started](01-getting-started.md) walks through the steps.

## Test Suites

| Suite | Command | Result |
|---|---|---|
| Scorer | `node aiscore.test.mjs` | 20 of 20 |
| Gate unit (no judge call) | `node prose-gate.unit.test.mjs` | 123 of 123 |
| Send hook | `python3 hook-tests/voice-tell-gate.test.py` | 552 of 552 |
| Onboarding tools | `node --test onboarding/test/*.test.mjs` | 85 of 85 |
| Docs tools | `node --test docs/tools/test/*.test.mjs` | 70 of 70 |

The gate unit suite includes 40 injection cases that must fire and 25 that must stay silent. The normalization cases in the overlay suite number 111.

## Known Limits

- **Era and medium.** Every public human corpus predates 2022 and is formal, technical or Usenet prose. No modern business email or chat set has been judged or budgeted in the public numbers.
- **One generation run.** The AI drafts come from one run: four vendors and 16 prompt topics. Every long-AI catch of the shipped pin (3 drafts) comes from 2 of the 6 long-draft topics, and the pin was written to match drafts in that set, so its recall on unseen AI is unmeasured. Evidence: `decide/TEST.md`.
- **No human labels.** No blind human reader has labeled the AI side or validated the judges.
- **Writers who know the rules.** A drafter that follows the same ban list avoids the pinned phrase by construction, so rule C works as a tripwire for drafts written without the rules.
- **Detector pin.** The detector is pinned at 58a95fc (the checkout is at 58a95fc). Upstream has changed since, so raw scores can move when the pin moves. Re-run `gate-eval.mjs` and `human-fp-budget.mjs` before moving it.
- **Mimicry.** See [The Ceiling](#the-ceiling-deliberate-mimicry).

## Evidence Files

| File | Date | Holds |
|---|---|---|
| `calibration/human-fp-budget.json` | 2026-10-02 | the recorded human budget baseline |
| `recal/FINAL.md` | 2026-10-02 | detector evidence classification, cadence weighting, tune and held-out split |
| `judge/JUDGE.md` | 2026-10-02 | judge panel study, pre-registration files `judge/holdout-prereg.json` and `judge/gpt-prereg.json` |
| `VERDICT.md`, `decide/DECISION.md`, `decide/TEST.md` | 2026-10-01 | cadence length crossover sweep, rule C narrowing, candidate recall by topic |
| `case-study/RESULTS.md`, `case-study/calibration-2026-09-29.json` | 2026-09-29 | same-vendor judge bias, case-study drafts |
| `VOICE-SYSTEM.md`, "The ceiling" | 2026-09-21 | mimicry recall |
| `docs/evidence/persona-2026-10-02.json` | 2026-10-02 | onboarding persona run on one public author, counts only |

The study files other than `calibration/` and `docs/evidence/` live in the author's private evidence directory and are not shipped, and `case-study/` stays in the private repo. Each one names its re-verify command in its header.
