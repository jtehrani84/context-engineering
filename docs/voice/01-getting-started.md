<!-- built from docs/src/01-getting-started.md for the public edition at tools commit c558a2f -->
# Getting Started With /voice-setup

This chapter takes one person from a fresh install to `voice-doctor` GREEN. It follows the `/voice-setup` skill (`skills/voice-setup.md` in the starter kit, which `./setup.sh` installs as `~/.claude/commands/voice-setup.md`) step by step, and every command below is one the onboarding tools in `onboarding/` accept as of 2026-10-02. You can type `/voice-setup` in Claude Code and let the skill run the steps, or run them yourself in a terminal. The result is the same.

The setup ends with four things in place:

- the engine is the tested one (scorer, normalizer, gate, the pinned detector at commit 58a95fc)
- the send hook is wired into `settings.json` and fails closed
- a personal overlay, built from your own writing and reviewed by you, is installed
- your held-out writing passes the gate and the hook, recorded in a calibration report

What GREEN does not show: that a clean score means a text is yours. The checks find generic AI writing. They do not establish who wrote something.

## Your Writing Samples Stay on This Machine

Setup reads 20 to 40 pieces of your own writing. These rules hold for every step, whether you run the tools or the skill does:

1. The onboarding tools print counts, statistics and sample ids (`s01` in `profile-build.mjs`, `h01` for held-out samples in `calibrate-user.mjs`, and so on), never sample text. Their output may be read into an AI session, so it carries nothing personal.
2. No sample goes to a judge, a model, a web tool or a remote path. `profile-build.mjs` and `calibrate-user.mjs` turn off Node's network modules (`net`, `tls`, `http`, `https`, `http2`, `dns`, `dgram`) and the `fetch`, `WebSocket` and `EventSource` globals in their own processes and in the Node children they start (`onboarding/lib/local-only.mjs`). That guard covers Node code only. The send hook is a Python child; the tools start it only to run the local scorer.
3. The config's `data` section is fixed: `samplesLeaveMachine`, `samplesToJudges` and `printSampleText` are all `false`, and the config check refuses a file that changes them.
4. The skill never opens files in your samples folder, your AI-drafts folder, the draft overlay or the installed overlay. It never passes `--show-spans` or `--show-files`. If you want to see matched text, you run that command in your own terminal.
5. The skill asks before it changes a file outside the voice folder (`settings.json`, the installed overlay) and backs it up first.

## Before You Start

You need Node.js 18 or later and `python3` (the send hook runs under `python3`). The runbooks also use `jq` to build test payloads. The engine and the onboarding tools live in one folder, `~/.claude/tools` (or `$CLAUDE_CONFIG_DIR/tools`), with the onboarding tools in its `onboarding/` subfolder and the send hook's source in `hook/voice-tell-gate.py`. Claude Code runs an installed copy of the hook, `~/.claude/hooks/scripts/voice-tell-gate.py`. Your own files go in a separate folder, `~/.claude/voice`. Set three shell variables once and use them in every command:

```bash
T="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tools"
V="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/voice"
H="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/scripts/voice-tell-gate.py"
ls "$T/onboarding/voice-doctor.mjs" "$T/aiscore.mjs" "$T/prose-gate.mjs" "$T/text-normalize.mjs" "$T/hook/voice-tell-gate.py"
```

If a file is missing, the install is incomplete. The next paragraph says where the files come from.

Where the files come from: the public starter kit, `https://github.com/jtehrani84/context-engineering`. Clone it and run `./setup.sh` from the root of the clone; it copies the kit's `tools/` folder to `~/.claude/tools`, its hooks to `~/.claude/hooks/scripts` (the send hook and, next to it, the draft gate) and its skills to `~/.claude/commands`, and wires the hooks into `settings.json`: the send hook on `PreToolUse` and `PostToolUse`, and the draft gate on `Stop` with the guarded command `merge-hooks.mjs` writes. The kit ships `prose-gate.mjs`, `text-normalize.mjs`, `calibration/`, `onboarding/`, `hook/` and `hook-tests/` under `tools/` from its 2026-10-02 release that added these docs (`docs/voice/`), and the draft gate (`hook/voice-draft-gate.py`) from its 2026-10-03 release; the kit at 9505301 and earlier ships none of them, and its `voice-tell-gate.py` only nudges on file writes. On an older clone, run `git pull` and then `./setup.sh` again. The engine and the hook must come from the same release: the hook reads a `text-normalize --json` key that older engines don't print.

The send hook must be the copy that ships with the engine. If `$H` is missing or older, install it (keep a dated copy of the old one first):

```bash
[ -f "$H" ] && cp "$H" "$H.bak-$(date +%Y-%m-%d)"
mkdir -p "$(dirname "$H")" && cp "$T/hook/voice-tell-gate.py" "$H"
```

The draft gate, a second hook that checks the drafts Claude shows in chat when a reply ends, installs next to it. Install it before you run `merge-hooks.mjs` (Step 2), which wires the gate only once the script is there. A copy of the tools without `hook/voice-draft-gate.py` is older than the draft gate; the doctor's `draft-gate-wiring` check fails until it is installed:

```bash
cp "$T/hook/voice-draft-gate.py" "$(dirname "$H")/voice-draft-gate.py"
```

Each tool prints `--help`. Their exit codes:

| Tool | 0 | 1 | 2 |
|---|---|---|---|
| `voice-doctor.mjs` | no check failed | at least one check failed | usage error |
| `profile-build.mjs` | draft written | refused (a draft exists), or a bad flag or config | couldn't run: too few or unreadable samples, or the rendered draft doesn't load |
| `calibrate-user.mjs` | no held-out sample failed | one or more failed | it couldn't run |

## Step 1: Run the Doctor

```bash
node "$T/onboarding/voice-doctor.mjs"
```

It prints one line per check (`PASS`, `FAIL`, `WARN` or `INFO`), a `fix:` line under each FAIL, and a summary line that reads `GREEN` or `RED`. To see what each check verifies and what it catches:

```bash
node "$T/onboarding/voice-doctor.mjs" --list
```

After the starter kit's `./setup.sh`, which installs both hooks and wires them, expect two FAILs: `overlay` and `user-calibration`, which steps 4 to 7 fix. Without the kit's `setup.sh`, a new install has four FAILs: `overlay` (no reviewed personal overlay yet), `hook-wiring` and `draft-gate-wiring` (`settings.json` doesn't run the hooks yet) and `user-calibration` (no calibration report yet). Step 2 fixes the two wiring checks and steps 4 to 7 fix the other two. Any other FAIL is an install problem. Fix it before you go on:

| Check | What a FAIL means | What to do |
|---|---|---|
| `runtime` | Node.js older than 18, or no `python3` | Install them and re-run |
| `engine`, `detector`, `detector-pin` | An engine file is missing, or the detector isn't the tested commit | Reinstall the engine (see Before You Start). Never edit the pin to make it pass |
| `scorer`, `normalizer`, `gate` | The tool runs but gives a wrong answer on a fixed probe | Reinstall the engine from one release |
| `hook-wiring` | `settings.json` doesn't run the hook for every send tool and every file write | Step 2 |
| `draft-gate-wiring` | No `Stop` entry runs `voice-draft-gate.py`, or the script isn't where the entry points | Step 2, and install the draft gate (Before You Start) |
| `hook-controls`, `send-fails-closed`, `write-warns` | The hook is missing or older than the engine: it lets a tell through, or lets a send through when its scorer is broken | Install `$T/hook/voice-tell-gate.py` at `$H` (Before You Start) |
| `engine-calibration` | The engine's human false-positive record is missing or shows rejects | Reinstall `calibration/` with the engine |

`judges` is optional. `INFO ... det-only mode` is a normal result: with no judge, a clean draft is INCONCLUSIVE, never ADMIT, and the deterministic checks and the send hook still run.

The doctor changes no files. It runs the scorer, the gate and the hook on fixed made-up texts. It simulates a broken scorer by pointing `VOICE_AISCORE` at a stub in a temporary folder, which it deletes afterwards.

Other doctor flags you may need: `--only <ids>` and `--skip <ids>` run a subset of checks, `--json` prints machine-readable output, and `--config`, `--tools`, `--settings`, `--hook` and `--overlay` point it at non-default paths.

## Step 2: Create the Config and Wire the Hook

Create the config if there is none. Every property has a default, so a missing file means "all defaults", and the example is only a starting point:

```bash
mkdir -p "$V"
[ -f "$V/voice-config.json" ] || cp "$T/onboarding/voice-config.example.json" "$V/voice-config.json"
```

The schema is `$T/onboarding/voice-config.schema.json`, and each property has a description there. Answer four questions and edit `$V/voice-config.json`:

1. **Which model drafts most of your text?** Set `judges.drafterLab` to its lab (`anthropic`, `google`, `openai`, `xai`) or `unknown`.
2. **Can you call models from other labs?** If not, set `judges.mode` to `none` and empty `judges.allowed`. The system then runs det-only, which is a complete setup. If you can, list them in `judges.allowed` with their lab, and set `command` to the judge backend CLI's path when `OPENCODE_BIN` isn't set. A judge never comes from the drafter's lab, because a model under-rates the tells in its own lab's writing; the config check refuses a judge that does. `consensus` needs two labs; `single` runs one judge, and that judge alone decides the judge layer. The example config sets `consensus` with three judges; the schema default is `none`.
   The judge entries in `prose-gate.mjs` (`JUDGES`) name roles, not model ids. `model-roster.mjs` resolves each role to an id your `opencode` install serves, using the pattern for that role in `model-roster.json`. Before you turn judges on, run `node "$T/model-roster.mjs" --all --check`, and edit the patterns in `model-roster.json` if a role doesn't resolve; a juror whose role doesn't resolve errors, and with too few answers the verdict is INCONCLUSIVE.
3. **Which tools send your words somewhere they can't be taken back?** `sendTools` lists them: chat messages, email, shared documents and slides, comments, pull requests and issues by default. A name without the `mcp__` prefix matches that tool under any MCP server. Add your own send tools; a tool you add must also be in the hook's `SEND_SUFFIXES` list in `$H`, and the doctor's `hook-wiring` check fails until it is. Remove none unless you mean to.
4. **Standard or strict?** With `strictness.level` set to `standard`, a held-out sample fails when the gate rejects it or the send hook blocks it. `strict` also counts a nudge.

The other strictness values have defaults you rarely change: `detBar` 40 (the AI-evidence score at which the deterministic layer rejects), `judgeBar` 50 (the mean judge score at which the panel rejects), `heldOutShare` 0.3 and `minSamples` 20.

Check the config and the wiring:

```bash
node "$T/onboarding/voice-doctor.mjs" --only config,hook-wiring,draft-gate-wiring
```

If either wiring check fails, look at what the doctor expects and what will change before you write anything:

```bash
node "$T/onboarding/voice-doctor.mjs" --print-hooks     # the hooks block this config needs
node "$T/onboarding/merge-hooks.mjs" --dry-run          # the hooks section after the merge; nothing written
node "$T/onboarding/merge-hooks.mjs"                    # writes it; an existing file is kept as settings.json.bak-<time>
```

`merge-hooks.mjs` replaces only the entries that run `voice-tell-gate.py` or `voice-draft-gate.py` and keeps every other hook and setting. It wires the send hook on `PreToolUse` and `PostToolUse` and the draft gate on `Stop` (matcher `""`). It writes the file back in the layout it found, so the lines outside the voice entries don't change; Claude Code itself writes `settings.json` with `<`, `>` and `&` as `\u` escapes and no final newline, and that layout is kept. A layout it can't reproduce (a hand-formatted file) is rewritten as 2-space JSON with every value kept, and the tool says so. A `timeout` you set on a voice entry is kept, and names an old list-style send matcher held that the new matcher doesn't cover are printed. A second run with nothing to change writes nothing. If there is no `settings.json` yet it creates one, and each run that changes the file writes a new backup. It also takes `--settings <file>` and `--config <file>`. To uninstall, `--remove` takes every voice entry out the same way, backup first.

If the draft gate's script isn't next to the send hook, `merge-hooks.mjs` doesn't add the `Stop` entry. It prints "skipped the Stop entry" on stderr with the `cp` that installs the script, still wires the send hook, takes out any old draft-gate entry, and exits 0; install the script and run it again. The `Stop` command it writes checks that the script exists before it runs it, so if the file is removed later the reply ends with a "draft not checked" note instead of being blocked.

If `hook-wiring` still fails with "the hook doesn't treat N of the configured send tools as sends", the hook script is the problem, not the wiring: install `$T/hook/voice-tell-gate.py` at `$H` (Before You Start), or add the name to the hook's `SEND_SUFFIXES`. Hooks older than 2026-10-02 skip `manage_spreadsheet_comment`, because they test the read marker `read` against the whole tool name and "spreadsheet" contains it.

The send matcher it writes is a regular expression on purpose. Claude Code reads a matcher made only of letters, digits, `_`, `|`, `,`, `-` and spaces as a list of exact tool names, so an exact name like `send_message` never matches the MCP tool `mcp__chat__send_message`. The rule was read from the Claude Code 2.1.286 bundle and confirmed with a live probe on 2026-10-02; the rule and its evidence are in `$T/onboarding/lib/hook.mjs`.

After a wiring change, restart the Claude Code session so it loads the new hooks. The doctor runs the hook directly, so its checks pass before the restart.

What the draft gate does in a session: when Claude ends a reply that shows a draft for someone else, in a ````draft` fence or after a `Written for:` line, it checks that draft. A hard tell sends Claude back to fix it, and Claude Code shows you "Stop hook error occurred" with a one-line note; that label means the gate blocked the stop, not that something broke. It blocks at most 2 times per reply, and when it can't run it lets the reply end with a "draft not checked" note.

Your own company names (optional). A sentence that opens "As <Name>, we ..." blocks a send for any name, and "As <Name> ..." blocks for a name on the company list whatever follows it: "As Apple pushed the update, the build broke." blocks, though nobody is speaking as Apple. A `!Apple` line in the file below exempts that name, and "As Apple, we ..." still blocks. The hook knows 22 large companies. To add yours, one per line:

```bash
cp "$T/onboarding/templates/company-names.example.txt" "$V/company-names.txt"   # then edit it
```

A line starting `!` marks a name that is never a company (an event, a product you write about), so "As <that name> wraps, ..." stays silent instead of drawing a nudge. It also takes a built-in name off the list when you mean the everyday word: with `!Amazon`, "As Amazon deforestation accelerates, ..." goes out, and "As Amazon, we ..." still blocks. A name is matched on at most four words; a longer line can't match, so the hook skips it and says so. The hook reads `$V/company-names.txt` under `CLAUDE_CONFIG_DIR` too, so the `cp` above puts the file where it looks. `VOICE_COMPANY_NAMES` points the hook at another file. A file the hook can't read leaves the built-in list in force and adds a note to the hook's message, on a send and in a chat draft alike.

## Step 3: Add Your Writing Samples

Put 20 to 40 pieces of your own writing in `$V/samples/`, one piece per `.txt` or `.md` file (`.mdx`, `.markdown` and `.text` also work). Use messages, emails, notes and documents you wrote yourself, without an AI assist, in the registers you want checked. Recent writing is better than old. With fewer than 4 the tools can't split the set. Below `strictness.minSamples` (20 by default) they still run but warn that the held-out set is small. Length matters too: each `REGISTER` habit band needs at least three tune samples long enough to measure (5 or more sentences for the sentence-length band, 150 or more words for contractions, 100 or more for em dashes), so a set of short chat messages leaves those bands off. Copy the files in; don't paste them into a chat.

Count them without reading them:

```bash
ls "$V/samples" | wc -l
```

`profile-build.mjs` and `calibrate-user.mjs` split the samples the same way, by a hash of each text. About 30% (`heldOutShare`) are held out. They are never used to build the overlay, so the test in step 6 runs on writing the overlay hasn't seen.

## Step 4: Draft a Personal Overlay

```bash
node "$T/onboarding/profile-build.mjs"
```

It reads the tune samples locally, measures your habits (sentence length, contractions, very short sentences, dash and ellipsis use, recurring phrases), runs the installed checks on them, and writes one file: `$V/voice-overlay.draft.mjs`, about 380 lines, most of them the overlay's own scanning code. It never writes the installed overlay. It prints counts and statistics only:

- `samples`: how many were used, how many were skipped (shorter than 3 words, or duplicates), and the tune and held-out counts
- `sentences` and `per 1,000`: your measured habits
- `register`: which habit checks are on. A band is off when there aren't enough long samples to set it
- `approved`: lines you really write that a check flagged in 2 or more tune samples. These are candidates for you to keep or delete. The same line also counts the recurring phrases recorded in `PROFILE`

If a draft already exists, `profile-build.mjs` refuses to overwrite it and exits 1. Add `--force` to replace it. Other flags: `--samples <dir>` (or `-` for stdin, split on `--sep`), `--out <file.mjs>`, `--no-scorer`, `--no-hook` and `--json`.

## Step 5: Review the Draft Yourself

Open `$V/voice-overlay.draft.mjs` in your own editor. The skill doesn't open it, because it holds phrases taken from your writing. What to look at:

- `APPROVED_LINES`: keep only lines you write and delete the rest. The overlay's own checks skip these lines. The generic detector and the send hook's word list don't read this list.
- `REGISTER`: your habit bands. A value far outside a band is listed as must-fix by the scorer and the gate, never blocked. The send hook doesn't read these checks, so they don't nudge a send. `null` turns a check off.
- `TEAM_WORDS` and `TEAM_PHRASES`: optional. Words you never use (flagged high; the scorer and the gate count them, the send hook leaves words to its own list) and phrases you would never write (flagged critical, which the send hook blocks).
- `VERDICT_STRUCT_TYPES`: leave it empty unless one check should reject a draft on its own.
- `NOTES`: what `profile-build.mjs` noticed.
- `PROFILE`: your measured habits and recurring phrases, kept for the next build. It holds phrases from your writing, so the privacy note in the file covers it. `ISSUE_PREFIX`, `PROBE` and `BASE_OVERLAY` are settings; leave them as written.
- Last, mark the draft reviewed: the line reads `export const REVIEWED = /*@REVIEWED*/false/*@END*/;`. Change only `false` to `true` and keep the markers.

Confirm the review without printing the file's contents:

```bash
node --input-type=module -e "const m = await import('file://$V/voice-overlay.draft.mjs'); console.log('REVIEWED', m.REVIEWED, '| approved lines', m.APPROVED_LINES.length, '| team words', m.TEAM_WORDS.length, '| team phrases', m.TEAM_PHRASES.length)"
```

## Step 6: Calibrate the Draft on Held-Out Writing

```bash
node "$T/onboarding/calibrate-user.mjs" --overlay "$V/voice-overlay.draft.mjs" --no-report
```

It runs the gate (`prose-gate.mjs --det-only`, so no judge sees a sample) and the send hook (on a synthetic send; nothing is sent) on every held-out sample. A draft overlay is tested in a temporary copy of the engine, which is deleted afterwards. Your own writing must come through clean, so the target line is `HELD-OUT ... 0 failed ... PASS`.

Each failure is listed by sample id, with the check that fired and a suggestion:

| Check | Plain meaning | Usual change |
|---|---|---|
| `send-hook:<prefix>-phrase` | A phrase in `TEAM_PHRASES` is in your own writing | Remove it from `TEAM_PHRASES` |
| `send-hook:<prefix>-struct-*` | A critical structure from a base overlay fired on your writing | Lower its severity in the overlay that defines it, or add the line to `APPROVED_LINES` |
| `send-hook:hard-ban` | The hook's word list blocks a word you really use, or a sentence that opens "As" and a name | Move the word from `BLOCK_WORDS` to `NUDGE_WORDS` in `$H`, or reword; for the opener, lead with the name |
| `ai-evidence` | The generic detector's categories added up past `strictness.detBar` | Raise `detBar` a little, or drop the sample if it isn't really yours |
| `pinned:<type>` | A type in `VERDICT_STRUCT_TYPES` fired on your writing | Remove it from that list |
| `injection:<type>` | The sample reads like an instruction to a grader | Nothing exempts this; keep such text out of gated drafts |

The shipped send hook doesn't read `TEAM_WORDS` hits or the `REGISTER` checks, so those never fail a held-out sample. A hook that reads them reports them as `send-hook:<prefix>-word` and `send-hook:<prefix>-cadence-*`, and the tool's suggestion then names the list or band to change.

Make the change in your editor and re-run until 0 fail.

**Before you rely on the send hook, test it on writing you did not tune on.** The hook's block list is short, so a block word you use now and then can be missing from every sample you tuned with, and the first you hear of it is a blocked send. In a persona run on 2026-10-02 (one author of the public 18F blog, `docs/evidence/persona-2026-10-02.json`), the held-out set passed after one change to the block list, and the hook then blocked 4 of 14 fresh posts by the same author, each one on a block word. So put a few pieces of your own writing that the overlay never saw in a new folder, and run `node "$T/onboarding/calibrate-user.mjs" --overlay "$V/voice-overlay.draft.mjs" --tune "$V/samples" --held-out <that folder> --no-report`. Every block word it reports that you really use, move from `BLOCK_WORDS` to `NUDGE_WORDS` in `$H`. The same list blocks a sentence that opens "As" and a name ("As Acme grows, we..."); if that's how you write, lead with the name instead.

Three cautions:

- Each change you make to pass a held-out sample uses that sample for tuning. After several rounds, add a few new samples so the test stays clean.
- A word you move lives in your installed copy of the hook. Reinstalling the hook replaces that copy, so keep the dated backup and re-apply your moves after an update.
- If the tool warns that the samples changed since the draft was built, re-run step 4 with `--force`.

To see the matched text, run the same command with `--show-spans` in your own terminal, and don't paste the output into a chat. `--show-files` prints sample file names the same way. `--strict` counts nudges as failures for one run, and `--json` prints the report as JSON.

## Step 7: Install the Overlay

The engine (`aiscore.mjs`, `prose-gate.mjs` and `calibration/`) imports the overlay from `$T/voice-overlay.mjs`, the default `paths.overlay`. Back up the file there if one exists, copy the reviewed draft over it, and calibrate the installed file. This run writes the report the doctor reads, `$V/calibration-report.json`:

```bash
O="$T/voice-overlay.mjs"     # or the path in the doctor's overlay line
[ -f "$O" ] && cp "$O" "$O.bak-$(date +%Y-%m-%d)"
cp "$V/voice-overlay.draft.mjs" "$O"
node "$T/onboarding/calibrate-user.mjs"
```

The report records the hashes of the overlay, the scorer, the gate and the hook. A later change to any of them makes it stale, and the doctor's `user-calibration` check fails until `calibrate-user.mjs` runs again. `text-normalize.mjs` is not hashed, so a change to the normalizer alone does not make the report stale; re-run `calibrate-user.mjs` after updating it.

## Step 8 (Optional): Measure Recall on AI Drafts

The deterministic layer is tuned so it never flags your own writing, so it catches few AI drafts by design. How many depends on the drafts: obvious marketing-style drafts are blocked, while drafts from a current model on ordinary topics mostly pass. In the 2026-10-02 persona run the hook blocked 1 of 12 such drafts and the gate rejected none (`docs/evidence/persona-2026-10-02.json`). To see how many it catches on your topics, write 10 or more AI drafts on your own topics with your own model, save them in `$V/ai-drafts/`, and run:

```bash
node "$T/onboarding/calibrate-user.mjs" --ai-drafts "$V/ai-drafts"
```

With judges configured and `judges.aiDraftsToJudges` set to `true`, add `--judge-drafts --drafter <model>` (for example `--drafter claude`) to let the allowed judges read the drafts. Only the AI drafts go to a judge. Your samples never do.

## Step 9: Doctor GREEN

```bash
node "$T/onboarding/voice-doctor.mjs"
```

Setup is done when the last line reads `GREEN` with 0 fail. WARN lines are allowed, but read each one. With judges configured, `--live-judges` sends one fixed made-up sentence to each judge to confirm it answers.

## Later Runs

- After any update to the tools or the hook, run `node "$T/onboarding/voice-doctor.mjs"`. After a hook update, re-apply your `BLOCK_WORDS` moves.
- When the doctor reports `user-calibration` stale, run step 7's last command again.
- When your writing changes (a new role, a new kind of document), add samples and repeat steps 4 to 7.

## Terms Used in This Chapter

**Tune and held-out samples.** Tune samples build the overlay. Held-out samples only test it, so a pass on them says something about writing the overlay hasn't seen.

**Block and nudge.** A block stops a send: the PreToolUse hook denies the tool call. A nudge lets the call through with a note to the model. File writes are only ever nudged. The draft gate's block is different: it doesn't stop anything being sent, it sends Claude back to fix a draft it showed.

**Fails closed.** If the scorer or the normalizer breaks, the hook denies a send instead of letting it through, and warns on a file write. The doctor checks this by breaking them on purpose in a temporary folder.

**Det-only and INCONCLUSIVE.** With no judge, the gate runs its deterministic checks only. A clean draft is then INCONCLUSIVE, never ADMIT, because no reader judged it as a whole.

**Probe.** A random token in the overlay. The doctor scores a text that contains it and checks that the scorer reports it, which shows the engine reads an overlay carrying that token. `calibrate-user.mjs` doesn't rely on the probe alone: unless the engine imports the file under test itself, it builds a temporary engine copy that does, so a draft copied from the installed overlay is never mistaken for it.
