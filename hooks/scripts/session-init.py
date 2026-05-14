#!/usr/bin/env python3
"""
Session Init Hook — Routes context based on working directory and git state.

This hook fires on SessionStart and suggests relevant wiki pages and
memory files based on what you're working on.

Customize the ROUTING_TABLE below for your projects.
"""

import json
import os
import subprocess
import sys


# === CUSTOMIZE THIS ===
# Map directory patterns and branch keywords to wiki pages
ROUTING_TABLE = {
    # If working directory contains these patterns, suggest these pages
    "directories": {
        "frontend": ["wiki/concepts/frontend-patterns.md"],
        "backend": ["wiki/concepts/backend-patterns.md"],
        "api": ["wiki/concepts/api-design.md"],
        "infra": ["wiki/concepts/infrastructure.md"],
        "docs": ["wiki/concepts/documentation-standards.md"],
    },
    # If git branch name contains these keywords, suggest these pages
    "branches": {
        "feature": [],
        "fix": ["wiki/concepts/debugging-patterns.md"],
        "release": ["wiki/concepts/release-process.md"],
    },
}

# Memory directory (auto-detected from project settings)
MEMORY_DIR = None


def get_git_info():
    """Get current branch and recent changes."""
    info = {}
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        info["branch"] = branch
    except Exception:
        info["branch"] = None

    try:
        status = subprocess.check_output(
            ["git", "status", "--short"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        info["changed_files"] = len(status.splitlines()) if status else 0
    except Exception:
        info["changed_files"] = 0

    return info


def suggest_context(cwd, git_info):
    """Determine which wiki pages to suggest loading."""
    suggestions = []

    # Check directory patterns
    cwd_lower = cwd.lower()
    for pattern, pages in ROUTING_TABLE["directories"].items():
        if pattern in cwd_lower:
            suggestions.extend(pages)

    # Check branch keywords
    branch = git_info.get("branch", "") or ""
    for keyword, pages in ROUTING_TABLE["branches"].items():
        if keyword in branch.lower():
            suggestions.extend(pages)

    return list(set(suggestions))  # deduplicate


def main():
    """Hook entry point."""
    # Read hook input from stdin
    hook_input = json.loads(sys.stdin.read())

    cwd = hook_input.get("cwd", os.getcwd())
    git_info = get_git_info()

    suggestions = suggest_context(cwd, git_info)

    # Build the context hint
    hints = []

    if git_info.get("branch"):
        hints.append(f"Branch: {git_info['branch']}")

    if git_info.get("changed_files", 0) > 0:
        hints.append(f"{git_info['changed_files']} uncommitted changes")

    if suggestions:
        hints.append(f"Suggested context: {', '.join(suggestions)}")

    if hints:
        output = {
            "result": "continue",
            "metadata": {
                "title": "Session Context",
                "body": " | ".join(hints),
            },
        }
    else:
        output = {"result": "continue"}

    print(json.dumps(output))


if __name__ == "__main__":
    main()
