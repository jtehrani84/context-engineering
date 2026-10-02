<!-- built from docs/src/07-decision-log.md for the public edition at tools commit b4534e3 -->
# Decision Log

One entry per decision that set how the voice system behaves today. Each entry gives the context, the decision, the evidence, the date and commit, and what would reopen it. Numbers here are the measurements recorded in the named evidence files at the commits named; the current counts are in [Calibration and Evidence](06-calibration-and-evidence.md), filled from the facts file at b4534e3. Past values in this chapter are history and are not expected to match a fresh run.

A decision is reopened by new evidence of the kind its entry names. Changing a decision means a new entry with its own evidence, and the old entry stays.

Some evidence files sit in the author's private evidence directory and are cited by name only. Measurements of private writing alone are left out of this edition. Some control-set counts below are pooled over public and private sets; those say so, and the private share is not broken out.

## Summary

| Id | Decision | Date | Commit |
|---|---|---|---|
| D1 | Cadence checks scale with document length above a crossover | 2026-10-01 | 96a4a66 |
| D2 | Rule C narrowed from seven pinned structures to one phrase | 2026-10-01 | 1de0ab1 |
| D3 | Cadence penalty capped, then taken out of the score | 2026-10-02 | eb21f5c, 05da726 |
| D4 | The judge is never the drafter's vendor | 2026-09-29 | 9fe9f5d |
| D5 | Juror panel chosen by drafter vendor; a lone juror cannot reject | 2026-10-02 | 1858a48 |
| D6 | Text is normalized before every scan | 2026-10-02 | 5813fd1, ca26e8a, c0bf840 |
| D7 | Unicode tag characters stripped and decoded | 2026-10-02 | bc1a378 |
| D8 | Scorer and send hook fail closed | 2026-10-02 | 892b20b, 1763892, 4f7daef |
| D9 | HTML cleanup and text scans run in linear time | 2026-10-02 | 98b6adc |
| D10 | The stated ceiling: deliberate mimicry is out of reach | 2026-09-21 | (documentation) |
| D11 | The human false-positive budget is a standing gate | 2026-10-02 | c8c713b |

## D1. Cadence Checks Scale With Document Length

- **Date and commit:** 2026-10-01, 96a4a66. 8010a94 added an environment override for the crossover.
- **Context:** The cadence checks count sentence-rhythm patterns: runs of short sentences, colon reveals, scheduled fragments and similar. As fixed counts they fired more often the longer a document got, so long human documents collected penalties that short ones did not.
- **Decision:** At or below a crossover length nothing changes. Above it, each count threshold becomes a density: the count must reach max(N, N x words / crossover).
- **Evidence:** `VERDICT.md` (crossover sweep) and `decide/DECISION.md`.
- **Reopen if:** a modern human long-form set (business memos, for example) shows the crossover is in the wrong place, or a new long-AI set gains catches at a higher crossover on more than two of the six long-draft prompt topics.

The cadence checks live in the author's personal overlay, which the starter kits ship blank, so the thresholds and the crossover value are not reproduced here. The engine mechanism (count thresholds that become densities past a crossover) applies to any overlay that defines cadence checks.

## D2. Rule C Narrowed From Seven Pinned Structures to One Phrase

- **Date and commit:** 2026-10-01, 1de0ab1. The original rule C came in dc5bc08.
- **Context:** Rule C lets a pinned structure reject in the gate on its own, without a score. It started with seven structures. A pin that rejects on its own has to cost zero real people, and the seven did not meet that.
- **Decision:** Pin one phrase, a candor label, with an explicit `verdict: true` flag. The other six keep their severities, so the send hook still blocks them; in the gate they print as must-fix.
- **Evidence:** `VERDICT.md` (first pass, seven types to two), `decide/DECISION.md` (final, seven to one), `decide/test-results.json`, `decide/ngram/summary.txt` (Google Books Ngram lookups; no corpus text was sent).
- **Reopen if:** a modern (2020s) human business-email corpus contains the phrase, or the phrase is widened by a word.
- **Limits:** the three AI catches are in-sample and come from two of 16 prompt topics. A drafter that holds the same ban list avoids the phrase by construction, so the pin is a tripwire for drafts written without the rules.

The standing budget fails if the pinned phrase hits any human document. The run in the facts file (measured at b4534e3 on 2026-10-02) rejected 0 of the 18,335 public documents for any reason.

## D3. Cadence Penalty Capped, Then Taken Out of the Score

- **Date and commit:** 2026-10-02. eb21f5c capped the cadence penalty; 05da726 set its weight to 0 by default (`--cadence-weight` restores the capped weighting). 1e0ba0b and 6209756 made the adjusted score count only the detector categories that held up as AI evidence.
- **Context:** Cadence points were added to the score on 2026-09-28 and 2026-09-29, after a Gemini point-of-view draft scored 1 out of 100 on the detector while two judges rated it 78 to 91 (`case-study/RESULTS.md`). The added points then became the main source of rejects on human text.
- **Decision:** Cadence findings still print as must-fix in the scorer and the gate, but add 0 points to the score by default. The send hook does not read them.
- **Evidence:** `recal/FINAL.md` (with `recal/CADENCE.md`, `recal/CLASSIFY.md`, `recal/cadence-change.diff`) and `judge/JUDGE.md`. The cap was chosen on a pre-registered tune half and scored once on an author-disjoint held-out half.
- **Cost:** one fresh-AI catch on the deterministic layer is lost, and a Gemini point-of-view case-study draft moves from REJECT to INCONCLUSIVE in det-only mode, so the judges have to catch it.
- **Reopen if:** a tune and held-out split on a new generation run shows cadence separating AI drafts from human documents at matched length, or the owner wants cadence back in the score (one flag).

## D4. The Judge Is Never the Drafter's Vendor

- **Date and commit:** 2026-09-29, 9fe9f5d (cross-vendor gestalt gate), tidied in 824cb27; evidence committed in d0aed68.
- **Context:** A model grading its own vendor's writing may be lenient on it. The first version of the gate let the drafting model judge.
- **Decision:** Every juror comes from a vendor other than the drafter's. The drafter is named on the command line, or treated as unknown.
- **Evidence:** `case-study/RESULTS.md` and `case-study/calibration-2026-09-29.json`. The drafts are generated text about a fictional company, Cascade Outdoor Co. A controlled two-by-two: Gemini and Opus each drafted an account playbook and a point-of-view document (n = 4 documents).
- **Reopen if:** a larger, blinded run comparing same-vendor and cross-vendor judging shows no bias.

| Judge | Gemini Drafts | Opus Drafts |
|---|---|---|
| Opus, grading both (mean AI-ness) | 74 | 62.5 |
| Blind neutral judge (mean AI-ness) | 87 | 87.5 |

Opus rated both vendors' drafts as less AI-like than the neutral judge did: 13 points lower on the Gemini drafts and 25 points lower on its own. The 12-point difference between those two gaps is the self-bias figure. With n = 4 and one prompt pair, this shows the effect exists. It has no interval, so it says little about the size. In a draft, gate and regenerate loop, both vendors' drafts scored 82 to 85 over three attempts and were rated clockable by both jurors on every attempt; none was admitted.

## D5. Juror Panel Chosen by Drafter Vendor; a Lone Juror Cannot Reject

- **Date and commit:** 2026-10-02, 1858a48 (panel and lone-juror fix); f53d80d set the prompt fence per juror.
- **Context:** The previous panel caught 26 of 94 drafts from Anthropic models. Its Gemini juror was weak on Anthropic text (AUC 0.83 on Opus drafts). Separately, four documents had ended with one surviving juror, and "unanimous" had been computed over that one survivor.
- **Decision:** Anthropic, human and unknown drafters get Grok and GPT. Google drafters keep Grok and Claude. xAI drafters get Gemini and Claude. OpenAI drafters get Grok and Gemini. The remaining juror is a spare asked only when one errors, and with fewer than two answers the panel cannot reject.
- **Evidence:** `judge/JUDGE.md`, pre-registered in `judge/holdout-prereg.json` and `judge/gpt-prereg.json`; the change itself is `judge/proposed-prose-gate.diff`. 400 human documents from the public corpora and 154 generated AI drafts.
- **Reopen if:** a held-out AI set shows the new panel's recall collapsing, access to the GPT juror is lost, or a human-labeled validation set disagrees with the judges.

Numbers. The new panel caught 49 of 94 Anthropic drafts against 26, with 0 of 400 human rejects (0 of 200 in-sample, 0 of 200 held out; 95% upper bound 0.95% to 1.0%). A second sample gave 49 of 94 again against 33 for the old panel; 45 drafts were caught in both samples by the new panel and 22 by the old. On the 94 Anthropic drafts, verdict flips between the samples were 8.5% for the new panel and 16.0% for the old. Over all 154 AI drafts, recall went from 78 (50.6%) to 101 (65.6%); on 30 adversary drafts written under the anti-AI rules, from 7 to 13. Repeat runs of the old panel changed 0 of 200 human verdicts and 12.3% of AI gestalt calls. The GPT juror returned 0 errors in 938 calls, with a median of 8 seconds.

Limits. The AI side has no held-out set, and the Gemini swap was chosen after watching Gemini miss the same 94 drafts. More than half of the jurors' "not AI" calls on human documents cite the date or medium, so 0 of 400 is optimistic for a modern writer. The polished 18F posts scored highest and produced both single-juror "clockable" calls.

## D6. Text Is Normalized Before Every Scan

- **Date and commit:** 2026-10-02. 5813fd1 added `text-normalize.mjs` (NFKC, invisible and bidi characters removed, look-alike letters folded, quote, dash and space variants unified, emphasis markers removed). ca26e8a made the pin and the injection check also read the rendered text. c0bf840 fenced judged text as data and made text addressed to a grader reject before any judge is called.
- **Context:** A separate verification run tested the claim that a tell cannot be hidden by typing it differently, against commit 3eea922, and found it false. All 24 crafted spellings of the pinned phrase got past the pin, and all 9 obfuscated spellings of known injection wordings got past the injection check. The send hook's word list had the same gap: a blocked word typed with a Cyrillic letter or a zero-width space passed until 4f7daef (D8).
- **Decision:** Every scan reads canonical text. The overlay and the injection check get `normalizeForScan`, the detector gets a lighter form because it counts some of these characters itself, and the pin and injection check also see `renderedView`.
- **Evidence:** the 2026-10-02 apply report and verification report, with the attack table, and the attack suite the verification run used.
- **Reopen if:** a new spelling class gets past the pin or the injection check in the attack suite.
- **Limits:** an injection worded in a way the pattern list does not cover still passes the deterministic check by design; the prompt fence and juror behavior are the backstop. Normalization is a fixed table (572 confusables from Unicode UTS #39 v18.0.0) and proves nothing about characters outside it.

Numbers. After ca26e8a all 24 spellings and all 9 injections are caught. Normalization changed exactly one document in the test sample (a curly apostrophe in an 18F post). In a live run, seven injections in wordings the patterns do not list were each run on two panels, and no juror followed them. The scorer suite went from 13 to 15 cases and the gate unit suite from 90 to 110.

## D7. Unicode Tag Characters Stripped and Decoded

- **Date and commit:** 2026-10-02, bc1a378 (landed by the verification run as a fast-forward), with a follow-up in ca26e8a.
- **Context:** Unicode tag characters (U+E0000 to U+E007F) render as nothing, but a model reads them. An override instruction encoded as tag characters displayed as 32 visible characters, passed the injection check and reached the judges. The Gemini juror read the hidden payload, which shows the channel exists; no juror obeyed it. A single tag character inserted into a word also hid every overlay tell.
- **Decision:** Tag characters are removed in every scan. `revealTags()` decodes them into the ASCII they spell for the injection check, and the judges get the stripped text.
- **Evidence:** the apply report addendum and verification report items 14 and 15 (2026-10-02).
- **Reopen if:** another invisible-character class carries text to a model. The interlinear annotation anchor (U+FFF9) also passed on 3eea922 and is the first candidate to test.

Numbers. After the fix the smuggled text returns REJECT with the reason "judge-directed injection (hidden-override-instructions)", exit 2, and no judge is called. The gate unit suite went from 90 to 94 cases with this change. None of the 39,492 test documents (a pooled control set that includes private sets) contains a tag character.

## D8. Scorer and Send Hook Fail Closed

- **Date and commit:** 2026-10-02. 892b20b: a broken scorer makes the gate return ERROR (exit 4), never ADMIT. 1763892: a 120-second scorer timeout with SIGKILL, so a hang is also ERROR. 4f7daef: the send hook fails closed and normalizes its word list.
- **Context:** With the scorer printing `{}` and stand-in judges answering NO, the old gate returned ADMIT and exit 0 on text it had never scored. A real hang also happened: `gate-eval.mjs` waited 12 minutes on a scorer child process blocked on stdin. In the old hook, a scorer error or a 20-second timeout made the scan return nothing and dropped every structure check, so a pinned phrase that should block went out.
- **Decision:** In the gate, any scorer failure is ERROR (exit 4) and no judge is called. In the hook, any scorer or normalizer failure denies a send, adds a visible warning to a file write, and unreadable hook input exits 2.
- **Evidence:** the apply report steps 6 and 6b, verification report items 11, 12 and 18, and the final line of the hook-fix workflow journal (2026-10-02).
- **Ordering dependency:** the hook calls the `text-normalize.mjs` CLI. Against an older tools checkout it denies every send by design, so tools and hook have to move together.
- **Reopen if:** fail-closed denies block legitimate sends often enough to matter, for example scorer timeouts under load. The tuning points are the hook's scorer timeout, 20 seconds by default and at most 40 through `VOICE_SCORER_TIMEOUT`, and the gate's scorer timeout of 120,000 ms.

Numbers. The verification run broke the scorer 13 ways (throw, syntax error, non-JSON output, empty output, `{}`, a string score, a null score, no issues list, an issue with no type, a JSON array, exit 1 after valid JSON, a hang, a missing detector). All 13 gave exit 4 and 0 judge calls, both judged and in det-only mode. The new hook suite had 77 cases at 4f7daef, 65 of which fail against the old hook; 2ce7f40 took it to 99 and the D4 fixes on the docs branch to 115. The scorer suite went from 15 to 20 cases. The old and new hooks gave the same decision on all 39,522 control documents (a pooled set that includes private sets; 359 blocks, the same at four commits: 8010a94, 3eea922, bc1a378, ca26e8a).

## D9. HTML Cleanup and Text Scans Run in Linear Time

- **Date and commit:** 2026-10-02, 98b6adc. The same commit gave `text-normalize.mjs` its CLI.
- **Context:** The scorer's HTML-to-prose step used a lazy match for script blocks. On 32,000 unclosed script tags (288 KB) it took 2 seconds (verification report item 19; the commit message of 98b6adc measured 2.8 seconds on 40,000 tags at ca26e8a), and the time grew with the square of the input, so a crafted input could in principle exceed the hook's scorer timeout and turn every send into a fail-closed deny.
- **Decision:** HTML reduction, emphasis removal, and the metric and aphorism scans all run in linear time. The verification run had already made the new rendered view linear (40,000 unclosed tags in 1 ms).
- **Evidence:** verification report item 19 and its rendered-view section, and the hook-fix workflow result (2026-10-02). The inputs are synthetic.
- **Reopen if:** a new scan's regular expression shows super-linear time on adversarial input.

Hook decisions were unchanged on the 39,522 control documents (pooled, including private sets).

## D10. The Stated Ceiling: Deliberate Mimicry Is Out of Reach

- **Date:** 2026-09-21 (`VOICE-SYSTEM.md`, "The ceiling"). Re-confirmed 2026-09-29 (d0aed68) and 2026-10-02 (adversary set).
- **Context:** A detector that passes text can be read as vouching for who wrote it. The system was tested against a model told to imitate a specific writer.
- **Decision:** The docs describe a pass as "not obviously AI." A pass never means "written by this person." Authorship is a provenance question (who typed the text), outside what a detector can answer.
- **Evidence:** `VOICE-SYSTEM.md` "The ceiling", `case-study/calibration-2026-09-29.json`, `judge/JUDGE.md`.
- **Reopen if:** a provenance control is added, or a mimic-resistant judge passes a held-out mimic set.

Numbers. Mimicry recall on the frozen mimic set was 0 of 11 with a three-judge consensus (Wilson 95% interval 0 to 0.26; 0 under leave-one-out). A stylometry check that caught 11 of 11 was measuring length, since "more than 40 words" also catches 11 of 11 (the mimic passages were about seven times longer than the real writer's samples). The 2026-09-29 corpus run (n = 5 per class, snippets of about 60 words) had 1 false positive in 10 human snippets, caught 3 of 5 plain AI snippets and 0 of 5 mimics. On the 2026-10-02 adversary set (n = 30), panel recall was 23% to 43% depending on the panel.

## D11. The Human False-Positive Budget Is a Standing Gate

- **Date and commit:** 2026-10-02, c8c713b.
- **Context:** Until this commit, human false-positive rates were measured in one-time studies for each change (D1 to D3). No check ran on later changes, so a change could raise human rejects again without anyone seeing it.
- **Decision:** `calibration/fetch-public-corpora.sh` pins the public corpora (18F @ 292605ab, PEPs @ f2f542d, 18 RFCs, the 20 Newsgroups tarball) with a sha256 per file, and `calibration/human-fp-budget.mjs` fails when human rejects exceed the recorded baseline plus a small margin, or when a pinned tell or injection pattern hits any human document. Every guard change has to pass it and `gate-eval.mjs`.
- **Evidence:** the baseline `calibration/human-fp-budget.json`, measured 2026-10-02T05:07:45Z at tools commit 892b20b. The run in the facts file: 0 rejects in 18,335 public documents (measured at b4534e3 on 2026-10-02).
- **Why this replaced the tune-gain rule for verdict-only changes:** the harness evaluation measures raw score and flag counts, so a change that only moves a verdict (a pin, a bar, which checks count) reads as zero gain there and can neither pass nor fail it.
- **Reopen if:** a corpus becomes unavailable at its pinned version, or a modern human corpus is added and the budget has to cover it.

The detector itself was also run on the newer upstream commit bdeb726: the public budget still showed zero rejects. The pin stays at 58a95fc because about 1,350 lines of the detector's pattern file changed upstream.
