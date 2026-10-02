# Voice System Onboarding

The voice engine in `tools/` is generic until you calibrate it to your own writing. Out of the box it runs the vendored detector and the send hook's word list, with a blank personal overlay (`tools/voice-overlay.mjs`, `REVIEWED = false`). Calibration adds the words, phrases and habits that are tells in your writing, checks that your own held-out writing passes, and ends with `voice-doctor` GREEN.

The full walkthrough is chapter 01 of the voice docs, [Getting Started](docs/voice/01-getting-started.md), also on the docs site under `docs/voice/site/`. This page is the short version.

**What calibration does and doesn't buy.** It makes the guard catch generic AI writing and stop flagging your own writing. It does not catch a model told to imitate you: the docs report mimicry recall of 0 of 11 for the system these tools come from (chapter 06, "Calibration and Evidence"). A GREEN doctor run means the install is correct and your held-out writing passes. It does not mean a clean score proves you wrote something.

## Run It

In Claude Code, type `/voice-setup`. The skill runs the steps below in order and asks before it changes `settings.json` or installs an overlay. You can also run each command yourself, with `T=~/.claude/tools` and `V=~/.claude/voice`.

1. **Doctor.** `node "$T/onboarding/voice-doctor.mjs"` lists what is missing. On a fresh install it reports RED until the steps below are done.
2. **Config and hook wiring.** Copy `$T/onboarding/voice-config.example.json` to `$V/voice-config.json` and answer its four questions (drafter lab, judges, send tools, strictness). `./setup.sh` already wired `voice-tell-gate.py` on file writes and on the default send tools; if you add send tools, `node "$T/onboarding/merge-hooks.mjs"` rewrites that entry.
3. **Samples.** Put 20 to 40 pieces of your own writing, one per file, in `$V/samples`. Use text you typed yourself, not a model's draft you edited, and remove customer names, deal values, credentials and personal data first.
4. **Draft an overlay.** `node "$T/onboarding/profile-build.mjs"` measures your samples and writes `$V/voice-overlay.draft.mjs`. It prints counts and sample ids, never sample text.
5. **Review the draft.** Open the draft yourself, keep or cut each entry, and set `REVIEWED = true`.
6. **Calibrate on held-out writing.** `node "$T/onboarding/calibrate-user.mjs" --overlay "$V/voice-overlay.draft.mjs" --no-report` checks that your held-out samples pass the gate and the send hook.
7. **Install the overlay.** Back up `$T/voice-overlay.mjs`, copy the reviewed draft over it, and run `node "$T/onboarding/calibrate-user.mjs"` to write the report the doctor reads.
8. **Doctor GREEN.** `node "$T/onboarding/voice-doctor.mjs"`.

Your samples stay on the machine: `profile-build.mjs` and `calibrate-user.mjs` turn off Node's network modules in their own processes, the config check refuses a file that sets `samplesLeaveMachine`, `samplesToJudges` or `printSampleText` to anything but `false`, and no step sends a sample to a judge or a model.

A later `./setup.sh` keeps the overlay you installed, because it differs from the kit's blank copy. When an upgrade changes the scorer, the gate or the hook, the doctor's `user-calibration` check fails until you run `calibrate-user.mjs` again.

## The Eval Harness

`harness-evolution/harness-eval.mjs` scores the labeled passages in `harness-evolution/corpus.json` and gates a change to your overlay against a saved baseline:

```
node ~/.claude/harness-evolution/harness-eval.mjs --save baseline.json   # starting separation score
node ~/.claude/harness-evolution/harness-eval.mjs --gate baseline.json   # after a change: ADMIT or REJECT
```

The shipped passages are a generic seed (`seed: true`). Add your own as `origin: 'self'` (human) next to known AI passages, and keep a `heldout` split you never tune on.

## Upgrading From a Release Before 2026-10-02

Earlier releases shipped `tools/voice-setup.mjs` (the calibration fuse) and `tools/voice-overlay.skeleton.mjs`. `voice-doctor.mjs` and `onboarding/templates/voice-overlay.template.mjs` replace them, and `./setup.sh` removes an unedited copy of either. If you had filled in the old `tools/voice-overlay.mjs`, setup keeps it and prints a warning: aiscore and the send hook still read it, but `prose-gate.mjs` needs `VERDICT_STRUCT_TYPES`, which only the new template defines. Run `/voice-setup` to build a reviewed overlay in the new format, and copy your old word and phrase lists into its `TEAM_WORDS` and `TEAM_PHRASES` by hand.
