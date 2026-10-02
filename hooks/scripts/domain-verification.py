#!/usr/bin/env python3
"""
Domain Verification Hook — PreToolUse on Edit/Write operations.

Catches hallucinated or incorrect domain-specific terms before they reach
output. LLMs frequently invent plausible-sounding names that don't exist
or use deprecated/incorrect terminology.

This hook is CONFIGURABLE. Add your field's common hallucinations to the
DOMAIN_TERMS dict below, or load from a JSON file.

Fires on: Edit, Write
Reads: tool_name and tool_input from stdin (JSON)
Outputs: nothing when the content is clean or no terms are configured; otherwise
hookSpecificOutput.additionalContext naming the suspect term. Advisory only: it never blocks,
because a term can appear in quoted history or a comparison.

Example: A React developer might add:
  "React Server-Side Components": "The correct term is 'React Server Components' (no 'Side')"
  "React Hooks API": "It's just 'React Hooks' — not 'React Hooks API'"

Example: A Kubernetes engineer might add:
  "kubectl apply -d": "The flag is -f (file), not -d"
  "Kubernetes Pod Controller": "The correct term is 'ReplicaSet' or 'Deployment'"
"""

import json
import os
import re
import sys
from pathlib import Path


# === CUSTOMIZE THIS ===
# wrong_term (lowercase) -> correction guidance
# Add terms from your domain that LLMs commonly hallucinate
DOMAIN_TERMS = {
    # === Examples (remove/replace with your domain) ===
    #
    # "react server-side components": (
    #     "The correct term is 'React Server Components' (RSC). "
    #     "There is no 'Server-Side' variant."
    # ),
    # "kubernetes pod controller": (
    #     "No such thing as a 'Pod Controller'. You probably mean "
    #     "'ReplicaSet', 'Deployment', or 'StatefulSet'."
    # ),
    # "graphql mutations api": (
    #     "It's just 'GraphQL Mutations' — not a separate API."
    # ),
}

# Optional: Load additional terms from a JSON config file
# Create ~/.claude/domain-terms.json with {"wrong term": "correction"} entries
EXTERNAL_CONFIG = Path.home() / ".claude" / "domain-terms.json"

if EXTERNAL_CONFIG.exists():
    try:
        with open(EXTERNAL_CONFIG) as f:
            external_terms = json.load(f)
        if isinstance(external_terms, dict):
            DOMAIN_TERMS.update({str(k).lower(): str(v) for k, v in external_terms.items()})
    except (ValueError, IOError):
        pass


# Patterns that might indicate hallucinated terminology (generic)
SUSPICIOUS_PATTERNS = [
    # Compound product names that don't exist
    # Customize these regex patterns for your domain
    # r"[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:API|SDK|Cloud|Platform|Engine|Hub)",
]


def check_content(text):
    """Check text for known domain term errors."""
    warnings = []
    text_lower = text.lower()

    for wrong_term, guidance in DOMAIN_TERMS.items():
        if wrong_term in text_lower:
            warnings.append(f"TERM: '{wrong_term}' found. {guidance}")

    # Check suspicious patterns (informational only)
    for pattern in SUSPICIOUS_PATTERNS:
        matches = re.findall(pattern, text)
        for match in matches:
            warnings.append(
                f"VERIFY: '{match}' — confirm this is correct "
                f"terminology in your domain before using."
            )

    return warnings


def main():
    try:
        hook_input = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)  # unreadable payload: stay quiet rather than break the session
    if not isinstance(hook_input, dict) or not isinstance(hook_input.get("tool_input", {}), dict):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only check Edit and Write operations
    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    # Get the content being written
    content = ""
    if tool_name == "Write":
        content = tool_input.get("content", "")
    elif tool_name == "Edit":
        content = tool_input.get("new_string", "")

    # Skip if there is nothing to check, or no domain terms are configured yet
    if not content or not isinstance(content, str) or not (DOMAIN_TERMS or SUSPICIOUS_PATTERNS):
        sys.exit(0)

    warnings = check_content(content)

    if warnings:
        # Don't block, just warn. Terms might be in quoted context.
        combined = " | ".join(warnings[:3])  # Cap at 3 warnings
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": f"Domain Verification: {combined}",
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
