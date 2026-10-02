#!/usr/bin/env python3
"""
Voice-Tell Gate — PostToolUse hook on Write.

Runs the voice engine (tools/aiscore.mjs: vendored MIT detector + your overlay) on written
.md/.html and nudges with the 0-100 AI score, overlay hard-bans, cadence flags, and — until you've
calibrated your overlay — the GENERIC-ONLY fuse warning (a clean score does NOT mean it sounds like you).

Supersedes output-quality-gate.py, which stays as the lightweight, node-free fallback (banned words
only). Nudge only — never blocks. If node or the engine isn't available, it stays silent rather than
break the session.

Fires on: Write (PostToolUse). Reads tool_input from stdin (JSON). Outputs hookSpecificOutput.additionalContext when there is a signal; silent otherwise.
"""
import json
import os
import subprocess
import sys

CONTENT_EXT = (".md", ".html", ".htm", ".txt")
MIN_WORDS = 100
HERE = os.path.dirname(os.path.abspath(__file__))
AISCORE = os.path.join(HERE, "..", "..", "tools", "aiscore.mjs")


def cont(warning=None):
    if warning:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": warning,
            }
        }))
    sys.exit(0)


def main():
    try:
        hook = json.loads(sys.stdin.read())
    except Exception:
        cont()
    if not isinstance(hook, dict) or hook.get("tool_name") != "Write":
        cont()
    ti = hook.get("tool_input", {})
    if not isinstance(ti, dict):
        cont()
    fp = ti.get("file_path", "")
    if not fp.endswith(CONTENT_EXT):
        cont()
    content = ti.get("content", "")
    if len(content.split()) < MIN_WORDS:
        cont()
    if not os.path.exists(AISCORE):
        cont()  # engine not present — stay quiet

    try:
        p = subprocess.run(["node", AISCORE, "-", "--json"], input=content,
                           capture_output=True, text=True, timeout=30)
        r = json.loads(p.stdout)
    except Exception:
        cont()  # never break the session on a scorer hiccup

    score = r.get("score", 0) or 0
    voice = r.get("voice", {}) or {}
    hard = voice.get("hardBans", 0) or 0
    cad = voice.get("cadenceFlags", 0) or 0
    note = r.get("calibrationNote")
    issue_types = ", ".join(list((r.get("issueTypes") or {}).keys())[:6])

    # only speak when there's a signal — no spam on clean writes
    if score >= 30 or hard or cad:
        w = f"VOICE: aiscore {score}/100"
        if hard:
            w += f", {hard} hard-ban{'s' if hard > 1 else ''}"
        if cad:
            w += f", {cad} cadence flag{'s' if cad > 1 else ''}"
        if issue_types:
            w += f" [{issue_types}]"
        w += (f" in {os.path.basename(fp)}. Read it aloud — would a person write this? "
              "Fix the tells, then re-check with tools/aiscore.mjs and /voice-judge before shipping.")
        if note:
            w += f"  ({note})"
        cont(w)
    cont()


if __name__ == "__main__":
    main()
