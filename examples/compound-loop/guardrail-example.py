#!/usr/bin/env python3
"""
Simplified Guardrail Example — Shows how hooks work in practice.

This is a stripped-down version of output-quality-gate.py to illustrate
the concept. The real version handles more edge cases.

How it works:
1. Claude Code calls this script AFTER writing a file
2. The script reads what was written (via stdin JSON)
3. It scans for banned patterns
4. If found: returns a warning (Claude will rewrite)
5. If clean: returns continue (no action needed)
"""

import json
import re
import sys


# The patterns you want to catch
BANNED_WORDS = [
    "leverage",
    "synergy",
    "ecosystem",
    "holistic",
    "robust",
]


def scan_content(text):
    """Check text for banned words. Returns list of matches."""
    found = []
    for word in BANNED_WORDS:
        pattern = r'\b' + re.escape(word) + r'\b'
        if re.search(pattern, text, re.IGNORECASE):
            found.append(word)
    return found


def main():
    # Read the hook input (what Claude just did)
    hook_input = json.loads(sys.stdin.read())

    # Get the content that was written
    tool_input = hook_input.get("tool_input", {})
    content = tool_input.get("content", "")
    file_path = tool_input.get("file_path", "")

    # Only check content files
    if not file_path.endswith((".md", ".html", ".txt")):
        print(json.dumps({"result": "continue"}))
        return

    # Scan for violations
    violations = scan_content(content)

    if violations:
        # Report the issue — Claude will fix it
        warning = (
            f"Voice violation in {file_path}: "
            f"found {', '.join(violations)}. "
            f"Rewrite using plain language."
        )
        print(json.dumps({"result": "continue", "warning": warning}))
    else:
        # All clean
        print(json.dumps({"result": "continue"}))


if __name__ == "__main__":
    main()
