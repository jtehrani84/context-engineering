#!/usr/bin/env python3
"""
PreToolUse Guardrail Hook — Blocks dangerous operations before they execute.

This hook intercepts tool calls and checks them against your constraint list.
Customize BLOCKED_PATTERNS below with YOUR most expensive mistakes.

Examples included:
- Force-pushing to main
- Running destructive commands without confirmation
- Committing secrets
- Overwriting environment variables
"""

import json
import re
import sys


# === CUSTOMIZE THIS ===
# Add patterns for commands that have burned you before
BLOCKED_PATTERNS = [
    {
        "pattern": r"git push.*--force.*main|git push.*-f.*main",
        "message": "BLOCKED: Force-pushing to main is destructive. Use a feature branch or --force-with-lease.",
        "tool": "Bash",
    },
    {
        "pattern": r"git reset --hard",
        "message": "WARNING: git reset --hard discards uncommitted work permanently. Consider git stash instead.",
        "tool": "Bash",
    },
    {
        "pattern": r"rm -rf /|rm -rf ~|rm -rf \.",
        "message": "BLOCKED: Recursive delete on root/home/project directory. Too dangerous.",
        "tool": "Bash",
    },
    {
        "pattern": r"--set-env-vars",
        "message": "BLOCKED: --set-env-vars REPLACES all environment variables. Use --update-env-vars to add/update without wiping existing vars.",
        "tool": "Bash",
    },
    {
        "pattern": r"\.(env|pem|key|cert|secret)",
        "message": "WARNING: This may involve a sensitive file. Ensure you're not committing secrets.",
        "tool": "Write",
    },
    {
        "pattern": r"DROP\s+(TABLE|DATABASE|INDEX)",
        "message": "BLOCKED: Destructive DDL operation. Verify you intend to permanently delete this.",
        "tool": "Bash",
    },
]


def check_command(tool_name, tool_input):
    """Check if the tool call matches any blocked patterns."""
    # Get the content to check based on tool type
    content = ""
    if tool_name == "Bash":
        content = tool_input.get("command", "")
    elif tool_name == "Write":
        content = tool_input.get("file_path", "")
    elif tool_name == "Edit":
        content = tool_input.get("file_path", "")

    for rule in BLOCKED_PATTERNS:
        # Only check if rule applies to this tool (or no tool specified)
        if rule.get("tool") and rule["tool"] != tool_name:
            continue

        if re.search(rule["pattern"], content, re.IGNORECASE):
            return rule["message"]

    return None


def main():
    """Hook entry point."""
    hook_input = json.loads(sys.stdin.read())

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    violation = check_command(tool_name, tool_input)

    if violation:
        # Block the action and show the warning
        output = {
            "result": "block",
            "reason": violation,
        }
    else:
        output = {"result": "continue"}

    print(json.dumps(output))


if __name__ == "__main__":
    main()
