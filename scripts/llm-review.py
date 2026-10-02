#!/usr/bin/env python3
"""
llm-review.py: send a document to a reviewer model from a DIFFERENT lab than the one that drafted it.

    python3 llm-review.py FILE [--mode editorial|adversarial] [--model MODEL]
    python3 llm-review.py --list-models

Uses the same endpoint settings as llm-call.py (LLM_BASE_URL, LLM_API_KEY, LLM_API_STYLE,
LLM_MODEL_ALIASES). Pick the reviewers once:
    LLM_REVIEW_EDITORIAL_MODEL     model id (or alias) for editorial passes
    LLM_REVIEW_ADVERSARIAL_MODEL   model id (or alias) for adversarial passes
Both fall back to LLM_MODEL. Choose models from a different lab than your drafter: a same-model judge
grades its own house style too kindly, which is the whole reason this script exists.

The review prompts live next to this script in review-prompts/{editorial,adversarial}.txt.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

_spec = importlib.util.spec_from_file_location("llm_call", Path(__file__).resolve().parent / "llm-call.py")
llm_call = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(llm_call)

PROMPTS_DIR = Path(__file__).parent / "review-prompts"
MAX_CHARS = 100000


def reviewer_for(mode):
    env = "LLM_REVIEW_ADVERSARIAL_MODEL" if mode == "adversarial" else "LLM_REVIEW_EDITORIAL_MODEL"
    return os.environ.get(env, "") or os.environ.get("LLM_MODEL", "")


def load_prompt(mode):
    prompt_file = PROMPTS_DIR / f"{mode}.txt"
    if not prompt_file.exists():
        print(f"ERROR: Prompt template not found: {prompt_file}", file=sys.stderr)
        sys.exit(1)
    return prompt_file.read_text()


def detect_mode(file_path):
    """Adversarial for arguments and outbound messages, editorial for everything else."""
    name = file_path.name.lower()
    if any(k in name for k in ("competitive", "positioning", "strategy", "proposal", "pitch")):
        return "adversarial"
    if any(k in name for k in ("email", "reply", "message", "announcement")):
        return "adversarial"
    return "editorial"


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Review a document with a second-lab model")
    parser.add_argument("file", nargs="?", help="Path to file to review")
    parser.add_argument("--model", help="Reviewer model id or alias (overrides the LLM_REVIEW_* settings)")
    parser.add_argument("--mode", choices=["editorial", "adversarial"], help="Override review mode")
    parser.add_argument("--max-tokens", type=int, default=16000,
                        help="Output budget; reasoning models spend part of it thinking (default 16000)")
    parser.add_argument("--list-models", action="store_true", help="Show which reviewers are configured")
    args = parser.parse_args()

    if args.list_models:
        cfg = llm_call.config()
        print(f"Endpoint: {cfg['base'] or 'LLM_BASE_URL NOT SET'} ({cfg['style']})")
        print(f"  editorial reviewer:   {reviewer_for('editorial') or 'NOT SET (LLM_REVIEW_EDITORIAL_MODEL)'}")
        print(f"  adversarial reviewer: {reviewer_for('adversarial') or 'NOT SET (LLM_REVIEW_ADVERSARIAL_MODEL)'}")
        for k, v in sorted(cfg["aliases"].items()):
            print(f"  alias {k} -> {v}")
        sys.exit(0)

    if not args.file:
        parser.error("FILE is required (or use --list-models)")
    file_path = Path(args.file).resolve()
    if not file_path.exists():
        print(f"ERROR: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    content = file_path.read_text()
    if len(content) > MAX_CHARS:
        print(f"WARNING: File is {len(content)} chars. Truncating to {MAX_CHARS} for review.", file=sys.stderr)
        content = content[:MAX_CHARS]

    mode = args.mode or detect_mode(file_path)
    model = args.model or reviewer_for(mode)
    if not model:
        print("ERROR: No reviewer model configured. Set LLM_REVIEW_EDITORIAL_MODEL and "
              "LLM_REVIEW_ADVERSARIAL_MODEL (or LLM_MODEL), or pass --model.", file=sys.stderr)
        sys.exit(1)

    print(f"Reviewing: {file_path.name}")
    print(f"Mode: {mode} | Model: {model}")
    print()
    result = llm_call.call_model(model, content, system=load_prompt(mode), max_tokens=args.max_tokens)
    if "error" in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
    print(result["content"])


if __name__ == "__main__":
    main()
