<!-- built from docs/src/00-overview.md for the public edition at tools commit c558a2f -->
# Overview

The voice system is a set of local command-line tools and two Claude Code hooks that check prose for the patterns of generic AI writing: before a send, right after a prose file is written, and when Claude's reply ends with a draft in it. It scores text with fixed rules, can ask a panel of language models for a second opinion, and blocks a send when the text carries a hard-ban pattern. This chapter says what the system does, what it cannot do, and where to read next. Numbers in this edition come from a facts file written at tools commit c558a2f on 2026-10-03. A number recorded at an earlier commit names that commit where it appears.

## What the System Does

Five parts make up the system. The first four run on the text being checked; the fifth measures them.

1. **Normalization** (`text-normalize.mjs`). Every scan first reduces the text to a canonical form: invisible, bidirectional and tag characters removed, Unicode compatibility forms folded (NFKC), look-alike letters mapped to their Latin form, quote, dash and space variants unified, and emphasis markers stripped. A second view renders markup the way a reader sees it. These steps cover the character and markup tricks the test suites exercise (Threat Model); a spelling outside the tables can still hide a pattern.
2. **Deterministic scoring** (`aiscore.mjs`). The scorer runs a vendored open-source detector, pinned at commit 58a95fc, with 51 pattern categories, then a personal overlay of structural checks. Only 9 detector categories count toward `adjustedScore`, the number the gate rejects on; the rest print in the report with no weight. The scorer exits 0 whatever the score and leaves the decision to its callers; it exits non-zero only when it cannot run, for example on an unreadable input file.
3. **The gate** (`prose-gate.mjs`). The gate combines the deterministic score, a check for text addressed to a grader, and a panel of model judges into one verdict: ADMIT, REJECT, INCONCLUSIVE or ERROR. When the caller names the drafter with `--drafter`, no judge from the drafter's lab sits on the panel; with the default drafter, `unknown`, no lab is left out (Architecture, The Gate). With `--det-only` no judge is called and nothing leaves the machine.
4. **The send hook** (`voice-tell-gate.py`, versioned in the repo as `hook/voice-tell-gate.py`). A Claude Code hook runs the scorer on the send-tool calls its PreToolUse matcher reaches and on prose file writes. On a send it blocks hard-ban patterns; on a file write it only adds a note. If the scorer fails, the send is denied. `onboarding/merge-hooks.mjs` writes a matcher that reaches every configured send tool, and `voice-doctor.mjs` checks it (Architecture, The Send Hook). A second hook, the draft gate (`hook/voice-draft-gate.py`), runs when Claude's reply ends and checks the drafts that reply shows for someone else, with the send hook's own word list and scorer (Architecture, The Draft Gate).
5. **Calibration** (`calibration/`). Scripts measure how often the checks reject writing by people, using public corpora written before 2022, and hold that count to a stored budget.

## What the System Cannot Do

The system is built to catch generic AI writing while rejecting almost no human writing. It cannot catch AI text that deliberately imitates a particular person, and it cannot prove who wrote something.

A passing result means "not obviously AI." It never means "written by this person." Authorship is a provenance question (who typed the text, on what device, with what history), and no detector in this repository answers it. Two measurements set this limit:

- On a set of 30 drafts written by a model following a written anti-AI style guide, the judge panel caught between 23% and 43% depending on the panel configuration (judge study, 2026-10-02, `judge/JUDGE.md`; Calibration and Evidence says where the study files live).
- The deterministic layer is built to reject almost no human writing. That design choice leaves most carefully prompted AI drafts to the judges, and the judges miss many of them. In a persona test on 2026-10-02, the deterministic gate rejected none of 12 drafts from a current model and the send hook blocked 1 of them (`docs/evidence/persona-2026-10-02.json`).

Other limits a reader should know before relying on a result:

- **Unlisted injection wordings.** The deterministic injection check matches 10 patterns. Text addressed to a grader in a wording outside that list passes it by design; the judge prompt's fence and the jurors' own behavior are the backstop. See the Threat Model chapter.
- **Normalization is a fixed table.** It folds the look-alike characters it knows. A new spelling class can get past it until the table and the tests are extended.
- **Judges are not validated against human labels.** The judge false-positive rate was measured on public prose that carries era and medium cues, and no held-out set of AI drafts exists yet. Treat judge numbers as optimistic for modern business writing.
- **The overlay is personal.** The overlay encodes one writer's banned words and structures. A new user builds an overlay from the blank template and calibrates it on their own writing; the Getting Started chapter covers that.
- **The send hook's word list is one writer's too.** The hook carries its own fixed list of blocked words, separate from the overlay, and the overlay can't exempt them. In the persona test, a public 18F author's 10 held-out posts passed after one edit to that list, and the hook still blocked 4 of 14 further posts by the same author, each on a word from the list (`docs/evidence/persona-2026-10-02.json`). Getting Started, Step 6, covers checking the list against fresh writing of your own.

## Where It Runs

Everything runs on the user's machine. The engine is plain Node ES modules with no npm dependencies and no `package.json`; the hook and its tests need Python 3. The detector is a separate MIT-licensed project cloned beside the tools and pinned to one commit. The gate, the hook and the onboarding tools send text off the machine only when judges are on, and then only the text given to that run. The Architecture chapter draws the data flow, and its data boundary lists every path that calls a model, the opt-in ones included, with how to keep each local.

## How Well It Does on Human Writing

The standing gate runs the deterministic layer over public human writing from before 2022 and fails if the reject count rises above the stored budget. The run measured at c558a2f on 2026-10-03 rejected 0 of 18,335 pooled public documents: the 18F blog, Python PEPs, RFCs and the 20 Newsgroups set. Anyone can reproduce this with `bash calibration/fetch-public-corpora.sh && node calibration/human-fp-budget.mjs`. Per-set counts, the judge panel's numbers and their limits are in Calibration and Evidence.

## The Overlay in This Edition

The onboarding flow uses a blank overlay template (`onboarding/templates/voice-overlay.template.mjs`) instead of anyone's personal overlay, and the engine reads the reviewed copy as `voice-overlay.mjs`. The public starter kit carries the template and the onboarding tools under `tools/` from its 2026-10-02 release that added these docs (`docs/voice/`); Getting Started, "Before You Start", gives the install status. The template's lists of words, phrases, approved lines and verdict-driving structures start empty, and `REVIEWED` starts `false`. `onboarding/profile-build.mjs` drafts a filled copy from the user's own samples, and the user reviews it before it is used. Because the template's `VERDICT_STRUCT_TYPES` list starts empty, no overlay structure moves the gate verdict until the user adds one; overlay hits print as must-fix. The overlay these docs were measured on pins 1 structure.

## Reading Order

- **Getting Started** says where the tools come from, checks the install, wires the hook, and builds and calibrates a personal overlay, either with `/voice-setup` or step by step in a terminal.
- **Architecture** covers the layers, the data flow, the data boundary, and the dependencies and pins.
- **Threat Model** lists each way a check can be evaded or fail open, its control, and the test that proves the control.
- **Runbooks** cover tests, moving the detector pin, a blocked send, and gate exit 4.
- **Reference** is generated from the code: checks, flags, exit codes, environment variables, hook tiers, files and tests.
- **Calibration and Evidence** and the **Decision Log** hold every measured number with its source and its reopen condition.
- **Review Packet** is for outside reviewers: the claims, how to reproduce each public number, the known limits and where to send findings.

- **Maintaining the Docs** covers edition markers, the facts file, the generated reference and `verify-docs`.
