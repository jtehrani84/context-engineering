# The Voice System

The voice engine checks writing for generic AI tells before it reaches anyone else. Everything here runs locally except the optional judge panel. The full documentation is in `../docs/voice/` (rendered site: `../docs/voice/site/index.html`): architecture, threat model, runbooks, the reference generated from the code, and the calibration evidence.

## The Pieces

| File | What it does |
|---|---|
| `aiscore.mjs` | The deterministic scorer. Wraps the vendored detector (`avoid-ai-writing/`, MIT, pinned at commit 58a95fc), adds your overlay, and prints a raw `score`, an `adjustedScore` counted only from detector categories that held up as AI evidence, and the overlay's issues as must-fix. Exits 0 on every completed scan. |
| `text-normalize.mjs` | Canonical text for scanning: NFKC, invisible and tag characters removed, look-alike letters mapped, emphasis and inline markup reduced. `node text-normalize.mjs --json < file` prints both views. |
| `prose-gate.mjs` | The ship gate: the deterministic layer, then an optional judge panel that never seats a judge from the drafter's lab. `--det-only` runs locally with no network call. Fails closed: exit 4 when a layer fails. |
| `voice-overlay.mjs` | Your personal overlay. Ships blank (`REVIEWED = false`); `/voice-setup` installs your reviewed copy here. |
| `hook/voice-tell-gate.py` | The hook source (`./setup.sh` installs it in `~/.claude/hooks/scripts/`). It nudges on file writes and blocks a send with a hard tell, and it denies any send it can't score. Tests: `hook-tests/voice-tell-gate.test.py`. |
| `onboarding/` | `/voice-setup`'s tools: `voice-doctor.mjs`, `profile-build.mjs`, `calibrate-user.mjs`, `merge-hooks.mjs`, the config schema and example, and the blank overlay template. |
| `calibration/` | The human false-positive budget on four public corpora (`fetch-public-corpora.sh`, then `human-fp-budget.mjs`) and `gate-eval.mjs`. |

## The Rule

A clean automated score is a signal, not a verdict. For anything a customer, a leader or the public reads, run the engine, the structural rules in `../rules/structural-voice.md`, the `/voice-judge` read and a human read. The checks catch generic AI writing; they do not catch a model told to imitate a specific person, so a clean result never shows who wrote a text. Chapter 06 of the docs gives the measurements behind both statements.

## Getting Started

Type `/voice-setup` in Claude Code, or follow `../VOICE-ONBOARDING.md`. `node ~/.claude/tools/onboarding/voice-doctor.mjs` reports what is installed and what is missing.
