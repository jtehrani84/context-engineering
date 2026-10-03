---
name: voice-setup
description: Guided setup of the voice system for a new user. Use when the user says "voice setup", "/voice-setup", "set up the voice gate", "calibrate the voice system to me", "build my voice overlay", or "voice-doctor is red". Runs voice-doctor, the config, profile-build, the user's review, calibrate-user and the overlay install in order, explains each result in plain words, and ends with voice-doctor GREEN. Writing samples stay on this machine; this skill never reads them into the conversation.
---

# /voice-setup

Set up the voice system for one person, from a fresh install to `voice-doctor` GREEN. The tools are deterministic
Node.js scripts in the installed tools folder. This skill runs them in order, reads their output, and explains each
result. It does not write the overlay for the user and it does not judge their writing; the tools measure and the
user decides.

## Rules For This Session

These hold for every step. They protect the user's writing samples, which are personal data.

1. **Never read a sample into the conversation.** Do not use Read, cat, head, grep or any other tool on files in the
   samples folder, the AI-drafts folder, the draft overlay or the installed overlay. The onboarding tools print counts,
   statistics and sample ids (h01, h02, ...), never sample text, and that output is all you need.
2. **Never send a sample anywhere.** No web tool, no MCP tool, no judge, no model call with sample text. The tools turn
   off networking in their own processes; do not work around that.
3. **Never pass `--show-spans` or `--show-files`** to calibrate-user.mjs yourself. If the user wants to see the matched
   text, give them the command to run in their own terminal.
4. **Ask before changing a file outside the voice folder.** That means `settings.json` and the installed overlay. Back
   each one up first (`cp <file> <file>.bak-$(date +%Y-%m-%d)`).
5. **Report what the tools printed.** Quote the PASS, FAIL, WARN or INFO line and its fix line. Do not call a step
   done until the tool that checks it says so.

## Where The Tools Are

The starter kit's `./setup.sh` puts the engine and these tools in one folder, `~/.claude/tools` (or
`$CLAUDE_CONFIG_DIR/tools`). The onboarding tools are in its `onboarding/` subfolder. Set two shell variables once
and use them in every command:

```bash
T="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools"
V="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/voice"
ls "$T/onboarding/voice-doctor.mjs" "$T/aiscore.mjs"
```

If either file is missing, stop. The tools aren't installed: the user runs the kit's `./setup.sh` again, then starts
this skill over. `$V` holds the user's own files: the config,
the samples, the draft overlay and the calibration report. Nothing in `$V` is shipped or uploaded.

Each tool prints `--help`. Exit codes: voice-doctor 0 no FAIL, 1 a FAIL, 2 usage error; profile-build 0 draft
written, 1 refused, 2 not enough samples; calibrate-user 0 no held-out sample failed, 1 one or more failed, 2 it
couldn't run.

## Step 1: First Doctor Run

```bash
node "$T/onboarding/voice-doctor.mjs"
```

It prints one line per check (`PASS`, `FAIL`, `WARN` or `INFO`), a `fix:` line under each FAIL, and a summary line,
`GREEN` or `RED`. `node "$T/onboarding/voice-doctor.mjs" --list` prints what each check verifies and what it catches.

On a new install, expect two FAILs: `overlay` (no reviewed personal overlay yet) and `user-calibration` (no
calibration report yet). Steps 3 to 7 fix those. Any other FAIL is an install problem; fix it first:

| Check | What a FAIL means | What to do |
|---|---|---|
| `runtime` | Node.js older than 18, or no `python3` | The user installs them; re-run |
| `engine`, `detector`, `detector-pin` | An engine file is missing, or the detector isn't the tested commit | Re-run the kit's `setup.sh`; never edit the pin to make it pass |
| `scorer`, `normalizer`, `gate` | The tool runs but gives a wrong answer on a fixed probe | Reinstall the engine from one release |
| `hook-wiring` | `settings.json` doesn't run the hook for every send tool and every file write | Step 2 |
| `draft-gate-wiring` | No `Stop` entry runs `voice-draft-gate.py`, or the script isn't next to the send hook | Re-run the kit's `setup.sh` (it installs the script), then Step 2 |
| `hook-controls`, `send-fails-closed`, `write-warns` | The hook lets a tell through, or lets a send through when its scorer is broken | Reinstall the current `voice-tell-gate.py` |
| `engine-calibration` | The engine's human false-positive record is missing or shows rejects | Reinstall `calibration/` with the engine |

`judges` is optional. `INFO ... det-only mode` is a normal result: with no judge, a clean draft is INCONCLUSIVE,
never ADMIT, and the deterministic checks and the send hook still run.

The doctor changes no files. It runs the scorer, the gate and the hook on fixed made-up texts, and it simulates a
broken scorer through `VOICE_AISCORE` in a temporary folder it deletes.

## Step 2: Config And Hook Wiring

Create the config if there is none. Every property has a default, so the example is a starting point, and an absent
file means "all defaults".

```bash
mkdir -p "$V"
[ -f "$V/voice-config.json" ] || cp "$T/onboarding/voice-config.example.json" "$V/voice-config.json"
```

Ask the user four questions and edit `$V/voice-config.json` with their answers. The schema is
`$T/onboarding/voice-config.schema.json`; each property has a description there.

1. **Which model drafts most of your text?** Set `judges.drafterLab` to its lab (`anthropic`, `google`, `openai`,
   `xai`), or `unknown`.
2. **Do you have a way to call models from other labs?** If not, set `judges.mode` to `none`; the system then runs
   det-only, which is a complete setup. If yes, list them in `judges.allowed` with their lab, and set `command` to the
   backend CLI if it isn't `opencode` on PATH. A judge never comes from the drafter's lab, because a model under-rates
   the tells in its own lab's writing; the config check refuses one that does. `consensus` needs two labs.
3. **Which tools send your words somewhere they can't be taken back?** `sendTools` lists them (chat messages, email,
   shared docs and slides, comments, pull requests and issues by default). A name without `mcp__` matches that tool
   under any MCP server. Add the user's own send tools; remove none unless the user asks.
4. **Standard or strict?** `strictness.level` `standard` fails a held-out sample when the gate rejects it or the send
   hook blocks it; `strict` also counts a nudge.

The `data` section has no choices: samples never leave the machine, never go to a judge, and are never printed. The
config check refuses a file that changes those values.

Check the config, then the wiring:

```bash
node "$T/onboarding/voice-doctor.mjs" --only config,hook-wiring,draft-gate-wiring
```

If `hook-wiring` or `draft-gate-wiring` fails, show the user what the doctor expects and what will change, ask, and then wire it:

```bash
node "$T/onboarding/voice-doctor.mjs" --print-hooks     # the hooks block this config needs
node "$T/onboarding/merge-hooks.mjs" --dry-run          # the hooks section after the merge, nothing written
node "$T/onboarding/merge-hooks.mjs"                    # writes it; the original is kept as settings.json.bak-<time>
```

`merge-hooks.mjs` replaces only the entries that run `voice-tell-gate.py` or the draft gate `voice-draft-gate.py`, and
keeps every other hook and setting. It wires the draft gate on `Stop` with a command that checks for the script first,
so a missing script ends a reply with a "draft not checked" note instead of blocking it, and it skips the `Stop` entry
(with a message) while the script isn't installed. The
send matcher it writes is a regular expression on purpose: Claude Code reads a matcher made only of letters, digits,
`_` and `|` as a list of exact tool names, so `slack_send_message` would never match `mcp__slack__slack_send_message`
(checked against Claude Code 2.1.286 on 2026-10-02; the rule and its evidence are in `$T/onboarding/lib/hook.mjs`).
After a wiring change, the user restarts the Claude Code session so it loads the new hooks. The doctor runs the
hook directly, so its checks pass before the restart.

## Step 3: Writing Samples

Ask the user to put 20 to 40 pieces of their own writing in `$V/samples/`, one piece per `.txt` or `.md` file:
messages, emails, notes and documents they wrote themselves, without an AI assist, in the registers they want checked.
Recent writing is better than old. Fewer than 4 can't be split; fewer than `strictness.minSamples` (20 by default)
works but the tools warn that the held-out set is small. The user copies the files in; nobody pastes them into this
chat.

Count them without reading them:

```bash
ls "$V/samples" | wc -l
```

profile-build and calibrate-user split the samples the same way, by a hash of each text: about 30% (`heldOutShare`)
are held out and never used to build the overlay, so the test in step 6 runs on writing the overlay hasn't seen.

## Step 4: Draft A Personal Overlay

```bash
node "$T/onboarding/profile-build.mjs"
```

It reads the tune samples locally, measures habits (sentence length, contractions, very short sentences, dash and
ellipsis use, recurring phrases), runs the installed checks on them, and writes one file, `$V/voice-overlay.draft.mjs`.
It prints counts and statistics only. Explain the summary lines:

- `samples`: how many were used, how many skipped (shorter than 3 words, or duplicates), the tune and held-out counts.
- `sentences` and `per 1,000`: the user's measured habits.
- `register`: which habit checks are on. A band is off when there aren't enough long samples to set it.
- `approved`: lines the user really writes that a check flagged in 2 or more tune samples. These are candidates for
  the user to keep or delete.

If a draft already exists, add `--force` to replace it.

## Step 5: The User Reviews The Draft

The user opens `$V/voice-overlay.draft.mjs` in their own editor. You don't open it: it holds phrases taken from their
writing. Walk them through what to look at:

- `APPROVED_LINES`: keep only lines they write; delete the rest. The overlay's own checks skip these lines. The
  generic detector and the send hook's word list don't read this list.
- `REGISTER`: the habit bands. A value far outside a band gets a nudge, never a block. `null` turns a check off.
- `TEAM_WORDS` and `TEAM_PHRASES`: optional. Words they never use (flagged high) and phrases they would never write
  (flagged critical, which the send hook blocks).
- `VERDICT_STRUCT_TYPES`: leave it empty unless a check should reject a draft on its own.
- `NOTES`: what profile-build noticed.
- Last, `REVIEWED = true`.

Confirm the review without reading the file:

```bash
node --input-type=module -e "const m = await import('file://$V/voice-overlay.draft.mjs'); console.log('REVIEWED', m.REVIEWED, '| approved lines', m.APPROVED_LINES.length, '| team words', m.TEAM_WORDS.length, '| team phrases', m.TEAM_PHRASES.length)"
```

## Step 6: Calibrate The Draft On Held-Out Writing

```bash
node "$T/onboarding/calibrate-user.mjs" --overlay "$V/voice-overlay.draft.mjs" --no-report
```

It runs the gate (`prose-gate.mjs --det-only`; no judge ever sees a sample) and the send hook (on a synthetic send;
nothing is sent) on every held-out sample. A draft overlay is tested in a temporary engine copy that it deletes
afterwards. The user's own writing must come through clean, so the target is `HELD-OUT ... 0 failed ... PASS`.

Each failure is listed by sample id with the check that fired and a suggestion. Explain the suggestion and let the
user make the change in their editor:

| Check | Plain meaning | Usual change |
|---|---|---|
| `send-hook:<prefix>-phrase` | A phrase in `TEAM_PHRASES` is in their own writing | Remove it from `TEAM_PHRASES` |
| `send-hook:<prefix>-word` | A word in `TEAM_WORDS` is in their own writing | Remove it from `TEAM_WORDS` |
| `send-hook:<prefix>-cadence-*` | A sample sits outside a `REGISTER` band | Widen that band, or set it to `null` |
| `send-hook:hard-ban` | The hook's word list blocks a word they really use | Move the word from `BLOCK_WORDS` to `NUDGE_WORDS` in their copy of `voice-tell-gate.py`, or reword |
| `ai-evidence` | The generic detector's categories added up past `strictness.detBar` | Raise `detBar` a little, or drop the sample if it isn't really theirs |
| `pinned:<type>` | A type in `VERDICT_STRUCT_TYPES` fired on their writing | Remove it from that list |
| `injection:<type>` | The sample reads like an instruction to a grader | Nothing exempts this; keep such text out of gated drafts |

Re-run until 0 fail. Two cautions to pass on. Each change made to pass a held-out sample uses that sample for tuning,
so after several rounds the user adds a few new samples to keep a clean test. And if the tool warns that the samples
changed since the draft was built, re-run step 4 with `--force`.

To see the matched text, the user runs the same command with `--show-spans` in their own terminal.

## Step 7: Install The Overlay

The doctor's `overlay` line names the file the engine reads (`paths.overlay`, by default `$T/voice-overlay.mjs`). Ask,
back it up, copy the reviewed draft over it, and calibrate the installed file. This run writes the report the doctor
reads, `$V/calibration-report.json`.

```bash
O="$T/voice-overlay.mjs"     # or the path in the doctor's overlay line
cp "$O" "$O.bak-$(date +%Y-%m-%d)"
cp "$V/voice-overlay.draft.mjs" "$O"
node "$T/onboarding/calibrate-user.mjs"
```

The report records the hashes of the overlay, the scorer, the gate and the hook. A later change to any of them makes
it stale, and the doctor's `user-calibration` check fails until calibrate-user runs again.

## Step 8 (Optional): Recall On AI Drafts

The deterministic layer is built to never flag the user's own writing, so it catches few AI drafts by design. To see
how many it does catch, the user writes 10 or more AI drafts in their own topics with their own model, saves them in
`$V/ai-drafts/`, and runs:

```bash
node "$T/onboarding/calibrate-user.mjs" --ai-drafts "$V/ai-drafts"
```

With judges configured and `judges.aiDraftsToJudges: true`, add `--judge-drafts --drafter <model>` (for example
`--drafter claude`) to let the allowed judges read the drafts. Only the drafts go to a judge; the samples never do.

## Step 9: Doctor GREEN

```bash
node "$T/onboarding/voice-doctor.mjs"
```

The setup is done when the last line reads `GREEN` with 0 fail. WARN lines are allowed; explain each one. With judges
configured, `--live-judges` sends one fixed made-up sentence to each judge to confirm it answers.

Tell the user what GREEN covers: the engine is the tested one, the hook is wired and fails closed, and their own
held-out writing passes. It doesn't show that a clean score means a text is theirs. The checks find generic AI
writing; they don't establish who wrote something.

## Words To Explain When They Come Up

- **Tune and held-out samples.** Tune samples build the overlay. Held-out samples only test it, so a pass on them
  says something about writing the overlay hasn't seen.
- **Block and nudge.** A block stops a send (the PreToolUse hook denies the tool call). A nudge lets it through with
  a note to the model. File writes are only ever nudged.
- **Fails closed.** If the scorer or the normalizer breaks, the hook denies a send instead of letting it through, and
  warns on a file write. The doctor proves this by breaking them on purpose in a temporary folder.
- **Det-only and INCONCLUSIVE.** With no judge, the gate runs its deterministic checks only. A clean draft is then
  INCONCLUSIVE, never ADMIT, because nothing read it as a whole.
- **Probe.** A random token in the overlay. The doctor scores a text containing it and checks the scorer reports it,
  which shows the engine reads this overlay and no other.

## Later Runs

Run `node "$T/onboarding/voice-doctor.mjs"` after any update to the tools or the hook. When it reports
`user-calibration` stale, run step 7's last command again. When the user's writing changes (new role, new kind of
document), add samples and repeat steps 4 to 7.
