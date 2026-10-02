#!/usr/bin/env python3
"""
PostToolUse hook (Write / Edit / MultiEdit): refutation-oracle gate, the negative-verdict mirror of
claim-faithfulness-gate.

Fires after a write that produces an AUDIT, REVIEW, or VERDICT artifact which calls a claim FALSE
("fabricated", "hallucinated", "invented", "no such record", "unsupported", "made up") without
showing the markers of right-oracle discipline. Hands Claude a reminder: a refutation is itself a
claim. Before "fabricated" stands, check the source where the claim would be TRUE. Absence from a
source that would not contain the claim even if it were real is not evidence.

WHY: an auditor tests a batch of claims against the one document it happens to hold, finds them
missing, and writes "fabricated". But a periodic financial filing, for example, lists no newly
filed lawsuits, no executive hires, no CRM records, and no chat threads, by design. Routing each
disputed claim to the source where it would actually live can flip most of such a verdict. The
pull is real: "I caught the model making things up" is a tidier story than "my method was sloppy".
See rules/refutation-needs-the-right-oracle.md.

HONEST SCOPE: this hook nudges, it cannot prove. It sees the bytes just written, not the sources
checked, so it cannot know whether the right oracle was reached. The proof is the re-check
against the right source, and for a high-stakes audit the /provenance-audit skill.

Conservative by design: it fires only when BOTH (a) the artifact reads like an audit or verdict
AND (b) it carries at least one refutation tell. It stays quiet on ordinary prose, code, notes,
and this kit's own rule and config files.

Output (Claude Code hooks contract):
  default                    hookSpecificOutput.additionalContext
  KIT_PROOF_GATES=block   top-level {"decision": "block", "reason": ...}
"""
import json
import os
import re
import sys

PROSE_EXT = (".html", ".htm", ".md", ".txt", ".rtf")
MIN_CHARS = 400

# Files that DEFINE the guards quote every trigger word; never fire on them.
SKIP_PATH_PARTS = ("/.claude/rules/", "/.claude/commands/", "/.claude/hooks/", "/.claude/workflows/")
SKIP_BASENAMES = {
    "refutation-needs-the-right-oracle.md", "refutation-oracle-gate.py",
    "claims-faithful-to-source.md", "claim-faithfulness-gate.py",
    "provenance-audit.md", "provenance-audit.mjs", "claim-audit.md",
}

# (a) Audit / verdict framing: the doc is judging claims, not just narrating. The refutation words
# themselves ("fabricated", "hallucinated") are tells for (b), not framing, or any passing use of
# the word in ordinary prose would qualify.
AUDIT_SIGNALS = [
    "audit", "verdict", "claim check", "claims checked",
    "provenance", "refut", "unverified", "reconcil", "review pass",
    "findings", "disputed", "verify each", "source of truth",
]

# (b) Refutation tells: a claim is being called FALSE. Each is a place a wrong RED slips in.
TELLS = [
    (r"\bfabricat(e|ed|ion|ions|ing)\b", "'fabricated': a refutation is a claim, so check the source where it WOULD be true before this stands"),
    (r"\bhallucinat(e|ed|ion|ions|ing)\b", "'hallucinated': same bar as any claim. Did you check the right oracle, or one that would never contain it?"),
    (r"\b(invented|made\s+up|make-believe|not\s+real|isn'?t\s+real|doesn'?t\s+exist|no\s+such\s+(record|thing|opp|contact|entity))\b", "'invented / no such record': absence from a wrong-by-design source proves nothing, so route the claim to where it lives"),
    (r"\b(uncorroborated|unsupported|no\s+source|zero\s+records|0\s+records|totalsize\s*0)\b", "'uncorroborated / 0 records': confirm you queried the RIGHT source (the correct record, not a duplicate stub) before calling it false"),
    (r"\b(none\s+appear|appears?\s+nowhere|absent\s+(from|in)|not\s+found\s+in|no\s+mention)\b", "'absent from / none appear': absent from WHICH source? A periodic financial filing will not list new lawsuits, hires, CRM records, or chat threads even when they are real"),
    (r"\b(that\s+is|this\s+is|it'?s)\s+(false|wrong|untrue|incorrect)\b", "flat 'that is false': is it contradicted across every plausible source, or just one? Forward guidance versus trailing actuals can both be true"),
]

# If the doc already shows right-oracle discipline, it has probably been through a provenance pass.
DISCIPLINE_PRESENT = [
    "unverified", "right oracle", "wrong oracle", "where it would be true", "where it would live",
    "not checked", "firewall", "lane", "would not contain", "by design", "not run",
    "re-check", "reconcile", "correct account", "disambiguat", "confirmed real",
]


def written_text(tool_name, tool_input):
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

    if not any(sig in low for sig in AUDIT_SIGNALS):
        return

    hits = [msg for pat, msg in TELLS if re.search(pat, low)]
    if not hits:
        return

    disciplined = sum(1 for c in DISCIPLINE_PRESENT if c in low) >= 4
    bullet = "\n".join(f"  - {h}" for h in hits[:4])  # cap the noise

    if disciplined:
        tone = ("This audit already shows right-oracle discipline (names its oracle, tags UNVERIFIED, separates "
                "lanes), so it may have been through a provenance pass. Still confirm each verdict of FALSE "
                "below was tested against the source where the claim would be TRUE:")
    else:
        tone = ("Before any verdict of FALSE here stands, ask 'if this were TRUE, where would it live?' and "
                "check THAT source. A refutation is a claim and carries the same burden as the thing it "
                "refutes. These refutation tells fire:")

    emit(
        f"REFUTATION-ORACLE CHECK ({os.path.basename(path)} reads like an audit or verdict): {tone}\n{bullet}\n\n"
        "Absence from a source that would not contain the claim even if true is NOT evidence. If a source "
        "that could carry the claim was not checked, tag the claim UNVERIFIED, never FABRICATED. For a "
        "high-stakes audit run `/provenance-audit` before the verdict ships. A hook flags the tells; only "
        "the right-oracle re-check proves a claim false. Ref: rules/refutation-needs-the-right-oracle.md."
    )


if __name__ == "__main__":
    main()
