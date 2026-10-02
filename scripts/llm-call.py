#!/usr/bin/env python3
"""
llm-call.py: send one prompt to any model behind an OpenAI-compatible or Anthropic-style endpoint.

    python3 llm-call.py --model <model-id> --prompt "Check this for errors"
    python3 llm-call.py --model <model-id> --prompt "Validate" --file output.md --plain
    python3 llm-call.py --list-models          # what this script is configured to call, and how

Configure it once with environment variables (put them in ~/.claude/settings.json "env" or your shell):
    LLM_BASE_URL     base URL of your endpoint, e.g. https://api.openai.com/v1, a model proxy you run,
                     or https://api.anthropic.com
    LLM_API_KEY      the key or bearer token for that endpoint
    LLM_API_STYLE    "openai" (POST {base}/chat/completions, the default) or "anthropic"
                     (POST {base}/v1/messages). Picked automatically for api.anthropic.com.
    LLM_MODEL        default model id when --model is not given
    LLM_MODEL_ALIASES  optional JSON map of short names to model ids, e.g. '{"second-lab": "<model-id>"}'

No model ids are hard-coded: what your endpoint serves is the only catalog that matters. If a call
fails with a 400 or 404, check the id against your provider's model list.

Output: JSON {model, content, usage}, or plain text with --plain. An error never looks like an answer:
it goes to stderr with a nonzero exit.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse


def config():
    base = os.environ.get("LLM_BASE_URL", "").rstrip("/")
    style = os.environ.get("LLM_API_STYLE", "").strip().lower()
    if not style:
        style = "anthropic" if urlparse(base).hostname == "api.anthropic.com" else "openai"
    try:
        aliases = json.loads(os.environ.get("LLM_MODEL_ALIASES", "") or "{}")
        if not isinstance(aliases, dict):
            aliases = {}
    except ValueError:
        aliases = {}
    return {
        "base": base,
        "key": os.environ.get("LLM_API_KEY", ""),
        "style": style,
        "default_model": os.environ.get("LLM_MODEL", ""),
        "aliases": {str(k): str(v) for k, v in aliases.items()},
    }


def _request(url, body, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def call_model(model, prompt, system="", max_tokens=4096, timeout=600, cfg=None):
    """Return {model, content, usage} or {error, model}."""
    cfg = cfg or config()
    resolved = cfg["aliases"].get(model, model) or cfg["default_model"]
    if not cfg["base"] or not cfg["key"]:
        return {"error": "LLM_BASE_URL and LLM_API_KEY must be set (see the header of llm-call.py).", "model": resolved}
    if not resolved:
        return {"error": "No model given. Pass --model or set LLM_MODEL.", "model": ""}

    if cfg["style"] == "anthropic":
        url = cfg["base"] + ("/messages" if cfg["base"].endswith("/v1") else "/v1/messages")
        body = {"model": resolved, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
        if system:
            body["system"] = system
        headers = {"Content-Type": "application/json", "anthropic-version": "2023-06-01"}
        if urlparse(cfg["base"]).hostname == "api.anthropic.com":
            headers["x-api-key"] = cfg["key"]
        else:
            headers["Authorization"] = f"Bearer {cfg['key']}"
    else:
        url = cfg["base"] + "/chat/completions"
        messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        body = {"model": resolved, "max_tokens": max_tokens, "messages": messages}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cfg['key']}"}

    try:
        data = _request(url, body, headers, timeout)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode(errors="replace") if e.fp else str(e)
        return {"error": f"HTTP {e.code}: {error_body[:500]}", "model": resolved}
    except Exception as e:
        msg = str(e)
        if "timed out" in msg:
            msg += f" (no reply within {timeout}s; reasoning models can take minutes on long input, raise --timeout)"
        return {"error": msg, "model": resolved}

    # Normalize across the two formats. A reasoning model may put a thinking block first, so join every
    # text block rather than reading the first one.
    if isinstance(data.get("content"), list):
        text = "".join(b.get("text", "") for b in data["content"] if isinstance(b, dict) and b.get("type") == "text")
        stop = data.get("stop_reason")
    elif data.get("choices"):
        choice = data["choices"][0]
        text = (choice.get("message") or {}).get("content") or ""
        stop = choice.get("finish_reason")
    else:
        return {"error": f"unrecognized response shape: {json.dumps(data)[:300]}", "model": resolved}
    usage = data.get("usage", {})
    if not text.strip():
        why = (f"it hit max_tokens={max_tokens} while thinking; raise --max-tokens" if stop in ("max_tokens", "length")
               else f"stop reason: {stop}")
        return {"error": f"{resolved} returned an empty answer ({why})", "model": resolved, "usage": usage}
    return {"model": resolved, "content": text, "usage": usage}


def main():
    parser = argparse.ArgumentParser(description="Send one prompt to a model behind LLM_BASE_URL")
    parser.add_argument("--model", "-m", default="", help="Model id or an alias from LLM_MODEL_ALIASES (default: LLM_MODEL)")
    parser.add_argument("--prompt", "-p", required=False, help="User prompt")
    parser.add_argument("--system", "-s", default="", help="System prompt")
    parser.add_argument("--file", "-f", help="File to include in prompt context")
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--timeout", type=int, default=600, help="Seconds to wait for a reply (default 600)")
    parser.add_argument("--plain", action="store_true", help="Output text only, no JSON wrapper")
    parser.add_argument("--list-models", action="store_true", help="Show the configuration and aliases")
    args = parser.parse_args()
    cfg = config()

    if args.list_models:
        print(f"LLM_BASE_URL:  {cfg['base'] or 'NOT SET'}")
        print(f"LLM_API_KEY:   {'set' if cfg['key'] else 'NOT SET'}")
        print(f"LLM_API_STYLE: {cfg['style']}")
        print(f"LLM_MODEL:     {cfg['default_model'] or 'NOT SET'}")
        print("Aliases (LLM_MODEL_ALIASES):" + ("" if cfg["aliases"] else " none"))
        for k, v in sorted(cfg["aliases"].items()):
            print(f"  {k} -> {v}")
        print("\nThis script has no built-in catalog. Ask your provider which model ids it serves.")
        return

    if not args.prompt:
        parser.error("--prompt is required (or use --list-models)")

    prompt = args.prompt
    if args.file:
        try:
            with open(os.path.expanduser(args.file)) as f:
                prompt = f"{prompt}\n\n---\nFile content ({args.file}):\n{f.read()}"
        except FileNotFoundError:
            print(f"ERROR: File not found: {args.file}", file=sys.stderr)
            sys.exit(1)

    result = call_model(args.model, prompt, args.system, args.max_tokens, args.timeout, cfg)
    if "error" in result:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        if not args.plain:
            print(json.dumps(result, indent=2))
        sys.exit(1)
    print(result["content"] if args.plain else json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
