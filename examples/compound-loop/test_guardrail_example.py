#!/usr/bin/env python3
"""Offline test for guardrail-example.py: it speaks on slop in a written .md, and stays silent otherwise.

    python3 examples/compound-loop/test_guardrail_example.py
"""
import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).with_name("guardrail-example.py")
results = []


def run(payload):
    p = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload), capture_output=True, text=True, timeout=10)
    return p.returncode, p.stdout.strip()


def check(name, cond):
    results.append(cond)
    print(("  ok    " if cond else "  FAIL  ") + name)


rc, out = run({"tool_name": "Write", "tool_input": {"file_path": "/tmp/x/email.md",
               "content": "Hi Sarah,\nWe can leverage our seamless platform.\n"}})
check("slop in a .md write exits 0", rc == 0)
try:
    ctx = json.loads(out)["hookSpecificOutput"]
    check("emits PostToolUse additionalContext", ctx.get("hookEventName") == "PostToolUse" and "AI SLOP DETECTED" in ctx.get("additionalContext", ""))
    check("names the word and its line", "'leverage' on line 2" in ctx["additionalContext"])
except (ValueError, KeyError, TypeError):
    check("emits valid hookSpecificOutput JSON", False)

rc, out = run({"tool_name": "Write", "tool_input": {"file_path": "/tmp/x/email.md", "content": "Hi Sarah,\nThe report is attached.\n"}})
check("clean text: exit 0, no output", rc == 0 and out == "")

rc, out = run({"tool_name": "Write", "tool_input": {"file_path": "/tmp/x/app.py", "content": "x = 'leverage'\n"}})
check("non-content file: silent", rc == 0 and out == "")

rc, out = run({"tool_name": "Edit", "tool_input": {"file_path": "/tmp/x/email.md", "new_string": "leverage"}})
check("other tools: silent", rc == 0 and out == "")

print(f"{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
