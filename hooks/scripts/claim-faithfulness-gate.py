#!/usr/bin/env python3
"""
PostToolUse hook (Write / Edit / MultiEdit): claim-faithfulness gate.

Fires after a write that produces an EXTERNAL-FACING prose artifact (customer, Support, CSM,
leadership, a handoff doc) carrying the linguistic tells of an over-confident claim. Hands Claude a
reminder to re-verify the claims against their SOURCES, not against its own prose, before calling
the artifact ready to send.

WHY: when one agent researches, drafts, and finalizes, nobody crosses a claim against its source,
and fluent prose reads back as true. Two failures recur. One is a convenient-direction inversion:
a draft says "enabling X leaves Y untouched" while the retrieved release note says X can break Y.
The other is a chain labeled "each documented" whose pivot step is really an inference. An
adversarial pass catches both, but running it is discretionary. This hook makes the trigger
reliable. See rules/claims-faithful-to-source.md.

HONEST SCOPE: this hook nudges, it cannot prove. It sees the bytes just written, not the sources
behind them, so it cannot compare claim to source. The proof is the re-read, and for a
high-stakes artifact the /claim-audit skill.

Conservative by design: it fires only when BOTH (a) the artifact looks external-facing AND (b) it
carries at least one claim-risk tell. It stays quiet on code, scratch notes, and this kit's own
rule and config files.

Output (Claude Code hooks contract):
  default                    hookSpecificOutput.additionalContext
  KIT_PROOF_GATES=block   top-level {"decision": "block", "reason": ...}
"""
import json
import os
import re
import sys

# Only prose artifacts carry claims. Skip code, config, data.
PROSE_EXT = (".html", ".htm", ".md", ".txt", ".rtf")
MIN_CHARS = 400

# Paths that quote the trigger words because they DEFINE the guard, not because they make claims.
SKIP_PATH_PARTS = ("/.claude/rules/", "/.claude/commands/", "/.claude/hooks/", "/.claude/workflows/")
SKIP_BASENAMES = {"claims-faithful-to-source.md", "claim-faithfulness-gate.py", "claim-audit.md"}

# (a) The doc is meant to leave the author's hands. Word-boundary patterns, so "supports" alone
# does not count as a Support handoff.
AUDIENCE_PATTERNS = [
    r"\bsupport\s+(case|ticket|handoff|hand-off|team|engineer|request)\b",
    r"\bcase\s+(number|#|id)\b",
    r"\bcsm\b", r"\bcustomer\s+success\b", r"\bhand[\s-]?off\b",
    r"\bfor\s+the\s+(account|customer|client|exec|leadership)\b",
    r"\b(leadership|executive)\b", r"\bexternal\s+(client|customer|audience|readers?)\b",
    r"\bprepared\s+(by|for)\b", r"\bsend\s+to\b", r"\bto\s+be\s+delivered\b",
    r"\btechnical\s+(analysis|brief|review)\b", r"\bpost-?mortem\b", r"\broot\s+cause\s+analysis\b",
]

# (b) Claim-risk tells. Each is a place where faithfulness slips.
TELLS = [
    # reassuring caveats: the signature of a convenient-direction inversion
    (r"\b(leaves?|left)\s+\w+\s+(untouched|unaffected|alone)\b", "reassuring caveat ('leaves X untouched'): re-read the source, because comfort is where inversions hide"),
    (r"\b(no\s+(impact|collateral|effect|change|risk|downside)|won'?t\s+(affect|touch|break|impact)|harmless|non-issue|nothing\s+breaks)\b", "reassuring caveat ('no impact / won't break'): verify the cautionary face of the fact, not just the comforting one"),
    (r"\b(risk-free|zero\s+risk|completely\s+safe|perfectly\s+safe|safe\s+to)\b", "reassurance ('safe / zero risk'): confirm against the source, not intuition"),
    # "documented" over a chain
    (r"\b(each|all|both)\s+documented\b", "'each/all documented' over a chain: check every link individually, since some-real is not chain-documented"),
    (r"\b(the\s+docs?\s+(show|prove|confirm|say)|documented\s+(fact|behavior|chain))\b", "'the docs prove...': re-read the exact span, and check whether it states THIS claim or only the premises"),
    # unhedged absolutes in external copy
    (r"\bthe\s+(fix|cause|root\s+cause|answer|solution)\b", "absolute ('THE fix / cause'): is it confirmed or only most likely? Calibrate or cite"),
    (r"\b(guaranteed?|impossible|certainly|definitely|will\s+(fix|resolve))\b", "unhedged absolute: each needs a source span or gets softened"),
    (r"\b(never|always)\b", "'never / always': scope claim, so confirm the source bounds it that tightly"),
]

# If the doc already carries calibration language it has probably been through a faithfulness pass.
# Soften the nudge rather than nag a doc that hedges honestly.
CALIBRATION_PRESENT = [
    "hypothesis", "inferred", "inference", "best-fitting", "not a documented",
    "couldn't retrieve", "could not be retrieved", "unconfirmed", "re-verify",
    "honest limit", "treat as", "appears to", "most likely cause",
]


def written_text(tool_name, tool_input):
    """The text just written: Write content, Edit new_string, or every MultiEdit new_string."""
    if tool_name == "Write":
        return str(tool_input.get("content", ""))
    if tool_name == "Edit":
        return str(tool_input.get("new_string", ""))
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits")
        if isinstance(edits, list):
            return "\n".join(str(e.get("new_string", "")) for e in edits if isinstance(e, dict))
    return ""


def emit(message):
    if os.environ.get("KIT_PROOF_GATES", "").strip().lower() == "block":
        out = {"decision": "block", "reason": message}
    else:
        out = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": message}}
    print(json.dumps(out))


def main():
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError, ValueError):
        return
    if not isinstance(hook_input, dict):
        return
    tool_name = hook_input.get("tool_name", "")
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        return
    tool_input = hook_input.get("tool_input")
    if not isinstance(tool_input, dict):
        return

    path = str(tool_input.get("file_path", ""))
    norm = path.replace("\\", "/").lower()
    if not norm.endswith(PROSE_EXT):
        return
    if os.path.basename(norm) in SKIP_BASENAMES or any(part in norm for part in SKIP_PATH_PARTS):
        return

    text = written_text(tool_name, tool_input)
    if len(text) < MIN_CHARS:
        return
    low = text.lower()

    if not any(re.search(p, low) for p in AUDIENCE_PATTERNS):
        return

    hits = [msg for pat, msg in TELLS if re.search(pat, low)]
    if not hits:
        return

    calibrated = sum(1 for c in CALIBRATION_PRESENT if c in low) >= 3
    bullet = "\n".join(f"  - {h}" for h in hits[:4])  # cap the noise

    if calibrated:
        tone = ("This artifact already carries calibration language (hypothesis, inferred, limits), so it may "
                "have been through a faithfulness pass. Still confirm these specific tells re-read true against source:")
    else:
        tone = ("Before calling this 'ready to send', RE-READ each claim against its SOURCE (not against your own "
                "prose) and tag it documented, inferred, or unsupported. These tells fire here:")

    emit(
        f"CLAIM-FAITHFULNESS CHECK ({os.path.basename(path)} looks external-facing): {tone}\n{bullet}\n\n"
        "Fluency is not faithfulness, and memory inverts toward convenience: 'enabling X leaves Y untouched' "
        "is easy to write when the source says X can break Y. For a customer, Support, or leadership artifact, "
        "run `/claim-audit` before sending. A hook can flag the tells; only the re-read proves the claim. "
        "Ref: rules/claims-faithful-to-source.md."
    )


if __name__ == "__main__":
    main()
