#!/usr/bin/env python3
"""fake-voice-hook.py: a small stand-in for the voice send/write hook, used only by the onboarding tests.

The tests copy it to <temporary HOME>/.claude/hooks/scripts/voice-tell-gate.py and wire it in a temporary settings.json,
so voice-doctor, profile-build and calibrate-user run against a hook whose behavior the test controls. It follows the
real hook's contract: PreToolUse on a send tool BLOCKS (permissionDecision deny) on a hard tell and on any scorer
failure; PostToolUse on a prose file write NUDGES (additionalContext), and warns when the scorer fails. Local only:
it runs the scorer at VOICE_AISCORE (else ~/.claude/tools/aiscore.mjs) and nothing else.

FAKE_HOOK_MODE picks a behavior, so a test can show the doctor catches each failure it claims to:
  fail-closed   the real contract (default)
  fail-open     a scorer failure lets a send through and a write pass silently (the bug the doctor must catch)
  deny-all      every send is denied, including a clean one
  ignore-tells  the word list and overlay issues are ignored; only a scorer failure blocks
  no-env        VOICE_AISCORE and VOICE_NORMALIZE are ignored (an older hook copy)
  normalizer-open  a scorer failure blocks, a normalizer failure is ignored
FAKE_HOOK_SEND (comma list) replaces the send-tool suffixes; FAKE_HOOK_EXT (comma list) replaces the prose extensions.
Every text the tests send through it is synthetic.
"""
import json
import os
import subprocess
import sys

MODE = os.environ.get("FAKE_HOOK_MODE", "fail-closed")
if MODE == "no-env":
    AISCORE = os.path.expanduser("~/.claude/tools/aiscore.mjs")
    NORMALIZER = os.path.expanduser("~/.claude/tools/text-normalize.mjs")
else:
    AISCORE = os.environ.get("VOICE_AISCORE") or os.path.expanduser("~/.claude/tools/aiscore.mjs")
    NORMALIZER = os.environ.get("VOICE_NORMALIZE") or os.path.expanduser("~/.claude/tools/text-normalize.mjs")

SEND_SUFFIXES = tuple(s for s in os.environ.get("FAKE_HOOK_SEND", "").split(",") if s) or (
    "slack_send_message", "slack_send_message_draft", "slack_schedule_message", "slack_create_canvas",
    "slack_update_canvas", "send_gmail_message", "draft_gmail_message", "create_doc", "import_to_google_doc",
    "batch_update_doc", "insert_doc_elements", "modify_doc_text", "find_and_replace_doc", "update_doc_headers_footers",
    "create_presentation", "import_to_google_slides", "batch_update_presentation", "create_form", "batch_update_form",
    "manage_document_comment", "manage_presentation_comment", "manage_spreadsheet_comment", "create_pull_request",
    "create_issue", "add_issue_comment", "create_pull_request_review", "update_pull_request", "update_issue",
    "add_comment_to_pending_review", "add_reply_to_pull_request_comment", "pull_request_review_write",
)
PROSE_EXT = tuple(s for s in os.environ.get("FAKE_HOOK_EXT", "").split(",") if s) or (
    ".md", ".mdx", ".txt", ".html", ".htm", ".rtf", ".docx")
FILE_TOOLS = ("Write", "Edit", "MultiEdit")
BLOCK_WORDS = ("seamless", "synergy", "streamline", "delve", "paradigm")
SKIP_KEYS = {"channel", "channel_id", "file_path", "path", "id", "url"}


def is_send_tool(name):
    low = name.lower()
    return any(low.endswith(s) for s in SEND_SUFFIXES)


class ScorerError(Exception):
    pass


def scan(text):
    try:
        p = subprocess.run(["node", AISCORE, "-", "--json"], input=text.encode(), capture_output=True, timeout=20)
    except Exception as e:  # noqa: BLE001 - any failure to run is a scorer failure
        raise ScorerError(str(e))
    if p.returncode != 0:
        raise ScorerError(f"aiscore exited {p.returncode}")
    lines = [ln for ln in p.stdout.decode().splitlines() if ln.strip().startswith("{")]
    if not lines:
        raise ScorerError("aiscore printed no JSON")
    try:
        data = json.loads(lines[-1])
    except ValueError:
        raise ScorerError("aiscore printed invalid JSON")
    if not isinstance(data, dict) or not isinstance(data.get("score"), (int, float)):
        raise ScorerError("aiscore JSON has no numeric score")
    issues = None
    for k, v in data.items():
        if (k == "voice" or k.endswith("Voice")) and isinstance(v, dict) and isinstance(v.get("issues"), list):
            issues = v["issues"]
    if issues is None:
        raise ScorerError("aiscore JSON has no overlay issues list")
    return data, issues


def normalize(text):
    """The canonical text from the normalizer CLI. Raises ScorerError on any failure."""
    try:
        p = subprocess.run(["node", NORMALIZER, "--json"], input=text.encode(), capture_output=True, timeout=10)
    except Exception as e:  # noqa: BLE001
        raise ScorerError(str(e))
    try:
        data = json.loads(p.stdout.decode().strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise ScorerError("text-normalize printed no JSON")
    if p.returncode != 0 or not isinstance(data, dict) or not isinstance(data.get("canonical"), str):
        raise ScorerError("text-normalize gave no canonical text")
    return data["canonical"]


def harvest(obj, key=None, out=None):
    out = [] if out is None else out
    if isinstance(obj, str):
        if key not in SKIP_KEYS and len(obj.strip()) >= 3:
            out.append(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            harvest(v, k, out)
    elif isinstance(obj, list):
        for v in obj:
            harvest(v, key, out)
    return out


def analyze(text):
    """(crit, soft, failed): crit are hard tells, soft are nudges."""
    try:
        _, issues = scan(text)
    except ScorerError as e:
        return [], [], str(e)
    try:
        canonical = normalize(text)
    except ScorerError as e:
        if MODE != "normalizer-open":
            return [], [], str(e)
        canonical = text
    if MODE == "ignore-tells":
        return [], [], None
    crit, soft = [], []
    low = (text + "\n" + canonical).lower()
    for w in BLOCK_WORDS:
        if w in low:
            crit.append({"type": "hard-ban", "text": w})
    for i in issues:
        sev = i.get("severity", "")
        if sev == "critical":
            crit.append({"type": i.get("type", "issue"), "text": i.get("text", "")})
        elif sev in ("high", "medium") and not i.get("type", "").endswith("-probe"):
            soft.append({"type": i.get("type", "issue"), "text": i.get("text", "")})
    return crit, soft, None


def bullets(items):
    return "\n".join(f'  • [{i["type"]}] {i["text"]}' for i in items)


def out(event, **kw):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, **kw}}))


def main():
    try:
        h = json.loads(sys.stdin.read())
    except Exception:  # noqa: BLE001
        sys.stderr.write("fake hook: unreadable input\n")
        sys.exit(2)
    tool = h.get("tool_name", "")
    tin = h.get("tool_input") or {}
    if tool in FILE_TOOLS:
        path = str(tin.get("file_path", "")).lower()
        if not path.endswith(PROSE_EXT):
            return
        text = str(tin.get("content", "") or tin.get("new_string", ""))
        crit, soft, failed = analyze(text)
        if failed:
            if MODE != "fail-open":
                out("PostToolUse", additionalContext=f"VOICE GATE WARNING: the gate couldn't run its scorer ({failed}), so the checks did not run.")
            return
        if crit or soft:
            out("PostToolUse", additionalContext="AI-TELL CHECK: the voice guard flagged this file.\n" + bullets(crit + soft))
        return
    if not is_send_tool(tool):
        return
    if MODE == "deny-all":
        out("PreToolUse", permissionDecision="deny", permissionDecisionReason="fake hook: deny-all mode")
        return
    text = "\n\n".join(harvest(tin))
    crit, soft, failed = analyze(text)
    if failed:
        if MODE != "fail-open":
            out("PreToolUse", permissionDecision="deny", permissionDecisionReason=f"Voice gate couldn't run its scorer ({failed}), so this send is blocked.")
        return
    if crit:
        out("PreToolUse", permissionDecision="deny", permissionDecisionReason="AI-TELL GATE blocked this send:\n" + bullets(crit))
        return
    if soft:
        out("PreToolUse", additionalContext="AI-TELL NUDGE (send allowed):\n" + bullets(soft))


if __name__ == "__main__":
    main()
