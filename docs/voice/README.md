# Voice System Docs (Public Edition)

The documentation for the voice engine in `tools/`: the scorer, the normalizer, the gate, the send hook and the `/voice-setup` onboarding. It is the public edition, written for engineers who install the kit and for outside reviewers (chapter 09 is the review packet).

- Markdown chapters: this folder, `00-overview.md` to `10-maintaining-the-docs.md`.
- Rendered site: `site/`, served by GitHub Pages at `https://jtehrani84.github.io/context-engineering/docs/voice/site/`.
- `facts.json`: every number the chapters print, produced by running the tools. `BUILD.json`: the sha256 of each chapter as built.

## Where It Comes From

The chapters are generated, so edit the source, not these files. The source is the docs build in the voice-system repo (`docs/src`, `docs/tools`), which assembles each edition from one markdown source, fills the numbers from the facts file, generates the reference chapter from the code, and fails the build on a leak check. This copy was built on 2026-10-02 from voice-system commit 1520633, with facts measured at b4534e3.

One kit-port change was applied to the source before the build: the install-status sentences in chapters 00, 01 and 09 now say that this kit ships the onboarding tools, the hook and the calibration harness under `tools/`, from the 2026-10-02 release that added this folder. The build at 1520633 described the kit at 9505301, which did not ship them yet. Until the same change is in the voice-system source, a rebuild there drops it.

## What Differs in the Kit's Tools

The chapters describe the engine at 1520633. The kit's copy in `tools/` is the same engine with these differences:

- `tools/voice-overlay.mjs` is the blank template; `/voice-setup` installs your reviewed overlay there.
- `aiscore.mjs` names its overlay block `voice` in JSON output (the kit's `harness-evolution/harness-eval.mjs` reads it), and its `CADENCE_POINTS` map is empty, so `--cadence-weight` adds nothing until your overlay's cadence types get weights.
- The judge entries in `prose-gate.mjs` are example model ids in opencode's provider/model form; set them to ids your opencode install can reach before you turn judges on.
- The hook source is `tools/hook/voice-tell-gate.py`; `./setup.sh` installs it as `~/.claude/hooks/scripts/voice-tell-gate.py`. Its `FULL_EXEMPT` set starts empty.
- `tools/calibration/` measures the false-positive budget on the four public corpora only. On 2026-10-02 the kit's tools rejected 0 of 18,335 documents, the same as the recorded baseline.
- The `/voice-setup` skill is `skills/voice-setup.md` at the kit root, which `./setup.sh` installs as `~/.claude/commands/voice-setup.md`, not a `skills/` folder under `tools/`.
- `tools/aiscore.test.mjs` has 18 cases, not the 20 in the reference chapter's test table: the cases that tested one writer's overlay are replaced by cases a blank overlay must pass. `tools/text-normalize.test.mjs` (62 cases) is kit-only; it tests the normalizer directly. `bash scripts/test-all.sh` runs every voice suite.
