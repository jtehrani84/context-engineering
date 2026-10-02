#!/usr/bin/env python3
"""
Output Quality Gate — PostToolUse hook on Write operations.

After any file is written (.md or .html, >200 words), scans for AI-slop
words and phrases. Reports violations with line numbers so Claude can
immediately rewrite the offending sections.

This is the hard enforcement layer. Rules are soft (can be forgotten in
long conversations). This hook catches what slips through.

Fires on: Write (PostToolUse)
Reads: tool_name and tool_input from stdin (JSON)
Outputs: nothing when the write is clean; otherwise hookSpecificOutput.additionalContext with the
violations. Never blocks.
"""

import json
import re
import sys


# Banned words — single terms that scream "AI wrote this"
BANNED_WORDS = [
    "delve", "leverage", "ecosystem", "unlock", "empower",
    "streamline", "harness", "holistic", "robust", "seamless",
    "cutting-edge", "utilize", "facilitate", "solutioning",
    "ideation", "learnings", "synergy", "paradigm", "transformative",
    "pivotal", "groundbreaking", "spearhead", "foster", "bolster",
    "fortify", "underpin", "cornerstone", "linchpin", "bedrock",
    "tapestry", "multifaceted", "nuanced", "comprehensive",
    "innovative", "disruptive", "game-changing", "best-in-class",
    "world-class", "state-of-the-art", "next-generation",
    "mission-critical", "end-to-end", "full-stack",
    "deep-dive", "double-click", "unpack",
]

# Banned phrases — multi-word patterns that are dead giveaways
BANNED_PHRASES = [
    "in today's rapidly evolving",
    "it's worth noting",
    "well-positioned to",
    "uniquely positioned",
    "ushering in a new era",
    "actionable insights",
    "in an era of",
    "at the forefront",
    "paradigm shift",
    "game changer",
    "move the needle",
    "low-hanging fruit",
    "table stakes",
    "north star",
    "circle back",
    "touch base",
    "as we navigate",
    "in today's landscape",
    "the power of",
    "it is important to note",
]

# File extensions to check
CONTENT_EXTENSIONS = (".md", ".html", ".txt", ".htm")

# Minimum word count to trigger scanning (skip short files)
MIN_WORD_COUNT = 200


def count_words(text):
    """Rough word count."""
    return len(text.split())


def scan_for_violations(text):
    """Find all banned words and phrases with line numbers."""
    violations = []

    lines = text.splitlines()
    for line_num, line in enumerate(lines, 1):
        line_lower = line.lower()

        # Check single words
        for word in BANNED_WORDS:
            # Word boundary check to avoid false positives
            # e.g., "comprehensive" shouldn't match in "comprehensively"
            # but we want both, so just use 'in'
            if word in line_lower:
                # Verify it's a real word occurrence (not inside another word
                # for very short terms)
                pattern = r'\b' + re.escape(word) + r'\b'
                if re.search(pattern, line_lower):
                    violations.append({
                        "type": "word",
                        "match": word,
                        "line": line_num,
                    })

        # Check phrases
        for phrase in BANNED_PHRASES:
            if phrase in line_lower:
                violations.append({
                    "type": "phrase",
                    "match": phrase,
                    "line": line_num,
                })

    return violations


def format_warning(violations, file_path):
    """Format violations into a readable warning."""
    unique_matches = list(set(v["match"] for v in violations))
    total = len(violations)

    # Show up to 5 specific locations
    locations = []
    seen = set()
    for v in violations:
        key = f"{v['match']}:{v['line']}"
        if key not in seen and len(locations) < 5:
            locations.append(f"'{v['match']}' (line {v['line']})")
            seen.add(key)

    warning = (
        f"OUTPUT QUALITY: {total} AI-slop violation(s) in {file_path}. "
        f"Found: {', '.join(unique_matches[:8])}. "
        f"Locations: {'; '.join(locations)}. "
        f"Rewrite these using plain human language. "
        f"Test: would a real person say this in conversation?"
    )
    return warning


def main():
    try:
        hook_input = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)  # unreadable payload: stay quiet rather than break the session
    if not isinstance(hook_input, dict) or not isinstance(hook_input.get("tool_input", {}), dict):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only process Write operations
    if tool_name != "Write":
        sys.exit(0)

    file_path = tool_input.get("file_path", "")

    # Only check content files
    if not file_path.endswith(CONTENT_EXTENSIONS):
        sys.exit(0)

    content = tool_input.get("content", "")

    # Skip short files (config, templates, etc.)
    if count_words(content) < MIN_WORD_COUNT:
        sys.exit(0)

    violations = scan_for_violations(content)

    if violations:
        warning = format_warning(violations, file_path)
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": warning,
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
