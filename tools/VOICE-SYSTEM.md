# The Voice System

The voice engine checks writing for generic AI tells before it reaches anyone else. Everything here runs locally except the optional judge panel. The full documentation is in `../docs/voice/` (rendered site: `../docs/voice/site/index.html`): architecture, threat model, runbooks, the reference generated from the code, and the calibration evidence.

## The Pieces

| File | What it does |
|---|---|
| `aiscore.mjs` | The deterministic scorer. Wraps the vendored detector (`avoid-ai-writing/`, MIT, pinned at commit 58a95fc), adds your overlay, and prints a raw `score`, an `adjustedScore` counted only from detector categories that held up as AI evidence, and the overlay's issues as must-fix. Exits 0 on every completed scan. |
| `text-normalize.mjs` | Canonical text for scanning: NFKC, invisible and tag characters removed, look-alike letters mapped, emphasis and inline markup reduced. `node text-normalize.mjs --json < file` prints both views. |
| `prose-gate.mjs` | The ship gate: the deterministic layer, then an optional judge panel that never seats a judge from the drafter's lab. `--det-only` runs locally with no network call. Fails closed: exit 4 when a layer fails. |
| `model-roster.mjs`, `model-roster.json`, `opencode-llm.mjs` | The judges name model roles (`grok`, `gpt`, `gemini-pro`, `sonnet`), not model ids. `model-roster.mjs` resolves each role, at call time, to the newest id `opencode models` lists that matches the role's pattern in `model-roster.json`, logs a change to `~/.cache/model-roster/changes.log`, and fails loudly when nothing matches; `opencode-llm.mjs` runs the call. `node model-roster.mjs --all --check` shows what each role resolves to; edit the patterns if your providers name models differently. When two providers list the same model (a lab's own provider and a router that re-serves it), that role is ambiguous until you name its provider: `MODEL_ROSTER_PROVIDERS=sonnet=anthropic,gpt=openai` (or `"provider"` on the role in `model-roster.json`); `MODEL_ROSTER_PROVIDER` sets one provider for every role. A call that goes ahead with a changed id, or with the last-known id because `opencode models` failed, says so on stderr. For one line at session start when a role's id has changed, add `{ "type": "command", "command": "node ~/.claude/tools/model-roster.mjs --notice" }` to your `SessionStart` hooks; it reads only the cache directory, never blocks, and always exits 0. The resolver is vendored unchanged (`model-roster.vendor.json`, `model-roster.drift.test.mjs`); the role list is yours. |
| `voice-overlay.mjs` | Your personal overlay. Ships blank (`REVIEWED = false`); `/voice-setup` installs your reviewed copy here. |
| `hook/voice-tell-gate.py` | The send hook's source (`./setup.sh` installs it in `~/.claude/hooks/scripts/`). It nudges on file writes (a file under `drafts/` at any length) and blocks a send with a hard tell, a sentence that opens "As <Company>" in company voice or with a listed company, and any send it can't score. Your own company names go in `~/.claude/voice/company-names.txt`. Tests: `hook-tests/voice-tell-gate.test.py`. |
| `hook/voice-draft-gate.py` | The draft gate's source, a Stop hook installed next to the send hook. When a reply ends it checks a draft shown in a ` ```draft ` fence with the send hook's scorer and sends Claude back to fix a hard tell; if it can't run, the reply ends with a "draft not checked" note. `./setup.sh` wires it with a guarded command, so a missing script never blocks a reply. Tests: `hook-tests/voice-draft-gate.test.py`. |
| `onboarding/` | `/voice-setup`'s tools: `voice-doctor.mjs`, `profile-build.mjs`, `calibrate-user.mjs`, `merge-hooks.mjs` (wires the send hook and the draft gate; `--remove` takes them out), the config schema and example, the blank overlay template and `templates/company-names.example.txt`. |
| `calibration/` | The human false-positive budget on four public corpora (`fetch-public-corpora.sh`, then `human-fp-budget.mjs`; its hook lane runs the send hook's word list through `hook-lexicon.py`) and `gate-eval.mjs`. |

## The Rule

A clean automated score is a signal, not a verdict. For anything a customer, a leader or the public reads, run the engine, the structural rules in `../rules/structural-voice.md`, the `/voice-judge` read and a human read. The checks catch generic AI writing; they do not catch a model told to imitate a specific person, so a clean result never shows who wrote a text. Chapter 06 of the docs gives the measurements behind both statements.

## Getting Started

Type `/voice-setup` in Claude Code, or follow `../VOICE-ONBOARDING.md`. `node ~/.claude/tools/onboarding/voice-doctor.mjs` reports what is installed and what is missing.
