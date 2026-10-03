<!-- built from docs/src/07-decision-log.md for the public edition at tools commit c558a2f -->
# Decision Log

One entry per decision that set how the voice system behaves today. Each entry gives the context, the decision, the evidence, the date and commit, and what would reopen it. Numbers here are the measurements recorded in the named evidence files at the commits named; the current counts are in [Calibration and Evidence](06-calibration-and-evidence.md), filled from the facts file at c558a2f. Past values in this chapter are history and are not expected to match a fresh run.

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
| D12 | A lone banned word, or a message that opens with a link, is scanned | 2026-10-02 | branch hook-holes-2026-10-02 |
| D13 | The send hook walks deep input or fails closed | 2026-10-02 | branch hook-holes-2026-10-02 |
| D14 | The "As [Company]" sentence opener blocks a send | 2026-10-02 | branch hook-holes-2026-10-02 |
| D15 | "As <Name>" blocks only company voice or a listed company; other names nudge | 2026-10-02 | 31c0e5e |
| D16 | Inflected forms of the banned words block or nudge by how often real writers use them | 2026-10-02 | 5a2da8f |
| D17 | A draft file is checked at any length | 2026-10-02 | 6f47795 |
| D18 | Drafts shown in chat are checked when the reply ends, and the check never traps the session | 2026-10-02 | 4ba9bca, 108a223, 8f65732 |
| D19 | Company voice is read more closely both ways, and the send gate reads the rendered view | 2026-10-02 | 2bb9610, 0cd10e0 |
| D20 | The installer keeps what you set, says what it dropped, and can remove itself | 2026-10-02 | fdc0365, 2260629 |
| D21 | A suffix's period belongs to the name, and the draft gate's Stop entry can't trap a session | 2026-10-03 | 5b78b16, f0044d7 |

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

The standing budget fails if the pinned phrase hits any human document. The run in the facts file (measured at c558a2f on 2026-10-03) rejected 0 of the 18,335 public documents for any reason.

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

Numbers. The verification run broke the scorer 13 ways (throw, syntax error, non-JSON output, empty output, `{}`, a string score, a null score, no issues list, an issue with no type, a JSON array, exit 1 after valid JSON, a hang, a missing detector). All 13 gave exit 4 and 0 judge calls, both judged and in det-only mode. The new hook suite had 77 cases at 4f7daef, 65 of which fail against the old hook; 2ce7f40 took it to 99 and the D4 fixes on the docs branch to 115, and the D12 to D14 changes to 176. The scorer suite went from 15 to 20 cases. The old and new hooks gave the same decision on all 39,522 control documents (a pooled set that includes private sets; 359 blocks, the same at four commits: 8010a94, 3eea922, bc1a378, ca26e8a).

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
- **Evidence:** the baseline `calibration/human-fp-budget.json`, measured 2026-10-02T05:07:45Z at tools commit 892b20b. The run in the facts file: 0 rejects in 18,335 public documents (measured at c558a2f on 2026-10-03).
- **Why this replaced the tune-gain rule for verdict-only changes:** the harness evaluation measures raw score and flag counts, so a change that only moves a verdict (a pin, a bar, which checks count) reads as zero gain there and can neither pass nor fail it.
- **Reopen if:** a corpus becomes unavailable at its pinned version, or a modern human corpus is added and the budget has to cover it.

The detector itself was also run on the newer upstream commit bdeb726: the public budget still showed zero rejects. The pin stays at 58a95fc because about 1,350 lines of the detector's pattern file changed upstream.

## D12. A Lone Banned Word, or a Message That Opens With a Link, Is Scanned

- **Date and commit:** 2026-10-02, branch hook-holes-2026-10-02 (the commit that adds D12 to D14). The author decided all three that day.
- **Context:** The send hook skips strings that look like plumbing. Its ID rule was "8 or more letters, digits or underscores, no space", so a message that was only "seamless" or "Transformative" counted as an ID and went out unscanned. Its URL rule matched any string that started with `http://` or `https://`, so "https://... Our seamless rollout lands Thursday." was skipped whole.
- **Decision:** An ID-shaped string is skipped only when it isn't a `BLOCK_WORDS` or `NUDGE_WORDS` entry, in any case and with paired `_emphasis_` underscores (the canonical view strips those). It then gets the verdict it would get in a sentence: a block word denies the send, a nudge word nudges. Hex ids, record ids, base64 tokens, snake_case keys and timestamps are still skipped. A string is skipped as a URL only when it is one URL with no whitespace.
- **Evidence:** hook group D5. Before the change, the lone-word, nested lone-word and link-first cases failed; the real-ID cases passed both before and after.
- **Reopen if:** a real ID that is also a lexicon word turns up in a send payload (a field holding just "paradigm", say), or a link-first message turns out to be plumbing in some tool's input.

Numbers. On the 39,492 control documents, none starts with a link and carries more text, so the URL change moves no decision there; the lone-word rule can't apply to a whole document. With D13 and D14, the hook suite went from 115 to 176 cases, and 24 of the first 59 new cases failed on the hook before the change.

## D13. The Send Hook Walks Deep Input or Fails Closed

- **Date and commit:** 2026-10-02, branch hook-holes-2026-10-02.
- **Context:** The hook collected text from a send's input recursively and stopped at depth 7, so a banned word 8 or more levels down was never scanned, and the send went out.
- **Decision:** The hook walks the input with an explicit stack, so a deep payload can't reach Python's recursion limit, down to `HARVEST_MAX_DEPTH` (100) levels and `HARVEST_MAX_NODES` (200,000) values. Past either limit the input is unscannable: a send is denied with a message that says so, and a file write whose content isn't a string gets a warning. Plumbing keys and the ID and URL rules apply as before.
- **Evidence:** hook group D5: a banned word 12 and 60 levels deep is denied, a clean note 20 levels deep goes out, and a clean note 150 levels deep, a 10,000-deep list and 250,000 values in one send are denied as unscannable (the 10,000-deep case in well under a second, with no traceback). A 10,000-deep structure as a file's content gets the warning.
- **Reopen if:** a real tool's input nests past 100 levels or holds more than 200,000 values, so legitimate sends start failing closed.

## D14. The "As [Company]" Sentence Opener Blocks a Send

- **Date and commit:** 2026-10-02, branch hook-holes-2026-10-02.
- **Context:** The author's ban list forbids starting a sentence with "As [Company]". The overlay's structure for it matches only a lowercase mid-sentence "as" (Review Packet, Open Decisions, item 1), so the sentence opener went out.
- **Decision:** The hook's lexicon flags "As" plus a capitalized name of one to four words at the start of the text, a line, a list item or a sentence ("As Acme Corp grows, we..."). It is a hard ban on a send and a nudge on a write, like the other block phrases, and the message says to drop "As" and lead with the name. It does not fire on attribution, a speech or finding verb within the next four words ("As Dana said", "As Gartner reports", "As Dana and I discussed", "As Marc put it"; after an appositive the whole sentence is read). It also skips pronouns and articles ("As I", "As a"), the stock openers ("As of", "As soon as", "As far as", "As long as", "As well", "As such", "As expected", "As noted"), roles ("As CEO, she..."), months, days and reporting periods. "As AI ..." does not fire: the rule is about companies, and AI is not one, so a generic "As AI agents take on more work" opener is left to the scorer.
- **Evidence:** hook group D5: 9 openers that are denied, a 40,000-line send of them denied in under 3 seconds, one nudge on a written file, and 27 silent cases. Control documents, the hook's lexicon in-process on raw text, local, counts only: the opener appears in 59 of the 39,492 control documents (pooled, including private sets) and in 0 of 124 fresh AI drafts and 0 of 43 earlier AI drafts. In the public sets it appears in 35 of 18,492 documents: 18F 4 of 421, PEPs 9 of 576, RFCs 1 of 18, 20 Newsgroups 20 of 17,320, python-dev 1 of 157. Most are "As" plus a name and a verb, meaning while or because ("As NASA approached full HTTPS deployment"); people's names in narrative are a smaller share, because a regex can't tell a person from a company. The real hooks, old and new, run as sends on 170 documents from the public sets: the 150 drawn at random got identical decisions, and of 20 documents with an opener, 17 moved to deny (12 from pass, 5 from a nudge) and 3 were already denied.
- **Reopen if:** the opener blocks the author's own sends, a common attribution or role form is missing from the lists, or a corpus of AI drafts shows it should cover "As AI".
- **Narrowed by D15** the same day: a send is now denied only for company voice or a listed company, and every other name in the opener nudges.

The block is a voice-law decision, not a measured catch: no AI draft in the evaluation sets uses the form, so its recall on AI text is unmeasured.

## D15. "As <Name>" Blocks Only Company Voice or a Listed Company

- **Date and commit:** 2026-10-02, 31c0e5e (branch hook-holes-2026-10-02). The author decided it the same day, after reading what D14 blocked.
- **Context:** D14 denied every sentence that opened "As" plus a capitalized name. On the 19,870 local public documents (18F, PEPs, RFCs, 20 Newsgroups, unprocessed) the D14 check found 45 openers in 43 documents, and only a handful named a company: most were people ("As Vernon slid back in to the crease", from a 20 Newsgroups hockey post), products, places and agencies, used in an ordinary "as" clause meaning while or because.
- **Decision:** A send is denied when the opener is company voice, the name and then, after an optional comma, a bracketed aside and an optional appositive, a first-person main clause ("As Globex, we ...", "As Globex our team ...", "As Globex, a leader in X, we ..."), or when the name is on the company list. The list is 22 large companies built into the hook (`COMPANY_NAMES`: Google, Alphabet, Microsoft, Amazon, AWS, Apple, Meta, Facebook, OpenAI, Anthropic, Oracle, SAP, IBM, Adobe, ServiceNow, Workday, HubSpot, Snowflake, Databricks, Nvidia, Intel, Cisco), none of them a product of the author's employer, plus the names in the per-user file `~/.claude/voice/company-names.txt` or the file `VOICE_COMPANY_NAMES` names. Names match on whole words, in any case, with a possessive and a trailing Inc, Corp, Co, Ltd, LLC, plc, GmbH or AG ignored; a longer name that only starts with a listed one ("As Google Cloud matures") is not a match. Every other opener D14 matched is a nudge, "consider leading with the subject", and the send goes out. The D14 exemptions (attribution, Title Case headings, name lists, the "who ... says" case) now decide only between a nudge and silence for other names; they never excuse company voice or a listed name, so "As Globex, We Want Every Rep To Close Faster" and "As Globex, we said last week, ..." block. What makes a word not a name stays in front of every check: pronouns, the stock openers, months, roles ("As SEs, we ..." speaks as a role) and titles. A line starting `!` in the names file is a name that is never a company: its other openers are silent, and company voice still blocks. A missing file means the built-in list; a file that can't be read keeps the built-in list and adds a visible note to the hook's message, and never blocks a send by itself. The two event names D14 exempted in the code moved out of it, so the hook ships with no product name of the author's employer.
- **Evidence:** hook group D6 (red run 30 of 336 cases failing before the change, all passing after): company voice in nine shapes, five exemption-shaped lines that are company voice, seven listed-company openers including a possessive, a suffix and capitals, nudges for a person, a non-first-person clause and an unlisted product, the names file with comments, `!` lines, an override path, a missing file, a directory, bad UTF-8 and a 3.6 MB file read only up to its cap, and a check that the hook and both test suites name no product of the author's employer. The opener check alone on raw text, documents with a hit, D14 (a529eb7) against D15, block and nudge:

| Set | Documents | D14 blocks | D15 blocks | D15 nudges |
|---|---|---|---|---|
| 18F | 429 | 10 | 1 | 9 |
| PEPs | 576 | 9 | 0 | 9 |
| RFCs | 18 | 1 | 0 | 1 |
| 20 Newsgroups | 18,847 | 23 | 0 | 23 |
| Business email (private, counts only) | private | 16 | 4 | 12 |
| The author's samples (private, counts only) | 119 | 0 | 0 | 0 |
| AI drafts | 43 | 0 | 0 | 0 |

  The one public block was read here as the agency writing as itself; the D19 review found it was not: it is "As 18F, the U.S. Digital Service and other agencies develop these resources, we ...", a list of subjects in an ordinary as-clause, and it is a nudge since D19. The four in the business email are company voice (a pronoun right after the name). No built-in company name opened a sentence in any set, so the list added no block there.
- **Reopen if:** a company-voice block fires on writing the author would send, a common company is missing from the built-in list, or a built-in name keeps blocking a sentence about something else (the list's limits are Threat Model, Open Gaps, item 10).

## D16. Inflected Forms of the Banned Words Block or Nudge by How Often Real Writers Use Them

- **Date and commit:** 2026-10-02, 5a2da8f (branch hook-holes-2026-10-02). The author set the rule the same day.
- **Context:** The hook's word list matched base forms only, so "seamlessly", "utilized", "synergies" and "bolstered" went out, and "well positioned" with no "to" after it did too.
- **Decision:** Every candidate form of a block word (-s, -ed, -ing, -ly, -ies, the -ize and -ise spellings, spaced and hyphenated variants), 60 in all, was counted as documents containing it in the public sets, the business email, the author's samples and the AI drafts. A form blocks like its base when it is in at most two public documents and three business emails (the human false-positive budget's margins for those sets) and in none of the author's samples; otherwise it nudges. The -ise spellings follow their -ize twin, because the sets are mostly American English and a low British count isn't evidence of rarity. "tapestries" nudges by judgment: the plural is nearly always the wall hanging. The result is 38 forms that block and 28 that nudge. The 34 forms of the nudge words ("leveraged", "unlocking", "deep dive") nudge, as their base words do. Phrases: "well positioned" blocks with or without "to" (0 human documents without it), "it was worth noting", "ushers in a new era", "ushered in a new era" and "moves the needle", "moved", "moving" block (0 each), and "it is worth noting" nudges (10 public documents) through a new `NUDGE_PHRASES` list. No existing block changed.
- **Evidence:** hook group D7 (red run 106 of 450 cases failing, all passing after), one case per form plus the phrases, lone words, a look-alike spelling and six near-miss sentences that stay silent. On the word list alone, documents newly blocked: 9 of the 19,870 public, 4 in the business email, none of the author's samples and none of the AI drafts. `human-fp-budget.mjs` and `gate-eval.mjs` pass unchanged: they measure the gate, which doesn't read the hook's word list. The forms:

| Form | Base | Public docs | Private sets (pooled) | AI drafts | Decision |
|---|---|---|---|---|---|
| `delves` | `delve` | 1 | 0 | 0 | block |
| `delved` | `delve` | 3 | 0 | 0 | nudge (public) |
| `delving` | `delve` | 9 | 0 | 0 | nudge (public) |
| `streamlines` | `streamline` | 2 | 0 | 0 | block |
| `streamlined` | `streamline` | 29 | 5 | 0 | nudge (author sample) |
| `streamlining` | `streamline` | 14 | 7 | 0 | nudge (public) |
| `seamlessly` | `seamless` | 11 | 0 | 2 | nudge (public) |
| `utilizes` | `utilize` | 12 | 2 | 0 | nudge (public) |
| `utilized` | `utilize` | 13 | 21 | 0 | nudge (public) |
| `utilizing` | `utilize` | 26 | 15 | 0 | nudge (public) |
| `utilization` | `utilize` | 24 | 14 | 0 | nudge (author sample) |
| `utilise` | `utilize` | 4 | 0 | 0 | nudge (public) |
| `utilises` | `utilize` | 0 | 0 | 0 | nudge (follows `utilizes`) |
| `utilised` | `utilize` | 0 | 1 | 0 | nudge (follows `utilized`) |
| `utilising` | `utilize` | 0 | 0 | 0 | nudge (follows `utilizing`) |
| `utilisation` | `utilize` | 2 | 0 | 0 | nudge (follows `utilization`) |
| `synergies` | `synergy` | 1 | 5 | 0 | nudge (business email) |
| `synergistic` | `synergy` | 1 | 0 | 0 | block |
| `synergize` | `synergy` | 0 | 0 | 0 | block |
| `synergizes` | `synergy` | 0 | 0 | 0 | block |
| `synergized` | `synergy` | 0 | 0 | 0 | block |
| `synergizing` | `synergy` | 0 | 0 | 0 | block |
| `synergise` | `synergy` | 0 | 0 | 0 | block (follows `synergize`) |
| `synergised` | `synergy` | 0 | 0 | 0 | block (follows `synergized`) |
| `paradigms` | `paradigm` | 9 | 1 | 0 | nudge (public) |
| `transformatively` | `transformative` | 0 | 0 | 0 | block |
| `ground-breaking` | `groundbreaking` | 1 | 0 | 0 | block |
| `spearheads` | `spearhead` | 0 | 0 | 0 | block |
| `spearheaded` | `spearhead` | 3 | 1 | 0 | nudge (public) |
| `spearheading` | `spearhead` | 0 | 2 | 0 | block |
| `bolsters` | `bolster` | 6 | 0 | 0 | nudge (public) |
| `bolstered` | `bolster` | 0 | 0 | 0 | block |
| `bolstering` | `bolster` | 3 | 0 | 0 | nudge (public) |
| `fortifies` | `fortify` | 0 | 0 | 0 | block |
| `fortified` | `fortify` | 8 | 1 | 0 | nudge (public) |
| `fortifying` | `fortify` | 0 | 0 | 0 | block |
| `underpins` | `underpin` | 3 | 0 | 0 | nudge (public) |
| `underpinned` | `underpin` | 0 | 0 | 0 | block |
| `underpinnings` | `underpin` | 2 | 0 | 0 | block |
| `cornerstones` | `cornerstone` | 2 | 0 | 0 | block |
| `linchpins` | `linchpin` | 0 | 0 | 0 | block |
| `lynchpin` | `linchpin` | 0 | 0 | 0 | block |
| `lynchpins` | `linchpin` | 0 | 0 | 0 | block |
| `tapestries` | `tapestry` | 0 | 0 | 0 | nudge (judgment) |
| `multi-faceted` | `multifaceted` | 0 | 0 | 0 | block |
| `holistically` | `holistic` | 2 | 0 | 0 | block |
| `cutting edge` | `cutting-edge` | 7 | 2 | 0 | nudge (public) |
| `game changing` | `game-changing` | 0 | 1 | 0 | block |
| `game-changer` | `game-changing` | 1 | 0 | 0 | block |
| `game-changers` | `game-changing` | 0 | 0 | 0 | block |
| `game changer` | `game-changing` | 0 | 0 | 0 | block |
| `game changers` | `game-changing` | 0 | 0 | 0 | block |
| `best in class` | `best-in-class` | 0 | 1 | 0 | block |
| `world class` | `world-class` | 4 | 2 | 0 | nudge (public) |
| `state of the art` | `state-of-the-art` | 23 | 4 | 0 | nudge (public) |
| `mission critical` | `mission-critical` | 2 | 0 | 0 | block |
| `synergistically` (D19) | `synergy` | 0 | 0 | 0 | block |
| `seamlessness` (D19) | `seamless` | 0 | 1 | 0 | block |
| `lower-hanging fruit` (D19) | `low-hanging fruit` | 0 | 0 | 0 | block |
| `lowest-hanging fruit` (D19) | `low-hanging fruit` | 0 | 0 | 0 | block |
| `lower hanging fruit` (D19) | `low-hanging fruit` | 0 | 0 | 0 | block |
| `lowest hanging fruit` (D19) | `low-hanging fruit` | 0 | 0 | 0 | block |
| `next generation` | `next-generation` | 33 | 4 | 0 | nudge (public) |
| `next-gen` | `next-generation` | 2 | 1 | 0 | nudge (author sample) |
| `low hanging fruit` | `low-hanging fruit` | 1 | 0 | 0 | block |
| `table-stakes` | `table stakes` | 0 | 1 | 0 | nudge (author sample) |

- **Basis, and how to move a form:** the block-or-nudge call for each form rests mostly on older control sets (the 20 Newsgroups posts and the business email are decades old) plus the author's 119 samples, so a form that is common in today's writing can still block; to move one, edit `BLOCK_FORMS` or `NUDGE_FORMS` in `hook/voice-tell-gate.py`, re-run the calibration (`calibration/human-fp-budget.mjs`, whose hook lane counts the hook's deny documents, and `calibration/gate-eval.mjs`), and update the table above.
- **Reopen if:** a blocking form turns up in the author's own sends or in a new human corpus more often than the margins allow, or a nudging form shows up in AI drafts far more than in human writing.

## D17. A Draft File Is Checked at Any Length

- **Date and commit:** 2026-10-02, 6f47795 (branch hook-holes-2026-10-02).
- **Context:** A file write under 400 characters was skipped as too small to be an artifact, so a two-line reply saved to a drafts folder was never checked, though it was the message itself.
- **Decision:** A path with a folder named `drafts`, or a file name containing `draft`, in any case, is checked from 3 characters. Other files keep the floor, and only prose extensions are read, as before.
- **Evidence:** hook group D8 (red run 8 of 464 cases failing, all passing after): six draft paths with a short tell, a lone banned word, an Edit, a clean short draft, a two-character write, and four paths that stay skipped (an ordinary note, a folder that only starts with `drafts`, `.py` files).
- **Reopen if:** ordinary files with `draft` in the name (a design doc called `draft-plan.md`, say) draw nudges the author doesn't want.

## D18. Drafts Shown in Chat Are Checked When the Reply Ends, and the Check Never Traps the Session

- **Date and commit:** 2026-10-02, 4ba9bca and 108a223 (the draft gate, merged into branch hook-holes-2026-10-02), 8f65732 (wiring).
- **Context:** A draft Claude shows in chat for the user to copy out by hand goes through no tool call, so neither tier of the send hook sees it. No hook can stop chat text before Claude Code displays it.
- **Decision:** `hook/voice-draft-gate.py` runs on `Stop`. It reads the reply that just ended, finds the drafts (a `draft` fence, or the piece after a `Written for:` line when there is no fence), and scores only those with the send hook's `analyze()`, imported read-only. A hard tell blocks the stop, so Claude fixes the draft in the same reply; the user sees Claude Code's "Stop hook error occurred" label and a one-line note. A soft tell is a note. At most 2 blocks per reply. Any failure allows the stop with a "draft not checked" note, the one path in the system that fails open, because a Stop hook that failed closed would loop. `merge-hooks.mjs` wires it on `Stop` with matcher `""`, removes old entries for it, and writes `settings.json` back in its own layout; the doctor's `draft-gate-wiring` check fails when the entry or the script is missing.
- **Evidence:** the draft gate's own suite, groups F, S, L, X, M, P and R1 to R8 (an adversarial review found 23 problems; each has a test named for it), and three live headless runs on Claude Code 2.1.286 that showed a block reaching Claude as "Stop hook feedback" and the label reaching the user. The onboarding suite checks the wiring, the idempotent re-run and the layout. On a copy of the author's own settings, the merge changed only the voice entries.
- **Reopen if:** users lose drafts because the label reads as a crash, the block cap proves too low or too high, or Claude Code adds a way to hold chat text before it is shown.

## D19. Company Voice Is Read More Closely Both Ways, and the Send Gate Reads the Rendered View

- **Date and commit:** 2026-10-02, 2bb9610 and 0cd10e0 (branch hook-holes-2026-10-02), after two reviews of D15 to D18 (18 findings, each reproduced before it was fixed).
- **Context:** D15's company-voice test checked for a first-person word right after the comma, before it skipped an appositive, and it skipped only appositives that open with a determiner. So it read too much and too little. A person's name followed by a possessive appositive hard-blocked ("As Dana, our new AE, ramps up, ...", and "As Sam, my manager, said last week, ...", which was silent attribution at a529eb7), a heading and the next paragraph were read as one clause, and the one public block was a false positive ("As 18F, the U.S. Digital Service and other agencies develop these resources, we ..."). Meanwhile "As Globex, founded in 1985, we ...", a dash pair, a colon, an adverb and a five-word name only nudged. The send gate also missed "As \`Globex\`, we" and "As" at a line end, which the draft gate caught, though the docs said the two couldn't disagree.
- **Decision:** After "our" or "my" that follows the comma, the word after the appositive's closing comma decides: a word that continues a clause ("and", "which", a pronoun, a capital) keeps it company voice ("As Globex, our team ships on Fridays, and ..."); a lowercase verb is the as-clause's own, and the attribution check reads what follows. An aside with "and", "or" or "&" followed by "I", a determiner or a name and three or more words is a list of subjects, not an appositive; "a leader in data and AI" still is one. Before the first person the check now reads one aside of up to 12 words closed the way it opened (comma or dash), a colon, semicolon or ellipsis, an adverb, and up to three more capitalized words of a long name. A blank line, or a line break with no separator before it, ends the clause. "_As" and "~As" are openers, and an emoji or shortcode followed by a space ends a sentence. `analyze()` reads one more view, the text with backticks dropped and every whitespace run one space (`flat_view`); it adds words and opener blocks only, so it can't undo the heading exemption, and the draft gate now uses it from `analyze()`. The names file follows `CLAUDE_CONFIG_DIR`, a line past four words is skipped with a note, and a `!` line also takes a built-in name off the list. The draft gate shows the names-file note on every message. Six derivations D16 missed block (D16's table). Messages say "banned word", "banned phrase" and "banned opener", with no pointer to a private file. The author's rule stands where it covers a person: "As Dana, I think ..." blocks (Threat Model, Open Gaps, item 10).
- **Evidence:** hook group D9 (red run: 56 of 533 cases failing against 2ffab23, all passing after) and draft-gate group R9 (failing against 108a223's pair). The opener check alone, documents with a hit, D15 (2ffab23) against D19:

| Set | Documents | D15 blocks | D19 blocks | D15 nudges | D19 nudges |
|---|---|---|---|---|---|
| Public (18F, PEPs, RFCs, 20 Newsgroups, unprocessed) | 19,870 | 1 | 0 | 42 | 43 |
| Business email (private, counts only) | private | 4 | 4 | 12 | 12 |
| The author's samples (private, counts only) | 119 | 0 | 0 | 0 | 0 |
| AI drafts | 43 | 0 | 0 | 0 | 0 |

  The four business-email blocks each have a pronoun right after the name. The false-positive budget had no view of any of this: it scores with the engine, never the hook's lexicon. It now has a hook lane (`calibration/hook-lexicon.py`, counts only) that runs the hook's word list, opener check and flat view over the same cleaned documents and fails when a set's deny count passes its pinned baseline plus the budget's margin. Documents the send hook would deny, by commit (main 1520633, D14 a529eb7, D15 2ffab23, D19): 18F 75, 82, 78, 77 of 421; PEPs 32, 41, 36, 36 of 576; RFCs 7, 8, 7, 7 of 18; 20 Newsgroups 89, 104, 93, 93 of 17,320; business email 60, 75, 67, 67. The rise from main is the D7 forms and the D12 lone-word scan; D19 removed the one public opener block.
- **Reopen if:** an ordinary as-clause the author would send blocks, company voice written in a shape the two rules don't read only nudges in the author's own sends (Open Gaps, item 11), or the hook lane's baseline has to move for a reason nobody reviewed.

## D20. The Installer Keeps What You Set, Says What It Dropped, and Can Remove Itself; the Leak Check Reads Identifiers

- **Date and commit:** 2026-10-02, fdc0365 and 2260629 (branch hook-holes-2026-10-02).
- **Context:** `merge-hooks.mjs` dropped a `timeout` the user had set on a voice entry and any extra tool names in an old send matcher, without a word, and there was no way to take the voice entries out short of copying the backup back, which also undid every other settings change. The runbook promised "byte for byte" even for files the tool rewrites. Separately, the editions' leak check matched terms as whole words, and "_" is a word character, so a term inside an MCP tool name or a snake_case key passed it; the hook carried one such comment.
- **Decision:** A timeout on an old voice entry is carried to the new entry for the same event and script. Names an old exact-name send matcher listed that the new matcher doesn't cover are printed with the fix (add them to `sendTools`). `--remove` takes out every voice-tell-gate.py and voice-draft-gate.py entry on any event, backs up first, keeps the rest and the file's layout, and drops an event the removal emptied; a second run changes nothing. The runbook says when the bytes are kept. The leak check also scans each text with "_" read as a space. The hook and both suites now pass the public leak check, and the hook suite runs that check instead of a list of six words; two labels are allowed in the test files only, for the fixture that needs the author's overlay, and addresses at the reserved example domains are fixtures.
- **Evidence:** two new onboarding tests (timeout and dropped names; `--remove` on a 4-space file with mixed entries), one new docs-tools build test (four identifier shapes fail, a plain identifier doesn't), the D9 source test, and the merge run twice on a copy of the author's settings.
- **Reopen if:** a user needs a voice entry option the merge doesn't carry (anything besides `timeout`), or the kit scrubbers start reading identifiers themselves.

## D21. A Suffix's Period Belongs to the Name, and the Draft Gate's Stop Entry Can't Trap a Session

- **Date and commit:** 2026-10-03, 5b78b16 (the hook) and f0044d7 (the installer), branch hook-holes-2026-10-02, after a review of the hook holes (five findings, N1 to N5, each reproduced first).
- **Context:** "As Globex Inc., we ...", "As Globex Corp., we ..." and "As Acme Co., our ..." only nudged. The name parse reads the suffix as a word of the name and stops at its period, so the company-voice check saw "., we" and found no separator. Separately, `merge-hooks.mjs` wired the draft gate's `Stop` entry without checking that the script exists. `python3` on a missing file exits 2, and exit 2 on `Stop` blocks the stop, so a missing script could refuse every reply. In a headless check on Claude Code 2.1.286 the bare command did exit 2, but that build let the stop through with "Stop hook error occurred": it reads `python3`'s and `sh`'s missing-file errors as non-blocking, while the same exit 2 with other stderr blocked. So the trap depends on the build, and the user gets an unexplained error label either way.
- **Decision:** The period after a trailing suffix word (Inc, Corp, Co, Ltd, LLC, plc, GmbH, AG and the others the name key already drops) belongs to the name when the clause goes on after it, with a separator or a lowercase word ("As Acme Co. our team ..."). Before a capital it still ends the sentence, so "As Globex Inc. We ship ..." stays a nudge, and a sentence that starts after "Acme Inc." is still found. For the draft gate, two layers. `merge-hooks.mjs` doesn't add the `Stop` entry while the script isn't next to the send hook: it prints "skipped the Stop entry" on stderr with the `cp` that installs the script, still wires the send hook, takes out any old draft-gate entry, and exits 0, so a setup script that runs it goes on and the send hook, which fails closed, is wired either way. The `Stop` command it writes checks for the file first and, when it's missing, prints a `systemMessage` ("draft not checked: the draft gate script is missing ...") and exits 0. The doctor's `draft-gate-wiring` check fails until the script is installed and warns about a `Stop` command without the check. Two findings were wording: the getting-started guide and the names template now say a listed company blocks any opener ("As Apple pushed the update, ...") and that a `!` line exempts it, and Threat Model, Open Gaps, item 11 now says its list example is silent, not a nudge. No fix makes that example block: the list after "our" looks the same to the check as the possessive appositive D19 exempts for people ("As Dana, our new AE, ramps up"), and telling the two apart needs grammar the check doesn't read.
- **Evidence:** hook group D10 (red run 8 of 552 cases failing, all passing after), draft-gate group R10 (4 of 126 failing against the old send gate), and the onboarding suite (`doctor.test.mjs` 7 of 71 failing before; a new fixture, a merge with the script missing, and the guarded command run through `/bin/sh` with the script present and gone). The opener check alone, old against new, changed no document's openers: the 18,335 cleaned public documents 0 blocks and 35 nudges both times, the business email 4 and 12, the author's samples and the AI drafts 0. The hook lane matches its baseline. Live on Claude Code 2.1.286 (headless, a temporary settings file with `--setting-sources=local`, deleted after): the guarded command with the script missing exited 0 with the note and the reply ended in one turn; with the real gate present it ran and allowed the stop.
- **Reopen if:** a suffix spelled another way ("Incorporated.", "S.A.") keeps company voice at a nudge in the author's sends, a `Stop` command the doctor passes still blocks a reply when its script is missing, or a Claude Code release changes how `Stop` hooks read exit codes.
