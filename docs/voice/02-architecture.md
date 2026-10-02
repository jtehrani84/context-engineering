<!-- built from docs/src/02-architecture.md for the public edition at tools commit b4534e3 -->
# Architecture

This chapter describes the layers of the voice system, how text moves through them on a file write, a send and a gate run, what may leave the machine, and what the system depends on. It describes the code at tools commit b4534e3. Flags, exit codes and environment variables are listed in full in the Reference chapter, which is generated from the code.

## Components

| File | Role |
|---|---|
| `text-normalize.mjs` | Canonical text and a rendered view for every scan; a CLI the hook calls |
| `aiscore.mjs` | Deterministic scorer: HTML reduction, normalization, the detector, the overlay, the evidence score |
| `ai-evidence.mjs` | Decides which detector categories count toward `adjustedScore` and at what weight |
| `voice-overlay.mjs` | The overlay module the engine imports: personal words, phrases, structures, cadence checks, approved lines and the verdict-driving structure list |
| `prose-gate.mjs` | Gate: deterministic layer, injection check, judge panel, one verdict and exit code |
| `hook/voice-tell-gate.py` | Claude Code hook, installed at `~/.claude/hooks/scripts/voice-tell-gate.py`: blocks sends, nudges file writes after they are saved, fails closed |
| `calibration/` | Public corpus fetch, the human false-positive budget, gate evaluation over labeled sets |
| `onboarding/` | `voice-doctor.mjs`, `profile-build.mjs`, `calibrate-user.mjs`, `merge-hooks.mjs`, the overlay template |
| avoid-ai-writing detector | Third-party pattern library, cloned beside the tools and pinned to one commit |

Each judge entry in `prose-gate.mjs` names a vendor, a backend and a model id, and `callJudge` dispatches the call. The overlay module is the user's own copy of the blank template.

## Layers

### Normalization

`text-normalize.mjs` produces two views of the input. The canonical view removes invisible characters (zero-width, bidirectional controls, Unicode tag characters, variation selectors and other format characters), applies NFKC, folds look-alike letters to Latin, unifies quote, dash and space variants, and strips markdown and inline-HTML emphasis markers so they cannot split a phrase. The rendered view shows the text the way a reader sees it: markup rendered, entities decoded, combining marks and look-alikes folded. `revealTags` decodes tag characters into the ASCII they spell, so a hidden instruction can be checked as text.

The overlay checks and the injection check read the canonical view, and the rule C pin and the injection check also read the rendered view. The detector gets a lighter form (`normalizeForDetector`), because some of its own categories count the characters the canonical view removes. `aiscore.mjs --no-normalize` scans the bytes as given, for comparison runs only.

### Deterministic Score

`aiscore.mjs` reduces HTML to prose (unless `--raw`), normalizes, runs the detector and then the overlay, and prints one report. The detector defines 51 categories. `ai-evidence.mjs` marks 9 of them as counted, with a weight, and 42 as not counted, each with a reason code (`NOISE`, `STYLE`, `LINT` or `UNTESTED`). The report carries two scores:

- `score`, the raw detector sum over every category. The send hook reads this one.
- `adjustedScore`, the sum over counted categories only. The gate rejects on this one.

Cadence checks (sentence rhythm) print as must-fix and add nothing to `adjustedScore` unless `--cadence-weight` is passed for a calibration comparison. The scorer exits 0 whatever the score. It exits non-zero only when it cannot run (a crash, or an input file it cannot read), and every caller treats that as a failure.

### Overlay Checks

The overlay module adds the checks that belong to one writer: banned words, banned phrases, structures (sentence shapes such as an announced hedge), cadence checks, and a list of approved lines that the aphorism structures skip. Each structure carries a severity: critical, high, medium or low. A structure with no explicit severity defaults to critical; the Reference chapter prints the effective value.

One list in the overlay, `VERDICT_STRUCT_TYPES`, names the structures allowed to move the gate verdict. Every other overlay hit prints as must-fix and leaves the verdict alone. The overlay these docs were measured on pins 1 structure in that list (rule C). The send hook reads the overlay's structures and phrases by severity, under any issue prefix, which is a different policy; see Two Policies below.

### The Gate

`prose-gate.mjs` runs `aiscore.mjs --json` as a child process with a 120,000 ms timeout (`PROSE_GATE_AISCORE_TIMEOUT_MS` overrides it) and SIGKILL, checks that the result has a numeric `score`, a numeric `adjustedScore` and a usable issue list, and stops with ERROR (exit 4) if any of that fails. No judge is called after an ERROR.

The deterministic layer rejects when any of these holds:

- `adjustedScore` is at or above the det-bar (default 40)
- a structure listed in `VERDICT_STRUCT_TYPES` fired
- the injection check found text addressed to a grader (10 patterns of 7 types, run on the canonical text, the rendered view and the decoded tag characters)

When judges are on, the gate picks a panel. The registry holds 4 judges from these vendors: xai, google, anthropic, openai. `pickJudge` removes every judge whose vendor matches the drafter's vendor (from `--drafter`), takes the first two remaining judges in the order set for that vendor, and keeps the rest as spares. The default drafter is `unknown`, which removes no vendor: its order is `grok`, then `gpt`, with `gemini` as the only spare, so an undeclared draft from one of those labs can be judged by its own lab. Name the drafter when it is known. A `--judge` override from the drafter's own vendor is refused with a warning. Each judge gets the text with invisible characters removed, between two markers that carry a fresh random nonce per call, and returns JSON with `clockable`, `ai_ness`, `loudest_tell` and `spans`. Each `opencode` call has a 150,000 ms timeout, and every judge call gets one retry. A reply without a clockable YES or NO and a numeric `ai_ness` counts as a failed call, never as a vote. In consensus mode a juror that fails is replaced by the next spare.

With the default consensus panel, the judge layer rejects when at least two jurors answered and either their mean `ai_ness` is at or above the bar (default 50) or every answering juror said `clockable` YES. A single surviving consensus juror cannot reject. With `--judge <name>`, the panel is that one judge, and its answer alone decides the judge layer: it can reject and it can admit. Other chapters refer to this paragraph for the juror rule. The verdict follows:

| Verdict | Exit | When |
|---|---|---|
| REJECT | 2 | either layer rejects; a deterministic reject wins even when no judge ran |
| ADMIT | 0 | the deterministic layer passes and enough jurors answered and none of the judge rules fired |
| INCONCLUSIVE | 3 | the deterministic layer passes and fewer jurors answered than the panel needs, which includes every passing `--det-only` run |
| ERROR | 4 | the scorer failed, hung or returned unusable output, or the gate itself failed |

Exit 1 is a usage error. ADMIT needs both layers, so a run that never reached a judge cannot ADMIT.

### The Send Hook

`voice-tell-gate.py` is wired twice in Claude Code's `settings.json`:

- **PreToolUse on send tools: BLOCK tier.** The hook treats a tool as a send tool when its name contains one of 31 send-tool names and its own name (the part after the last `__`) has none of 8 read markers (`read`, `search`, `list`, `get` and others) as a whole word. It collects the prose strings from the tool input (recursively, skipping addresses, ids, URLs, paths and other plumbing keys), runs the scorer and the normalizer, and denies the call when it finds a hard-ban pattern.
- **PostToolUse on `Write|Edit|MultiEdit`: NUDGE tier.** For a file with one of 7 prose extensions, when the text written (the content, the edit's new text, or a MultiEdit's new texts joined) is at least 400 characters, the hook adds a note to the conversation listing what it found. It never blocks a file write.

On a send, the hook blocks on any critical-severity overlay structure (`<prefix>-struct-*`, under any issue prefix), on an overlay phrase that the overlay marks critical or the hook's lexicon marks as blocking, and on its own word and phrase lexicon. It doesn't read overlay word hits or cadence checks. It nudges on high and medium structures, on dual-use words, and when the raw detector `score` is at or above 40 on text longer than 200 characters. The hook calls `node aiscore.mjs - --json` with a 20 second timeout (`VOICE_SCORER_TIMEOUT`; a value outside 0 < x <= 40 falls back to the default) and `node text-normalize.mjs --json` with a timeout capped at 10 seconds, and checks that the normalizer read exactly as many code points as it sent. It never calls the gate or a judge.

The lexicon and the send-tool list are data at the top of the hook script. The starter kit ships them tuned for one writer's tools; edit them for the chat, email, document and code-review tools you use.

### Two Policies

The hook and the gate read the same scorer and decide differently, by design:

| Question | Send hook | Gate |
|---|---|---|
| Which overlay hits decide? | every critical-severity structure and critical overlay phrase, plus the hook's own lexicon | only structures in `VERDICT_STRUCT_TYPES` |
| Which score? | raw `score`, and only to nudge | `adjustedScore` against the det-bar |
| Judges? | never | unless `--det-only` |
| Failure mode | deny the send | ERROR, exit 4 |

The hook is the fast local guard on every send, so it blocks on the full hard-ban list. The gate is the release decision for a finished draft, so only checks with a measured human false-positive count of zero move its verdict (see the Decision Log, D2 and D3).

## Data Flow

The diagram shows the three entry points. Boxes inside the dashed line run on the user's machine. The only arrow that crosses it during a check is the judge call; the other network use, the corpus fetch for calibration, is in the Data Boundary table. The hook sees only Claude Code tool calls: text sent by a shell command (`curl`, `gh`, a chat CLI) never reaches it.

```
  Claude Code                                          command line
  ───────────                                          ────────────
  send tool call        file write                     prose-gate.mjs <file> --drafter X
  (PreToolUse)          (PostToolUse)                        │
        │                    │                               │
        ▼                    ▼                               ▼
 ┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
 │ voice-tell-gate.py                   │   │ prose-gate.mjs                       │
 │  harvest prose strings / read file   │   │  run aiscore as a child (timeout,    │
 │  run text-normalize --json           │   │  SIGKILL), validate its JSON         │
 │  run aiscore - --json                │   │  injection check: canonical,         │
 │  lexicon on normalized text          │   │  rendered, decoded tag characters    │
 │  tiers: BLOCK / NUDGE                │   │  deterministic verdict               │
 └──────────────┬───────────────────────┘   └───────┬───────────────────┬──────────┘
                │                                   │                   │ judges on, no
                ▼                                   ▼                   │ injection hit
 ┌──────────────────────────────────────────────────────────────┐       │
 │ aiscore.mjs                                                  │       │
 │  HTML to prose ─► text-normalize ─► detector (pinned)        │       │
 │                                   └► overlay checks          │       │
 │  ai-evidence: score and adjustedScore                        │       │
 └──────────────────────────────────────────────────────────────┘       │
                                                                        │
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - │ - - - machine boundary
                                                                        ▼
                                                   ┌────────────────────────────────────┐
                                                   │ judge panel (two jurors + spares,  │
                                                   │ not the named drafter's vendor)    │
                                                   │ input: stripped text in a nonce    │
                                                   │ fence; output: JSON per juror      │
                                                   └────────────────────────────────────┘
```

On a send, the decision is the hook's JSON reply to Claude Code: `permissionDecision: deny` with a reason, a note in `additionalContext`, or nothing. On a file write, it is a note or nothing. On a gate run, it is the verdict line (or JSON with `--json`) and the exit code. The injection check runs before any judge, so text addressed to a grader is rejected without being sent. Any other deterministic reject still goes to the judges when they are on, so the report carries both layers. That text leaves the machine even though the verdict is already REJECT; pass `--det-only` when that matters.

## Data Boundary

For the gate, the hook, the onboarding tools and the docs tools, text leaves the machine only in the cases below.

| Path | What leaves | To whom | How to keep it local |
|---|---|---|---|
| `prose-gate.mjs` with judges | the text under test, invisible characters removed, inside the nonce fence | the jurors picked for that run, plus a spare when a juror fails (consensus mode) | `--det-only`; an injection hit also stops the call |
| `calibrate-user.mjs --judge-drafts` | the AI drafts the user supplied with `--ai-drafts` | the judges the user's config allows | leave out `--judge-drafts` |
| `voice-doctor.mjs --live-judges` | one fixed made-up sentence | the configured judges | leave out `--live-judges` |
| `calibration/fetch-public-corpora.sh` | nothing; it downloads public corpora and checks each file against `public-corpora.sha256` | the public hosts of those corpora | fetch once, then point `VOICE_CORPORA` at the copy |

What never leaves:

- **The send hook's input.** The hook scores locally and never calls a model. The text in a send tool call goes wherever that tool sends it; the hook only decides whether the call may run.
- **Writing samples.** `profile-build.mjs` and `calibrate-user.mjs` load `onboarding/lib/local-only.mjs` before anything else. It makes Node's network modules (`net`, `tls`, `http`, `https`, `http2`, `dns`, `dgram`) and the `fetch`, `WebSocket` and `EventSource` globals throw before connecting, in the tool and in the Node processes it starts. A Node child started without that environment, or a non-Node child, is not covered. Reports name samples by id (`s01`, `s02`) and check, never by their text, unless the user passes `--show-spans` in a terminal they run themselves.
- **Docs builds.** The facts file, the reference generator, the edition builds, the site renderer and `verify-docs` all run locally. Private sets are counted, never copied into a fact.

Run the gate with `--det-only` on anything you would not paste into a third-party model: private messages, unpublished work, other people's writing.

## Dependencies and Pins

| Dependency | Version or pin | Checked by |
|---|---|---|
| Node | ES modules; no `package.json`, no npm packages | `voice-doctor.mjs` runtime check |
| Python 3 | standard library only | the hook and its tests; `voice-doctor.mjs` |
| avoid-ai-writing detector (MIT, github.com/conorbronsdon/avoid-ai-writing) | commit 58a95fc, with the sha256 of `detector/patterns.js` recorded in `onboarding/detector-pin.json` | `voice-doctor.mjs` `detector-pin` check (commit and hash); `aiscore.test.mjs` "every detector category is classified exactly once" |
| Public calibration corpora | 18F blog and Python PEPs at fixed commits, 18 RFCs, the 20 Newsgroups by-date tarball; sha256 per file | `calibration/fetch-public-corpora.sh` against `calibration/public-corpora.sha256` |
| Judge backend | one command per judge entry, named in the judge registry in `prose-gate.mjs` | `voice-doctor.mjs` judge checks; `--live-judges` for a real call |
| bash, curl, tar | system versions | corpus fetch only |

The detector is a separate clone beside the tools (`avoid-ai-writing/`), loaded with `require` from `AVOID_AI_DETECTOR` or the default path. Its `patterns.js` has no imports. Whether the clone is at the pinned commit when these facts were written: yes. `aiscore.mjs` does not check the pin when it loads the detector; the doctor does, and the Threat Model chapter covers what that leaves open.

Every calibration number in these docs was measured on the pinned detector. Moving the pin means re-running `calibration/gate-eval.mjs` and `calibration/human-fp-budget.mjs` on the new commit first; the Runbooks chapter has the steps.
