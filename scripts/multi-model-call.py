#!/usr/bin/env python3
"""
Multi-Model API Caller — Routes prompts to any model via API.

Usage:
  python3 multi-model-call.py --model haiku --prompt "Check this for errors"
  python3 multi-model-call.py --model sonnet --prompt "Validate" --file output.md
  python3 multi-model-call.py --model gpt-4o --prompt "Alternative framing" --file draft.md
  python3 multi-model-call.py --list-models

Supports:
  - Anthropic API (Claude models) — default
  - Any OpenAI-compatible endpoint (GPT, Gemini via proxy, etc.)

Set your API key:
  export ANTHROPIC_API_KEY="sk-ant-..."
  export OPENAI_API_KEY="sk-..."  (for OpenAI-compatible models)

Output: JSON with {model, content, usage} or plain text with --plain flag.
"""

import argparse
import json
import os
import sys
import urllib.request

# === API Configuration ===
# Default: Anthropic Messages API
ANTHROPIC_BASE = "https://api.anthropic.com"
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Optional: OpenAI-compatible endpoint (for GPT, local models, etc.)
OPENAI_BASE = os.environ.get("OPENAI_API_BASE", "https://api.openai.com")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")

# Model catalog
ANTHROPIC_MODELS = {
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
}

OPENAI_MODELS = {
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo",
}

ALL_MODELS = ANTHROPIC_MODELS | OPENAI_MODELS

# Aliases for convenience
ALIASES = {
    "haiku": "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-20250514",
    "opus": "claude-opus-4-20250514",
    "gpt4o": "gpt-4o",
    "gpt4": "gpt-4-turbo",
}


def call_anthropic(model: str, prompt: str, system: str = "", max_tokens: int = 4096) -> dict:
    """Call Anthropic Messages API."""
    if not ANTHROPIC_KEY:
        return {"error": "ANTHROPIC_API_KEY not set. Get one at console.anthropic.com"}

    messages = [{"role": "user", "content": prompt}]
    body = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system:
        body["system"] = system

    headers = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
    }

    req = urllib.request.Request(
        f"{ANTHROPIC_BASE}/v1/messages",
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else str(e)
        return {"error": f"HTTP {e.code}: {error_body}", "model": model}
    except Exception as e:
        return {"error": str(e), "model": model}

    text = data["content"][0]["text"] if data.get("content") else ""
    usage = data.get("usage", {})
    return {"model": model, "content": text, "usage": usage}


def call_openai(model: str, prompt: str, system: str = "", max_tokens: int = 4096) -> dict:
    """Call OpenAI-compatible API."""
    if not OPENAI_KEY:
        return {"error": "OPENAI_API_KEY not set"}

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = {"model": model, "max_tokens": max_tokens, "messages": messages}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_KEY}",
    }

    req = urllib.request.Request(
        f"{OPENAI_BASE}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else str(e)
        return {"error": f"HTTP {e.code}: {error_body}", "model": model}
    except Exception as e:
        return {"error": str(e), "model": model}

    text = data["choices"][0]["message"]["content"] if data.get("choices") else ""
    usage = data.get("usage", {})
    return {"model": model, "content": text, "usage": usage}


def call_model(model: str, prompt: str, system: str = "", max_tokens: int = 4096) -> dict:
    """Route to the appropriate API based on model name."""
    resolved = ALIASES.get(model, model)

    if resolved in ANTHROPIC_MODELS:
        return call_anthropic(resolved, prompt, system, max_tokens)
    elif resolved in OPENAI_MODELS:
        return call_openai(resolved, prompt, system, max_tokens)
    else:
        return {"error": f"Unknown model: {resolved}. Use --list-models to see available."}


def main():
    parser = argparse.ArgumentParser(description="Call any model via API")
    parser.add_argument("--model", "-m", default="haiku", help="Model name or alias")
    parser.add_argument("--prompt", "-p", required=False, help="User prompt")
    parser.add_argument("--system", "-s", default="", help="System prompt")
    parser.add_argument("--file", "-f", help="File to include in prompt context")
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--plain", action="store_true", help="Output text only, no JSON wrapper")
    parser.add_argument("--list-models", action="store_true", help="List available models")
    args = parser.parse_args()

    if args.list_models:
        print("Available models (aliases in parens):")
        print("\nClaude (Anthropic API):")
        for m in sorted(ANTHROPIC_MODELS):
            alias = next((k for k, v in ALIASES.items() if v == m), "")
            print(f"  {m}" + (f" ({alias})" if alias else ""))
        print("\nGPT (OpenAI-compatible API):")
        for m in sorted(OPENAI_MODELS):
            alias = next((k for k, v in ALIASES.items() if v == m), "")
            print(f"  {m}" + (f" ({alias})" if alias else ""))
        print("\nConfiguration:")
        print(f"  ANTHROPIC_API_KEY: {'set' if ANTHROPIC_KEY else 'NOT SET'}")
        print(f"  OPENAI_API_KEY: {'set' if OPENAI_KEY else 'NOT SET'}")
        print(f"  OPENAI_API_BASE: {OPENAI_BASE}")
        return

    if not args.prompt:
        parser.error("--prompt is required (or use --list-models)")

    prompt = args.prompt
    if args.file:
        try:
            with open(os.path.expanduser(args.file)) as f:
                file_content = f.read()
            prompt = f"{prompt}\n\n---\nFile content ({args.file}):\n{file_content}"
        except FileNotFoundError:
            print(json.dumps({"error": f"File not found: {args.file}"}))
            sys.exit(1)

    result = call_model(args.model, prompt, args.system, args.max_tokens)

    if args.plain:
        print(result.get("content", result.get("error", "")))
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
