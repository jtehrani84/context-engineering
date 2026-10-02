#!/usr/bin/env python3
"""
Output Quality Gate — PostToolUse hook example.

Fires after Write operations on .md or .html files.
Scans content for banned AI-slop words and warns Claude to rewrite.

This is a simplified example. See hooks/scripts/output-quality-gate.py
for the production version.
"""

import json
import sys

# Banned words — add your own as you discover them
BANNED_WORDS = [
    "delve", "leverage", "ecosystem", "unlock", "empower",
    "streamline", "harness", "holistic", "robust", "seamless",
    "cutting-edge", "utilize", "facilitate", "solutioning",
    "ideation", "learnings", "synergy", "paradigm", "transformative",
    "pivotal", "groundbreaking", "spearhead", "foster", "bolster",
    "fortify", "underpin", "cornerstone", "linchpin", "bedrock",
    "tapestry", "multifaceted", "nuanced", "comprehensive",
    "innovative", "disruptive", "game-changing",
]


def scan_content(text):
    """Find banned words and their line numbers."""
    violations = []
    for line_num, line in enumerate(text.splitlines(), 1):
        line_lower = line.lower()
        for word in BANNED_WORDS:
            if word in line_lower:
                violations.append({"word": word, "line": line_num})
    return violations


def main():
    hook_input = json.loads(sys.stdin.read())

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only check Write operations on content files
    if tool_name != "Write":
        sys.exit(0)  # nothing to say: exit 0, no output

    file_path = tool_input.get("file_path", "")
    if not file_path.endswith((".md", ".html", ".txt")):
        sys.exit(0)  # nothing to say: exit 0, no output

    content = tool_input.get("content", "")
    violations = scan_content(content)

    if violations:
        word_list = ", ".join(set(v["word"] for v in violations))
        locations = "; ".join(
            f"'{v['word']}' on line {v['line']}" for v in violations[:5]
        )
        warning = (
            f"AI SLOP DETECTED: Found {len(violations)} banned word(s): {word_list}. "
            f"Locations: {locations}. "
            f"Rewrite these sections using plain, human language."
        )
        # PostToolUse: additionalContext lands next to the tool result, where Claude reads it.
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": warning,
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
