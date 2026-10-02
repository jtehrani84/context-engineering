#!/usr/bin/env python3
"""
Offline test for scripts/llm-call.py and scripts/llm-review.py against a local stub endpoint.

    python3 scripts/test-llm-scripts.py

A throwaway HTTP server on 127.0.0.1 plays both API styles (OpenAI-compatible /chat/completions and
Anthropic-style /v1/messages), so this proves the request shape, auth header, response parsing,
empty-answer handling and error exit codes without a key or the network.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CALL = ROOT / "scripts" / "llm-call.py"
REVIEW = ROOT / "scripts" / "llm-review.py"
SEEN = []


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        SEEN.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        model = body.get("model", "")
        if model == "missing-model":
            self.send_response(404); self.end_headers(); self.wfile.write(b'{"error":"no such model"}'); return
        if self.path.endswith("/chat/completions"):
            text = "" if model == "empty-model" else f"openai-style answer from {model}"
            out = {"choices": [{"message": {"content": text}, "finish_reason": "length" if not text else "stop"}],
                   "usage": {"total_tokens": 3}}
        elif self.path.endswith("/v1/messages"):
            out = {"content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": f"anthropic-style answer from {model}"}],
                   "stop_reason": "end_turn", "usage": {"output_tokens": 3}}
        else:
            self.send_response(404); self.end_headers(); return
        data = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)


def main():
    srv = HTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    passed = failed = 0

    def check(name, cond, detail=""):
        nonlocal passed, failed
        if cond:
            passed += 1; print(f"  ok    {name}")
        else:
            failed += 1; print(f"  FAIL  {name}  {detail}")

    def run(script, *args, **env):
        e = {k: v for k, v in os.environ.items() if not k.startswith("LLM_")}
        e.update(env)
        return subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, env=e, timeout=30)

    r = run(CALL, "--prompt", "hi", "--model", "m1", "--plain", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k1")
    check("openai style: answer printed, exit 0", r.returncode == 0 and r.stdout.strip() == "openai-style answer from m1", r.stdout + r.stderr)
    check("openai style: POST {base}/chat/completions with a bearer token",
          SEEN[-1]["path"] == "/v1/chat/completions" and SEEN[-1]["auth"] == "Bearer k1")
    r = run(CALL, "--prompt", "hi", "--plain", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k1", LLM_MODEL="default-m")
    check("LLM_MODEL is the default model", "default-m" in r.stdout, r.stdout + r.stderr)
    r = run(CALL, "--prompt", "hi", "--model", "second", "--plain", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k1",
            LLM_MODEL_ALIASES='{"second": "real-model-id"}')
    check("aliases resolve from LLM_MODEL_ALIASES", "real-model-id" in r.stdout and SEEN[-1]["body"]["model"] == "real-model-id")
    r = run(CALL, "--prompt", "hi", "--model", "a1", "--plain", LLM_BASE_URL=base, LLM_API_KEY="k2", LLM_API_STYLE="anthropic")
    check("anthropic style: POST {base}/v1/messages, text block joined past a thinking block",
          r.returncode == 0 and r.stdout.strip() == "anthropic-style answer from a1" and SEEN[-1]["path"] == "/v1/messages", r.stdout + r.stderr)
    r = run(CALL, "--prompt", "hi", "--model", "empty-model", "--plain", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k1")
    check("empty answer is an error (exit 1, stderr), never printed as an answer",
          r.returncode == 1 and r.stdout.strip() == "" and "empty answer" in r.stderr, r.stdout + r.stderr)
    r = run(CALL, "--prompt", "hi", "--model", "missing-model", "--plain", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k1")
    check("HTTP error is an error (exit 1)", r.returncode == 1 and "HTTP 404" in r.stderr, r.stderr)
    r = run(CALL, "--prompt", "hi", "--model", "m", "--plain")
    check("no endpoint configured -> clear error, exit 1", r.returncode == 1 and "LLM_BASE_URL" in r.stderr, r.stderr)
    r = run(CALL, "--list-models")
    check("--list-models works with nothing configured", r.returncode == 0 and "NOT SET" in r.stdout)

    doc = ROOT / "README.md"
    r = run(REVIEW, str(doc), "--mode", "editorial", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k3",
            LLM_REVIEW_EDITORIAL_MODEL="editor-m")
    check("llm-review: editorial reviewer from LLM_REVIEW_EDITORIAL_MODEL", r.returncode == 0 and "editor-m" in r.stdout, r.stdout + r.stderr)
    check("llm-review: the review prompt is sent as the system message",
          SEEN[-1]["body"]["messages"][0]["role"] == "system" and len(SEEN[-1]["body"]["messages"][0]["content"]) > 50)
    r = run(REVIEW, str(doc), "--mode", "adversarial", LLM_BASE_URL=base + "/v1", LLM_API_KEY="k3")
    check("llm-review: no reviewer configured -> clear error, exit 1", r.returncode == 1 and "No reviewer model" in r.stderr, r.stderr)
    srv.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
