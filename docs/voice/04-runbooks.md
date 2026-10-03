<!-- built from docs/src/04-runbooks.md for the public edition at tools commit cc4c915 -->
# Runbooks

Each runbook starts from something you can see (a blocked send, an exit code, a hook that stays quiet) and ends with a check you can run. Every runbook has the same five parts: **Symptom**, **Confirm**, **Fix**, **Verify** and **Rollback**. The commands and file names match the engine at tools commit cc4c915, written 2026-10-02. Flags, exit codes and environment variables are in the generated reference (chapter 05); this chapter links to them instead of repeating them.

The commands use two shell variables:

```bash
T="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools"                       # the engine and the onboarding tools
H="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/scripts/voice-tell-gate.py"   # the send hook
```

One rule holds in every runbook: no fix turns the gate off. Removing the hook entry from `settings.json`, making the hook exit 0 early, raising the scorer timeout until failures stop showing, or pointing `VOICE_AISCORE` at a stub all count as turning it off. If a check is wrong, change the check and prove the change on the calibration sets (runbook "Recalibrate After a Change"). If a send has to go out before the check is fixed, a person sends it by hand, outside the agent, and knows the gate did not see it.

## A Legitimate Send Was Blocked

**Symptom.** A send tool call is denied with `AI-TELL GATE blocked this send`, followed by a bullet list of the hits, and the text is something you meant to send.

**Confirm.** Decide which kind of hit it is before changing anything. Run the scorer on the exact text:

```bash
pbpaste > /tmp/blocked.txt        # or save the outgoing text any other way
node "$T/aiscore.mjs" /tmp/blocked.txt
```

The hook's deny message lists every hit. Each hit has one of three sources, and each source has a different fix:

| Hit in the deny message | Source | Where the fix goes |
|---|---|---|
| A word or phrase from the hook's own lists | `BLOCK_WORDS` or `BLOCK_PHRASES` in the hook | the hook file (move the word to `NUDGE_WORDS` or `FULL_EXEMPT`) |
| A structure with critical severity (an announced hedge, a candor label) | the overlay's structure list | the overlay (an approved line, or a narrower pattern) |
| A phrase from the overlay | the overlay's phrase list: blocks when the overlay marks it critical (a kit `TEAM_PHRASES` entry) or the hook's word tiers block it | the overlay or the hook's tiers |
| `banned opener` on an "As <Name>" sentence | the hook's opener check: company voice ("As Globex, we ...") or a name on the company list | the sentence; a wrong name in your names file (see below) |

Then ask whether it is a false positive. A hit is a false positive when the matched text is a sense of the word you really use (a product name, a literal technical meaning), a verbatim quote, or a line you write and have approved. It is a true positive when the matched text is the move the check was written to catch, even if the rest of the message is fine. For a true positive, rewrite the sentence and resend; nothing else changes.

**Fix.** Pick the narrowest change that clears this case:

1. **A line you write on purpose** (a sign-off, a quote you repeat). Add the exact line to the approved lines in your overlay. The overlay's own checks skip it. The generic detector and the hook's word lists do not read the approved lines, so this fix only clears an overlay hit.
2. **A word with a real second sense.** Move the word in your copy of the hook from `BLOCK_WORDS` to `NUDGE_WORDS`: it is still flagged on every send, it stops blocking. Move it to `FULL_EXEMPT` only when it is a name you own and should never be flagged.
3. **A structure that fires on a sentence it was not meant for.** Narrow its regular expression and add the sentence as a should-stay-silent test case (runbook "Add a Banned Word or a Structure").
4. **An "As <Name>" opener.** Company voice ("As Globex, we ...") is the tell itself: lead with the name ("Globex ..."). An opener that only names a listed company ("As Google reports ...") blocks too; if the name in your own `company-names.txt` is wrong, remove the line. A name that should never count as a company gets a `!` line instead, which turns its non-company-voice openers silent; a `!` line works for a built-in name too ("!Amazon" for the rainforest). Any other name only draws a nudge and the send goes out.

In a starter kit install the overlay is the file named on `voice-doctor`'s `overlay` line (`voice-overlay.mjs` by default), and its approved lines are `APPROVED_LINES`. `/voice-setup` steps 5 and 6 walk through editing it.

**Verify.** Run the hook on the same text as a synthetic send; nothing is sent:

```bash
jq -n --rawfile t /tmp/blocked.txt '{hook_event_name:"PreToolUse", tool_name:"mcp__probe__send_gmail_message", tool_input:{body:$t}}' \
  | python3 "$H"
```

No output, or an `additionalContext` nudge, means the send would go through. A `permissionDecision: deny` means it is still blocked. Then run the hook tests and recalibrate, because a tier change moves the hook's numbers for everyone who uses this copy.

**Rollback.** Every fix here is a one-line edit. Before you edit a file, keep a dated copy (`cp <file> <file>.bak-$(date +%Y-%m-%d)`), and copy it back to undo. In a git checkout of the tools, `git checkout -- <file>` also works. For the hook, see "Restore the Hook from Backup".

## The Scorer Errored (Gate Exit 4, Hook Denies Every Send)

**Symptom.** One of two things:

- `prose-gate.mjs` prints `VERDICT: ERROR` and exits 4. Nothing was admitted and no judge was called.
- The send hook denies a send with `Voice gate couldn't run its scorer (...)`, or a file write gets a `VOICE GATE WARNING` saying the structure checks did not run.

Both are the system failing closed on purpose. The scorer timeout is 120,000 ms in the gate and 20 s in the hook (`VOICE_SCORER_TIMEOUT`, at most 40 s; the normalizer gets at most 10 s).

**Confirm.** The text in parentheses names the cause. Match it here, then reproduce it by running the scorer by hand on the same text:

```bash
node "$T/aiscore.mjs" /tmp/blocked.txt --json; echo "exit $?"
echo 'probe text' | node "$T/text-normalize.mjs" --json; echo "exit $?"
```

| Message (gate, then hook) | Cause | Fix |
|---|---|---|
| `aiscore failed (exit N): ...` / `aiscore exited N: ...` | The scorer threw. The usual reasons are a syntax error after an edit, a missing overlay file, or a missing detector (`AVOID_AI_DETECTOR` or `avoid-ai-writing/detector/patterns.js`) | Fix the file the stack trace names; for the detector, restore the pinned checkout (runbook "Upgrade the Vendored Detector") |
| `aiscore failed ... ETIMEDOUT` / `aiscore timed out after N s` | A hang or a very slow input. The gate kills the child with SIGKILL | Re-run on the same input by hand. If it is slow on one input only, that input is a test case for a super-linear regular expression; file it and keep the deny |
| `aiscore returned bad JSON` / `aiscore printed invalid JSON`, `printed nothing` | Something printed to stdout before the JSON line, or the process died mid-write | Look for a stray `console.log` in the scorer or the overlay |
| `aiscore result has no numeric score and adjustedScore`, `has no usable ... issues` / `aiscore JSON has no numeric score`, `has a malformed issue` | The scorer ran but its output shape changed: an engine edit renamed a field, or an overlay returns issues without a string `type` and `text` | Restore the field names; check the overlay against the template interface |
| `node not found on PATH` (hook only) | The hook's environment has no `node` | Put `node` on the PATH that Claude Code starts hooks with |
| `text-normalize JSON has no rendered text` (hook only) | The hook is newer than the engine: it reads a field that the installed `text-normalize.mjs` does not print yet | Update the engine so both come from one release (next paragraph) |
| `text-normalize read a different text than was sent` (hook only) | The normalizer and the hook disagree on the input, usually an encoding problem in a wrapper | Run the normalizer by hand on the same text and compare `inputCodePoints` |
| `internal error <Type>: ...` (hook only) | A bug in the hook itself | Read the traceback with the synthetic send from the first runbook |

The hook and the engine ship as a pair. A hook that expects a newer normalizer denies every send by design, because it cannot run its word list on every view of the text.

**Fix.** Fix the cause in the table. Do not raise `VOICE_SCORER_TIMEOUT` past a real hang, and do not point `VOICE_AISCORE` or `VOICE_NORMALIZE` at anything but the real tools: both overrides exist for the hook tests and for `voice-doctor`, which use them to break the scorer in a temporary folder.

**Verify.**

```bash
node "$T/onboarding/voice-doctor.mjs" --only scorer,normalizer,gate,send-fails-closed,write-warns
```

All five must print `PASS`. `send-fails-closed` proves the deny still happens when the scorer breaks, so a fix that only silenced the error fails here.

**Rollback.** If the error started after an engine or hook update, return both to the previous matching pair: the previous engine (`git checkout <previous-commit>` in a git checkout of the tools; on a kit install, re-run the previous kit release's `./setup.sh`) and the hook backup from the same day (runbook "Restore the Hook from Backup"). Never roll back only one of the two.

## Judges Are Unavailable

**Symptom.** `prose-gate.mjs` returns `INCONCLUSIVE` (exit 3) on drafts that used to come back `ADMIT`, and the judge detail shows errors or timeouts instead of scores.

**Confirm.** INCONCLUSIVE means the deterministic layer passed and fewer jurors answered than the panel needs. A consensus panel needs two answers; a single `--judge` override needs one (Architecture, The Gate). Each `opencode` call has a 150,000 ms timeout and every judge call one retry; in consensus mode a failed juror is replaced by the next neutral spare. A reply without a clockable YES or NO and a numeric `ai_ness` counts as a failed juror. Check whether the judges answer at all:

```bash
node "$T/onboarding/voice-doctor.mjs" --only judges --live-judges
```

`--live-judges` sends one fixed made-up sentence to each allowed judge and nothing else. Without the flag the doctor only checks the configuration and calls no model.

**Fix.** Restore the judge backend, or keep working in det-only mode on purpose. Det-only is a complete setup: the deterministic checks, the injection check and the send hook all run, and nothing leaves the machine.

```bash
node "$T/prose-gate.mjs" draft.md --drafter <model> --det-only
```

Det-only never returns ADMIT. A clean draft is INCONCLUSIVE, because nothing read it as a whole; a draft that trips the deterministic layer is still REJECT. Do not treat a run of INCONCLUSIVE results as a pass, and do not lower `--bar` to get answers from a weaker panel. Under consensus a lone surviving juror cannot reject, so a partial outage moves verdicts toward INCONCLUSIVE, never toward a wrong REJECT.

**Verify.** With the backend restored, the doctor's `judges` line prints `PASS` with `--live-judges`, and a draft you know the panel rejects is rejected again.

**Rollback.** Nothing to roll back; det-only changes no files. If you changed `judges.mode` in `voice-config.json` to `none` during the outage, set it back.

## The Hook Isn't Firing

**Symptom.** A send with an obvious tell goes out with no block and no nudge, or a file write never gets an `AI-TELL CHECK` note.

**Confirm.** First rule out the cases where staying quiet is correct:

- The file is not a prose file (`.html .htm .md .mdx .txt .rtf .docx`, 7 extensions) or is shorter than 400 characters. A draft file (a `drafts` folder in its path, or `draft` in its name) is checked from 3 characters.
- The tool's own name (the part after the last `__`) has one of the 8 read-side markers (`read`, `search`, `list`, `get`, `fetch`, `download`, `poll`, `branch`) as a whole word. The hook treats such a tool as a read and skips it.
- The text went out through a shell command (`curl`, `gh pr create --body ...`, a chat CLI). Hooks fire on tool calls; a Bash-piped send is outside the hook's reach (Threat Model, Sends Outside Claude Code Tool Calls).
- The session started before the hook was wired. Claude Code reads hooks at session start.

Then run the doctor's hook checks, which read `settings.json` the way Claude Code does and run the hook on synthetic calls:

```bash
node "$T/onboarding/voice-doctor.mjs" --only hook-wiring,hook-controls,draft-gate-wiring
node "$T/onboarding/voice-doctor.mjs" --print-hooks     # the hooks block this config needs
```

The most common cause is the send matcher. Claude Code reads a matcher made only of letters, digits, `_`, `|`, `,`, `-` and spaces as a list of exact tool names, and anything else as a regular expression tested unanchored against the tool name. A list such as `send_gmail_message|create_pull_request` therefore never matches `mcp__gmail__send_gmail_message`. The rule was read from the Claude Code 2.1.286 bundle on 2026-10-02 and confirmed with a live probe the same day; the evidence is the comment on `matcherMatches` in `onboarding/lib/hook.mjs`.

The second cause is a hook older than the engine. Hooks from before 2026-10-02 test the read markers as substrings of the whole tool name, so `manage_spreadsheet_comment` ("spreadsheet" contains `read`) is skipped even when the matcher routes it there; `hook-wiring` reports it as a send tool the hook does not treat as a send. Those hooks also read overlay issues only under their owner's issue prefix, so a starter-kit overlay never affects a send.

**Fix.** Rewrite the wiring with the merge tool. It replaces only the entries that run `voice-tell-gate.py` or `voice-draft-gate.py`, adds the draft gate on `Stop`, and backs up the file first. Every other hook and setting keeps its value, and its bytes too when the tool can reproduce the file's layout (Claude Code's own, or plain JSON with 2 or 4 spaces or tabs); a hand-formatted file is rewritten as 2-space JSON, and the tool says so. A `timeout` you set on a voice entry is carried over. If your old send matcher was a list of names, the tool prints any name the new matcher doesn't cover; add it to `sendTools` in the voice config and re-run to keep it gated. If it prints "skipped the Stop entry", the draft gate's script isn't installed: copy it with the `cp` the message gives and run the tool again:

```bash
node "$T/onboarding/merge-hooks.mjs" --dry-run     # prints the hooks section it would write
node "$T/onboarding/merge-hooks.mjs"               # writes it; the original is kept as settings.json.bak-<time>
```

For a hook older than the engine, install the hook that ships with it (keep a dated copy first):

```bash
cp "$H" "$H.bak-$(date +%Y-%m-%d)"
cp "$T/hook/voice-tell-gate.py" "$H"
```

Re-apply any word moves you made in the old copy. Restart the Claude Code session after any wiring or hook change.

**Verify.** `hook-wiring` and `hook-controls` print `PASS`. In a fresh session, a send to a test channel or a draft with a known tell is denied. The doctor runs the hook directly, so its checks pass before the restart; only the fresh-session test shows that Claude Code loaded the new matcher.

**Rollback.** `merge-hooks.mjs` printed the backup path. Copying it back over `settings.json` restores the old wiring, and also undoes any other settings change made since the merge. To take out only the voice entries (the send hook and the draft gate, on any event), keeping everything else:

```bash
node "$T/onboarding/merge-hooks.mjs" --remove      # backs up first; a second run changes nothing
```

Restart the session after either.

## A Draft Was Flagged When the Reply Ended

**Symptom.** Claude Code shows "Stop hook error occurred" at the end of a reply, with the note "Voice draft gate: the draft had hard tells (...); Claude will fix it, or ask you if they're your words.", and Claude then writes a corrected draft. Or a reply ends with a "Voice draft gate (reply allowed)" note that lists softer tells, or with "Voice draft gate: draft not checked: <cause>".

**Confirm.** The label is how Claude Code shows any Stop-hook block. The draft gate blocked because a draft in the reply, a ````draft` fence or the piece after a `Written for:` line, has a hard tell; the reason Claude got lists each one. Run the scorer on the draft text the same way as for a blocked send (`node "$T/aiscore.mjs" /tmp/draft.txt`).

**Fix.**

1. **A true tell.** Nothing to change: Claude rewrites the draft in the same reply. The gate blocks at most 2 times per reply, then lets the reply end with a note that the draft is still flagged.
2. **Your own words, relayed as-is.** When every hard tell sits in a sentence you wrote that turn, the gate allows the stop with a note. If you asked for a word on purpose, tell Claude to keep it; a draft shown again unchanged after a block is allowed with a note, not blocked again.
3. **Not a draft.** An example or code that uses the `draft` info string is read as a draft. Use another info string (`text`, `md`) for examples.
4. **"draft not checked: <cause>".** The gate couldn't run (the cause names the scorer, the normalizer, the send hook or the transcript) and let the reply end. "the draft gate script is missing" means `settings.json` points at a script that isn't there: install it (Getting Started, Before You Start), or take the entry out with `merge-hooks.mjs --remove`. Run `node "$T/onboarding/voice-doctor.mjs" --only draft-gate-wiring,hook-controls`, fix what it names, and check the draft by hand meanwhile.

To turn the gate off, remove its `Stop` entry from `settings.json` (or restore the backup `merge-hooks.mjs` made) and restart the session.

**Verify.** In a fresh session, ask for a short draft in a ````draft` fence that uses a banned word. The reply ends with the label and a corrected draft below it.

## Recalibrate After a Change

**Symptom.** You changed a check, a tier, a bar, the overlay, the detector, or the hook. Or `voice-doctor` prints `FAIL user-calibration` because the calibration report was made with a different overlay, scorer, gate or hook than the ones installed now (the report records their hashes).

**Confirm.** The change is a calibration event if it can move any verdict or any block. Moving a word between hook tiers, adding a structure, changing a severity, changing `--det-bar` or the cadence crossover all qualify. Editing a comment does not, but the doctor compares file hashes, so it still asks for a fresh report.

**Fix.** Run the checks that apply, in this order. Each one is local and makes no model call.

1. The unit suites for the files you touched:

   ```bash
   node "$T/aiscore.test.mjs"
   node "$T/prose-gate.unit.test.mjs"
   python3 "$T/hook-tests/voice-tell-gate.test.py"      # VOICE_HOOK=<copy> tests a copy of the hook
   ```

2. The human false-positive budget over the public pre-2022 corpora. The fetch needs network once and verifies every file by sha256; the run itself is local:

   ```bash
   bash "$T/calibration/fetch-public-corpora.sh"
   node "$T/calibration/human-fp-budget.mjs"
   ```

   It fails when the pooled public reject count rises above the recorded baseline plus a small margin, when the pinned structure or any injection pattern hits a single human document, or when a corpus has the wrong document count. The last run (measured at cc4c915 on 2026-10-03) found 0 rejects in 18,335 public human documents.

3. Your own held-out writing (starter kit installs):

   ```bash
   node "$T/onboarding/calibrate-user.mjs"
   ```

Record a new baseline only when the change was meant to move the numbers, and read the diff before committing it. Keep a copy of the old baseline first; in a git checkout, `git diff` shows the change:

```bash
cp "$T/calibration/human-fp-budget.json" "$T/calibration/human-fp-budget.json.bak-$(date +%Y-%m-%d)"
node "$T/calibration/human-fp-budget.mjs" --write-baseline
git -C "$T" diff calibration/human-fp-budget.json     # git checkouts only
```

**Verify.** Every suite exits 0, `human-fp-budget` reports no rise, `calibrate-user` reports `0 failed`, and `voice-doctor` ends `GREEN`.

**Rollback.** Revert the change and re-run the same steps; the old baseline still applies. If you wrote a new baseline, copy the dated backup back (or, in a git checkout, `git checkout -- calibration/human-fp-budget.json`).

## Add a Banned Word or a Structure

**Symptom.** A tell gets through that you want caught: a word, a phrase, or a sentence shape.

**Confirm.** Decide where it belongs, because the three places act differently:

| You want | Put it in | Effect on a send | Effect in the gate |
|---|---|---|---|
| A word that should stop a send | the hook's `BLOCK_WORDS` (or `BLOCK_PHRASES` for a regular expression) | block | none; the gate does not read the hook |
| A word that should only be flagged | the hook's `NUDGE_WORDS` | nudge | none |
| A word in your own banned list | the overlay's word list | none: the hook drops overlay word hits and takes words only from its own lists | printed as must-fix |
| A phrase in your own banned list | the overlay's phrase list | block when the overlay marks it critical (every kit `TEAM_PHRASES` entry) or the hook's lists block it, otherwise nudge | printed as must-fix |
| A sentence shape | a structure in the overlay (`type`, `re`, `sev`, `note`; no `sev` means critical) | block when critical, nudge otherwise, under any issue prefix | printed as must-fix |
| A shape that should reject a draft on its own | the structure, plus its type in `VERDICT_STRUCT_TYPES` | block (it must be critical) | REJECT |

The send hook and the gate use different policies on purpose. The hook blocks on severity and its own lists; the gate's verdict uses only the pinned types, the injection check and the scores. Adding a verdict type is the strongest change in this table, and it has the strictest test: it must hit zero human documents in the budget.

**Fix.** Write the test cases before the pattern:

1. Two or three sentences that must fire, taken from the drafts where the tell got through.
2. Two or three legitimate sentences that must stay silent, covering the word's other senses and a quoted use.
3. Add the entry. For a structure, write the regular expression with the `g` flag, bound it with `\b`, and keep any wildcard span bounded (`[^.!?]{0,80}`), because an unbounded span on a long input is how the scan regressions of 2026-10-02 started (decision D9).

The generated reference describes the hook's tiers; the words themselves are in the hook file. Put structure cases next to your overlay and hook cases in the hook tests.

4. For a new verdict type only: add its type to `VERDICT_STRUCT_TYPES` and run `human-fp-budget`. Any hit on a human document fails the budget, and the type does not ship.

**Verify.** The new cases pass, the old ones still pass, and the runbook "Recalibrate After a Change" comes back clean. For a hook word, the synthetic send from the first runbook shows the block or nudge you intended.

**Rollback.** Remove the entry and its test cases in one commit; nothing else depends on them.

## Swap a Judge Model or Provider

**Symptom.** A judge model is retired or unavailable, a better model from the same lab is out, or you want a judge from a lab the registry does not have yet.

**Confirm.** The registry is the `JUDGES` constant in `prose-gate.mjs`: each entry has a name, a `vendor` (the lab), a `backend` and a `model`. Two more constants depend on it: `JUROR_ORDER`, the panel and spares for each drafter lab, and `TELL_PROFILE`, which maps drafter names to labs. The gate never seats a judge from the drafter's lab, and that rule reads `vendor`, so a wrong `vendor` value breaks the self-bias protection without any error. The registry has 4 judges at cc4c915: grok, gemini, claude, gpt, from xai, google, anthropic, openai.

**Fix.**

1. **Same lab, new model.** Change `model` in the entry. Keep `vendor`.
2. **New backend for an existing judge.** Change `backend` and add the call in `callJudge`. The backend must return the model's text; the gate parses the strict JSON answer itself.
3. **New lab.** Add an entry with the right `vendor`, add it to the `JUROR_ORDER` lists where it should serve, and add the lab's drafter names to `TELL_PROFILE` if that lab also drafts.
4. Leave `fence` unset on a new judge, so it gets the default fence wording. The one judge with `fence: 'short'` has it because of how that model handled the default fence, not as a general setting.

The panel for each drafter lab was measured, not picked. A swap that changes who sits on a panel needs the same kind of evidence: run the new panel on public human documents and generated AI drafts, write down in advance what result would make you keep it, and compare against the panel it replaces (decision D5 in chapter 07 records how the current panels were chosen).

**Verify.**

```bash
node "$T/prose-gate.unit.test.mjs"                                  # registry, juror order, vendor exclusion; no model call
node "$T/onboarding/voice-doctor.mjs" --only judges --live-judges   # each judge answers one made-up sentence
```

**Rollback.** Revert the registry edit. A missing or failing judge degrades to INCONCLUSIVE, so rolling back is never urgent for safety, only for recall.

## Upgrade the Vendored Detector

**Symptom.** Upstream `avoid-ai-writing` has new commits, or `voice-doctor` prints `FAIL detector-pin` because the installed `detector/patterns.js` is not the tested commit.

**Confirm.** The pin is commit 58a95fc, recorded with the sha256 of `detector/patterns.js` in `onboarding/detector-pin.json`. Every calibration number in these docs was measured on that commit. Check what is installed:

```bash
git -C "$T/avoid-ai-writing" rev-parse --short HEAD
node "$T/onboarding/voice-doctor.mjs" --only detector,detector-pin
```

In the voice-system repo the detector is a git checkout. The starter kits ship it as a vendored copy without git history, so on a kit install the doctor's hash check is the test.

A `detector-pin` FAIL on an install you did not mean to change means the detector moved by accident (a `git pull` in the wrong folder, a kit upgrade that kept an edited copy). Put the pin back; do not edit `detector-pin.json` to make the check pass.

**Fix.** To move the pin on purpose, test the new commit in a scratch copy first:

```bash
git -C "$T/avoid-ai-writing" fetch
git -C "$T/avoid-ai-writing" checkout <new-commit>
node "$T/aiscore.test.mjs"                       # fails if the detector added a category the evidence lists don't classify
bash "$T/calibration/fetch-public-corpora.sh" && node "$T/calibration/human-fp-budget.mjs"
```

Three things can change with a new detector commit:

1. **New categories.** `aiscore.test.mjs` fails when the detector has a category that `ai-evidence.mjs` lists in neither `COUNTED` nor `NOT_COUNTED`. Add it to `NOT_COUNTED` with reason `UNTESTED` unless you have measured it as AI evidence. Do not add it to `COUNTED` without that measurement. The pinned commit has 51 categories.
2. **The raw `score`.** The gate's verdict reads `adjustedScore`, which counts only the classified categories, so the budget can still pass while the raw `score` moves. The send hook nudges on the raw `score` at 40, so check a few long documents with `aiscore.mjs --json` before and after.
3. **The calibration record.** If the budget and the user calibration pass, update `detector-pin.json` (commit, `patternsSha256`, date) and the kits' vendored copy in the same change, then regenerate the docs facts so the pin printed here matches.

**Verify.** `detector-pin` prints `PASS` against the updated pin file, `human-fp-budget` exits 0, `calibrate-user` reports `0 failed`, and `voice-doctor` ends `GREEN`.

**Rollback.** Check the detector out at the pinned commit, 58a95fc (`git -C "$T/avoid-ai-writing" checkout <pin>`), or restore the vendored copy from the kit, and revert `detector-pin.json` and `ai-evidence.mjs` together.

## Claude Code Version Drift

**Symptom.** One of these:

- The hook blocks on one machine or launcher and stays quiet on another with the same `settings.json`.
- `hook-wiring` passes in one shell and fails in another.

**Confirm.** Find every Claude Code install and its version:

```bash
which -a claude
for c in $(which -a claude | sort -u); do echo "$c -> $(readlink "$c")"; "$c" --version; done
```

Each launcher is usually a symlink into a versions folder, and two launchers can point at different versions. A session transcript records the version that ran it (`jq -r .version` on a line of the session's `.jsonl`), which tells you what ran a past session.

Two things in the voice system depend on the Claude Code version:

1. **The matcher rule.** How a hook matcher is read (exact names or a regular expression) was read from the Claude Code 2.1.286 bundle on 2026-10-02. A different version may read matchers differently. After any Claude Code upgrade, re-run `voice-doctor --only hook-wiring,hook-controls`.
2. **The drafter name.** The gate excludes judges from the drafter's lab, so `--drafter` has to name the model that wrote the draft. The model comes from the `model` setting in `settings.json` (or a `/model` choice in the session), and a subagent can run on a different model than its parent. A wrong drafter name seats a judge from the drafter's own lab, and nothing reports it.

**Fix.** Point every launcher at one version, restart the sessions, and re-run the doctor's hook checks. Pass the `--drafter` that matches the model that wrote the draft.

**Verify.** Every launcher prints the same `--version`. `voice-doctor` ends `GREEN` from each shell you use. A test subagent with a model override returns text, and its transcript shows the model and version you expected.

**Rollback.** Re-link the launcher to the previous version folder (`ln -sfn <versions>/<old> <launcher>`) and restart the session.

## Restore the Hook from Backup

**Symptom.** An edit to `voice-tell-gate.py` broke it: the hook tests fail, `hook-controls` fails, or every send is denied with `internal error`. Or you need to return to a known-good version while you debug.

**Confirm.** List the backups next to the hook and check what each one expects from the engine:

```bash
ls -la "$H" "$H".bak*
diff "$H.bak-<date>" "$H" | head -50
```

A hook backup only works with an engine from the same period. A hook that reads a normalizer field the installed engine does not print denies every send (runbook "The Scorer Errored"), and a hook from before the fail-closed change lets sends through when the scorer breaks. Prefer the newest backup that matches the engine you have.

**Fix.** Test the backup before it goes live, then keep the current file before you replace it:

```bash
VOICE_HOOK="$H.bak-<date>" python3 "$T/hook-tests/voice-tell-gate.test.py"    # must exit 0
cp "$H" "$H.broken-$(date +%Y-%m-%d-%H%M)"
cp "$H.bak-<date>" "$H"
```

The hook tests in `hook-tests/` are versioned with the engine, so they test the backup against the engine you have installed. On a starter kit install, the kit's `setup.sh` keeps a hook you have edited. To return to the kit's version, move your copy aside and run `./setup.sh --dry-run` to confirm it will install the hook, then `./setup.sh`.

**Verify.**

```bash
python3 "$T/hook-tests/voice-tell-gate.test.py"
node "$T/onboarding/voice-doctor.mjs" --only hook-controls,send-fails-closed,write-warns
```

Both must pass. `user-calibration` then fails until you re-run `calibrate-user.mjs`, because the report records the hook's hash; that failure is expected.

**Rollback.** Copy the `.broken-<time>` file back over the hook. It is the version you replaced, kept byte for byte.
