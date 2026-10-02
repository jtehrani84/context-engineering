# /review — Multi-Model Adversarial Document Review

Route documents to a frontier model from a **different lab than the one that drafted them** for adversarial QA. A same-model judge grades its own house style too kindly, so the reviewer is never the model that wrote the draft. Returns structured feedback categorized by severity.

## Usage

```
/review [file_path]                          # Auto-detect mode, use your configured reviewer
/review [file_path] --adversarial            # Force adversarial (skeptical-reader pass)
/review [file_path] --editorial              # Force editorial (structure + reader empathy)
/review [file_path] --model <model-id>       # Force a specific reviewer
```

## What to Do

1. Read the file at the specified path (or ask the user which file to review)
2. Run the review script (installed by setup.sh):
   ```bash
   python3 ~/.claude/scripts/llm-review.py [FILE_PATH] [--mode MODE] [--model MODEL]
   ```
   If one reviewer times out or returns empty, re-run with another `--model`. The only rule is that it isn't the lab that wrote the draft.
3. Display the structured findings to the user
4. For each finding, evaluate whether it's valid given YOUR knowledge of the codebase:
   - If the external model flags something that contradicts source-verified facts → note it's INVALID and explain why
   - If the finding is valid → suggest how to fix it
   - If it's a judgment call → present both sides

## Mode Selection (Auto-Detect)

| Content Pattern | Mode | Why |
|---|---|---|
| `*-competitive-*`, `*-strategy-*`, `*-proposal-*`, emails and announcements | adversarial | Simulates a skeptical reader who wants to say no |
| Reference docs, briefs, wiki pages, demo scripts | editorial | Structural editor + reader empathy |
| Override with --model or --mode anytime | | |

The reviewer for each mode comes from `LLM_REVIEW_ADVERSARIAL_MODEL` and `LLM_REVIEW_EDITORIAL_MODEL` (both fall back to `LLM_MODEL`). Pick a premium reasoning model from another lab for the adversarial pass; the editorial pass can use a cheaper one.

## Critical Rules

- **NEVER auto-apply findings.** Present them. Let the user decide.
- **Make each finding earn its fix.** For code, a finding counts once it's a failing test. For prose, once you can point at the exact claim and the source it contradicts. A finding you can't reproduce gets dismissed with a reason, not obeyed.
- **Evaluate against codebase context.** The external model doesn't have source access. Some findings will be wrong because the reviewer doesn't know what we've verified.
- **Flag when the external model is wrong.** If a reviewer challenges a claim we source-verified, say so explicitly: "This finding is INVALID — we verified X against [source]."
- **Don't send sensitive data.** No customer names, account IDs, deal values, secrets, or private code to an outside model. Ask before sending anything you are unsure about.

## Available Models

Run `python3 ~/.claude/scripts/llm-review.py --list-models` to see which reviewers are configured. There is no built-in catalog: your provider's model list is the source of truth, so confirm with one live call before relying on a model.

## Requirements

- `LLM_BASE_URL` and `LLM_API_KEY` for an OpenAI-compatible endpoint (or set `LLM_API_STYLE=anthropic` for an Anthropic-style one). See the header of `~/.claude/scripts/llm-call.py`.
- Reviewer model ids in `LLM_REVIEW_EDITORIAL_MODEL` / `LLM_REVIEW_ADVERSARIAL_MODEL`, or `--model` on each call.
