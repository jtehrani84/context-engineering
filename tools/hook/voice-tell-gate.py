#!/usr/bin/env python3
"""
Voice-tell gate: runs the voice engine's AI-writing checks on generated artifacts, never on in-thread conversation.
Hooks fire on tool calls, so a Write/Edit or an external send is checked, while Claude talking in the thread is not.

Two tiers, matched to whether the action can be undone:
  - FILE WRITES (PostToolUse on Write|Edit|MultiEdit, prose files only): NUDGE. The file isn't external yet, so a list
    of the tells and fixes is enough.
  - EXTERNAL SENDS (PreToolUse on the send tools in SEND_SUFFIXES: chat messages, email, shared documents and slides,
    comments, pull request and issue bodies): BLOCK on the block tier, NUDGE below it. A sent message can't be taken back.

Block tier (sends only): a block word or block phrase from the lexicon below (seamless, synergy, utilize, "it's worth
noting", ...), a critical structure from your overlay (<prefix>-struct-*), a phrase your overlay marks critical (a
TEAM_PHRASES hit), and any failure of the scorer or the normalizer. Dual-use words with a real technical sense
(leverage, robust, ecosystem, end-to-end, "north star") only nudge, and so does everything softer. The lexicon
(FULL_EXEMPT, NUDGE_WORDS, BLOCK_WORDS, BLOCK_PHRASES) is yours to tune: move a word between tiers if the gate is too
strict or too loose for you.

Scope. It catches known shapes: a tell no pattern lists gets through. It reads words, phrases and the structures your
overlay defines, not page layout. A send that doesn't go through an MCP tool its matcher reaches (a shell command such
as `gh pr create --body`) is not checked.

It runs ~/.claude/tools/aiscore.mjs (the scorer /voice-check uses) and ~/.claude/tools/text-normalize.mjs, so there is
one definition of a tell.

History (2026-10-02):
  D1  A failure of the scorer or the normalizer (throw, bad output, missing fields, timeout, node missing), or an
      exception inside this hook, DENIES a send and puts a visible warning on a file write (the write already
      happened). Unreadable hook input exits 2, Claude Code's blocking code, because the tier can't be told. Earlier
      versions carried on with the word list alone. The scorer timeout is 20 s.
  D2  The scorer's HTML reduction and emphasis scans run in linear time; a page of unclosed tags used to push the
      scorer past its timeout. A timeout fails closed anyway.
  D3  The word list also runs on the canonical text and the rendered view from text-normalize.mjs (invisible and tag
      characters, look-alike letters, NFKC, HTML entities, inline tags and comments, combining marks), so none of
      those can hide a banned word. The extra passes can only add hits.
  D4  A read marker (read, get, list, ...) counts only as a whole word of the tool's own name, so
      manage_spreadsheet_comment is a send; and overlay structures and phrases are read under any issue prefix.
Env overrides (tests and copies): VOICE_AISCORE, VOICE_NORMALIZE (script paths), VOICE_SCORER_TIMEOUT (seconds).
Source: ~/.claude/tools/hook/voice-tell-gate.py (setup.sh installs it in ~/.claude/hooks/scripts).
Tests: ~/.claude/tools/hook-tests/voice-tell-gate.test.py. Docs: docs/voice/ in the starter kit.
"""
import json
import os
import re
import subprocess
import sys

AISCORE = os.environ.get("VOICE_AISCORE") or os.path.expanduser("~/.claude/tools/aiscore.mjs")
NORMALIZER = os.environ.get("VOICE_NORMALIZE") or os.path.expanduser("~/.claude/tools/text-normalize.mjs")
try:  # seconds; the override is for tests (a hung stand-in shouldn't cost 20 s a case)
    SCORER_TIMEOUT = float(os.environ.get("VOICE_SCORER_TIMEOUT") or 20)
except ValueError:
    SCORER_TIMEOUT = 20.0
if not 0 < SCORER_TIMEOUT <= 40:  # also catches NaN; keeps both calls under Claude Code's 60 s hook timeout
    SCORER_TIMEOUT = 20.0
# Claude Code's default hook timeout is 60 s; both calls together stay well under it.
NORMALIZER_TIMEOUT = min(SCORER_TIMEOUT, 10.0)

FILE_TOOLS = {"Write", "Edit", "MultiEdit"}
PROSE_EXT = (".html", ".htm", ".md", ".mdx", ".txt", ".rtf", ".docx")

# External-send / publish tools (suffix-matched — the mcp__server__ prefix varies by server, so
# one entry covers every server prefix, mcp__github__ or any other).
# Widened to cover "the best we can with what we have" — every prose-bearing egress the connected
# MCP servers expose. Intentional exclusions: GitHub FILE pushes (create_or_update_file/push_files)
# carry code, where a prose scanner false-positives, and any prose file is already caught at
# local-write time; Sheets/Drive-file writes are data/binary, not the prose surface.
SEND_SUFFIXES = (
    # Slack — messages + canvases (create AND update = publishing content)
    "slack_send_message", "slack_send_message_draft", "slack_schedule_message",
    "slack_create_canvas", "slack_update_canvas",
    # Gmail
    "send_gmail_message", "draft_gmail_message",
    # Google Docs — create / import / every edit path
    "create_doc", "import_to_google_doc", "batch_update_doc", "insert_doc_elements",
    "modify_doc_text", "find_and_replace_doc", "update_doc_headers_footers",
    # Google Slides
    "create_presentation", "import_to_google_slides", "batch_update_presentation",
    # Google Forms
    "create_form", "batch_update_form",
    # Comments (prose to colleagues on a shared doc/deck/sheet)
    "manage_document_comment", "manage_presentation_comment", "manage_spreadsheet_comment",
    # GitHub and other git hosts — PR / issue / review PROSE bodies (not file pushes)
    "create_pull_request", "create_issue", "add_issue_comment", "create_pull_request_review",
    "update_pull_request", "update_issue", "add_comment_to_pending_review",
    "add_reply_to_pull_request_comment", "pull_request_review_write",
)
# Never treat a read/search/list/get as a send even if a suffix substring collides. Each marker is a whole word of
# the tool's own name (the part after the last "__"), so "spreadsheet" and a server named "research" don't count (D4a).
NOT_SEND = ("read", "search", "list", "get", "fetch", "download", "poll", "branch")

# Keys whose string values are plumbing, not prose — never scan them.
SKIP_KEYS = {
    "channel", "channel_id", "thread_ts", "ts", "user", "user_id", "url", "link", "id", "file_id",
    "path", "file_path", "owner", "repo", "head", "base", "branch", "sha", "name", "to", "cc",
    "bcc", "recipient", "email", "token", "cursor", "type", "mimetype", "filetype", "old_string",
}
_URLISH = re.compile(r"^(https?://|[A-Za-z0-9_]{8,}$|[\d.\-:/]+$)")

# ── Banned-word lexicon ──────────────────────────────────────────────────────
# Why a lexicon here and not only aiscore: the generic detector scores single
# slop words near 0 on SHORT text (a chat message, a PR body), which is exactly
# the outbound surface this gate guards, so the gate carries the words itself.
#   • FULL_EXEMPT  never flagged in an overlay phrase hit (your own product or
#                  project names, for example). Empty by default.
#   • NUDGE_WORDS  flagged, never blocked (a real technical/literal sense exists).
#   • BLOCK_WORDS/PHRASES  marketing slop with no technical use: block on send.
# Tunable: move a word between sets if the gate proves too aggressive or too loose.
FULL_EXEMPT = set()
NUDGE_WORDS = {
    "leverage", "robust", "landscape", "ecosystem", "innovative", "nuanced", "disruptive",
    "foster", "pivotal", "unlock", "empower", "facilitate", "unpack", "learnings",
    "north star", "end-to-end", "full-stack", "deep-dive", "double-click", "circle back",
}
BLOCK_WORDS = {
    "delve", "streamline", "seamless", "utilize", "solutioning", "ideation", "synergy",
    "paradigm", "transformative", "groundbreaking", "spearhead", "bolster", "fortify",
    "underpin", "underpinning", "cornerstone", "linchpin", "tapestry", "multifaceted",
    "holistic", "cutting-edge", "game-changing", "best-in-class", "world-class",
    "state-of-the-art", "mission-critical", "next-generation", "low-hanging fruit",
    "table stakes",
}
BLOCK_PHRASES = [re.compile(p, re.I) for p in (
    r"in today[’']?s rapidly evolving", r"it[’']?s worth noting", r"well[- ]positioned to",
    r"uniquely positioned", r"ushering in a new era", r"actionable insights?",
    r"in an era of", r"move the needle",
)]
_WORD_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in (BLOCK_WORDS | NUDGE_WORDS)}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def is_send_tool(name: str) -> bool:
    low = name.lower()
    own = set(re.findall(r"[a-z0-9]+", low.rsplit("__", 1)[-1]))
    if own & set(NOT_SEND):
        return False
    return any(low.endswith(s) or ("__" + s) in low or s in low for s in SEND_SUFFIXES)


def harvest(obj, key=None, depth=0, out=None):
    """Recursively collect prose-ish strings from a tool_input, skipping plumbing keys/IDs/URLs."""
    if out is None:
        out = []
    if depth > 7:
        return out
    if isinstance(obj, str):
        if key in SKIP_KEYS:
            return out
        s = obj.strip()
        if len(s) >= 3 and not _URLISH.match(s):
            out.append(s)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            harvest(v, k, depth + 1, out)
    elif isinstance(obj, list):
        for v in obj:
            harvest(v, key, depth + 1, out)
    return out


class GateError(Exception):
    """The scorer or the normalizer couldn't give a usable answer. str(e) is a short cause for the message."""


_ERR_LINE = re.compile(r"^(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b")  # node's "Error: ..." / "SyntaxError: ..." line


def _node(script, args, text, timeout, what):
    """Run `node script args` with text on stdin; return stdout. Any failure raises GateError."""
    data = text.encode("utf-8", "replace")  # a lone surrogate from JSON becomes "?" instead of crashing
    try:
        p = subprocess.run(["node", script, *args], input=data, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise GateError("node not found on PATH")
    except subprocess.TimeoutExpired:
        raise GateError(f"{what} timed out after {timeout:g} s")
    except OSError as e:
        raise GateError(f"couldn't start {what}: {e.strerror or e}")
    if p.returncode != 0:
        err = [ln.strip() for ln in p.stderr.decode("utf-8", "replace").splitlines() if ln.strip()]
        why = next((ln for ln in err if _ERR_LINE.match(ln)), err[-1] if err else "")
        raise GateError(f"{what} exited {p.returncode}" + (f": {why[:120]}" if why else ""))
    return p.stdout.decode("utf-8", "replace")


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def scan(text: str):
    """Run the shared aiscore scanner and return its JSON dict. Raises GateError if it can't run or its
    output lacks what analyze() reads: a numeric score and voice.issues as a list of {type, ...}."""
    out = _node(AISCORE, ["-", "--json"], text, SCORER_TIMEOUT, "aiscore")
    lines = [ln for ln in out.strip().splitlines() if ln.strip().startswith("{")]
    if not lines:
        raise GateError("aiscore printed no JSON" if out.strip() else "aiscore printed nothing")
    try:
        data = json.loads(lines[-1])
    except ValueError:
        raise GateError("aiscore printed invalid JSON")
    if not isinstance(data, dict):
        raise GateError("aiscore JSON is not an object")
    if not _is_num(data.get("score")):
        raise GateError("aiscore JSON has no numeric score")
    jv = data.get("voice")
    if not isinstance(jv, dict) or not isinstance(jv.get("issues"), list):
        raise GateError("aiscore JSON has no voice.issues list")
    for i in jv["issues"]:
        if not isinstance(i, dict) or not isinstance(i.get("type"), str) or \
                any(k in i and not isinstance(i[k], str) for k in ("text", "severity", "fix")):
            raise GateError("aiscore JSON has a malformed issue")
    return data


def canonical(text: str):
    """The two normalized views of the text, via the text-normalize.mjs CLI: (canonical, rendered). canonical is what the
    overlay's word scan reads (canonicalForScan); rendered is what a reader sees (renderedView: markup rendered, entities
    decoded, combining marks dropped, small capitals and confusable letters folded). Raises GateError on any failure,
    including a missing view or an answer for a different number of code points than sent."""
    sent = text.encode("utf-8", "replace").decode("utf-8")
    out = _node(NORMALIZER, ["--json"], text, NORMALIZER_TIMEOUT, "text-normalize")
    try:
        data = json.loads(out)
    except ValueError:
        raise GateError("text-normalize printed invalid JSON" if out.strip() else "text-normalize printed nothing")
    if not isinstance(data, dict) or not isinstance(data.get("canonical"), str):
        raise GateError("text-normalize JSON has no canonical text")
    if not isinstance(data.get("rendered"), str):
        raise GateError("text-normalize JSON has no rendered text")
    if data.get("inputCodePoints") != len(sent):
        raise GateError("text-normalize read a different text than was sent")
    return data["canonical"], data["rendered"]


_EXEMPT_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in FULL_EXEMPT}
# Overlay issue kinds under any ISSUE_PREFIX (voice-, a two-part prefix such as jane-doe-, any other), D4.
_STRUCT_TYPE = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-struct(?:-|$)")
_PHRASE_TYPE = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-phrase$")
_PREFIX_OF_KIND = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-(?=(?:phrase|word|probe)$)")  # shown as [phrase], [word]


def _verdict(snippet):
    """block / nudge / exempt / unknown for a matched word or phrase snippet."""
    for rx in _EXEMPT_RE.values():
        if rx.search(snippet):
            return "exempt"
    if any(_WORD_RE[w].search(snippet) for w in BLOCK_WORDS) or any(rx.search(snippet) for rx in BLOCK_PHRASES):
        return "block"
    if any(_WORD_RE[w].search(snippet) for w in NUDGE_WORDS):
        return "nudge"
    return "unknown"


def lexicon(text):
    """The lexicon scan: the curated word/phrase authority.
    Catches the vocabulary aiscore's overlay omits on SHORT outbound text."""
    crit, soft = [], []
    for w in sorted(BLOCK_WORDS):
        if _WORD_RE[w].search(text):
            crit.append({"type": "hard-ban", "text": f'"{w}"', "severity": "critical",
                         "fix": "on the hook's block list — cut it"})
    for rx in BLOCK_PHRASES:
        m = rx.search(text)
        if m:
            crit.append({"type": "hard-ban", "text": f'"{m.group(0)}"', "severity": "critical",
                         "fix": "on the hook's block list — cut it"})
    for w in sorted(NUDGE_WORDS):
        if _WORD_RE[w].search(text):
            soft.append({"type": "soft-ban", "text": f'"{w}"', "severity": "medium",
                         "fix": "dual-use — confirm the literal/product sense, else cut"})
    return crit, soft


def analyze(text):
    """Combine the aiscore scan (structures + generic score) with the curated banned-word
    lexicon, returning (crit, soft, score, failures). The lexicon is the authority on WORD/PHRASE
    block-vs-nudge; aiscore owns the couching/candor STRUCTURES and the generic score.
    The overlay's own word hits (<prefix>-word) are deliberately dropped: the lexicon
    curates dual-use vocabulary (end-to-end, ecosystem) to nudge instead of block. Overlay
    phrase hits (<prefix>-phrase) go through the same curation, so a phrase the lexicon
    doesn't list still nudges rather than vanish, and one the overlay marks critical blocks.
    The lexicon runs on the text as given AND on its canonical form and its rendered view (2026-10-02,
    D3), so a look-alike letter, an invisible character, an HTML entity, an inline tag or comment, or
    a combining mark can't hide a banned word; the extra passes only add hits. `failures` lists what couldn't run (scorer, normalizer); the caller fails
    closed on any (2026-10-02, D1). With no failures the result is exactly what it was before,
    plus any word the canonical pass reveals."""
    failures = []
    try:
        data = scan(text)
    except GateError as e:
        data, failures = None, failures + [("scorer", str(e))]
    try:
        views = canonical(text)
    except GateError as e:
        views, failures = (), failures + [("normalizer", str(e))]
    jv = (data or {}).get("voice", {}) or {}
    score = int((data or {}).get("score", 0) or 0)
    crit, soft = [], []
    for i in (jv.get("issues", []) or []):
        typ = i.get("type", "")
        critical = i.get("severity", "") == "critical"
        if _STRUCT_TYPE.search(typ):  # any overlay prefix: voice-struct-*, jane-doe-struct-*, ... (D4)
            (crit if critical else soft).append(i)
        elif _PHRASE_TYPE.search(typ):
            v = _verdict(i.get("text", ""))
            if v == "block" or (v != "exempt" and critical):  # a TEAM_PHRASES hit is critical
                crit.append(i)
            elif v != "exempt":
                soft.append(i)
        # <prefix>-word: ignored — the lexicon below is the curated word authority; <prefix>-cadence-*: not read here
    lc, ls = lexicon(text)
    crit += lc
    soft += ls
    for view in dict.fromkeys(v for v in views if v != text):  # each distinct view once
        cc, cs = lexicon(view)
        crit += cc
        soft += cs
    # dedupe by normalized matched text; a crit hit suppresses a duplicate soft hit
    seen, dcrit, dsoft = set(), [], []
    for i in crit:
        k = _norm(i.get("text", ""))
        if k and k in seen:
            continue
        seen.add(k)
        dcrit.append(i)
    for i in soft:
        k = _norm(i.get("text", ""))
        if k and k in seen:
            continue
        seen.add(k)
        dsoft.append(i)
    return dcrit, dsoft, score, failures


def bullets(issues, cap=6):
    out = []
    for i in issues[:cap]:
        t = i.get("type", "")
        t = _STRUCT_TYPE.sub("", t) if _STRUCT_TYPE.search(t) else _PREFIX_OF_KIND.sub("", t)
        out.append(f'  • [{t}] {i.get("text", "")}' + (f' — {i.get("fix")}' if i.get("fix") else ""))
    if len(issues) > cap:
        out.append(f"  • …+{len(issues) - cap} more")
    return "\n".join(out)


def emit_pre_deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason,
    }}))


def emit_context(event, msg):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": msg}}))


def _causes(failures):
    return "; ".join(cause for _, cause in failures)


def deny_unchecked(cause, hits=()):
    """Fail closed on a send: the gate couldn't check it, so it doesn't go out."""
    reason = (f"Voice gate couldn't run its scorer ({cause}), so this send is blocked rather than going out "
              "unchecked. Fix the scorer or send it yourself.")
    if hits:
        reason += "\nThe word list did run and also flagged:\n" + bullets(hits)
    emit_pre_deny(reason)


def warn_unchecked(path, failures, flagged=()):
    """Fail visibly on a file write: it already happened, so say what didn't run."""
    kinds = {k for k, _ in failures}
    missed = []
    if "scorer" in kinds:
        missed.append("the structure checks did not run (announced hedges, candor labels, the generic score), "
                      "only the word list did")
    if "normalizer" in kinds:
        missed.append("look-alike and invisible-character spellings weren't checked")
    if not missed:  # an exception inside the hook: nothing is known to have run
        missed.append("the voice checks did not run")
    msg = (f"VOICE GATE WARNING ({os.path.basename(path) or 'file'}): the gate couldn't run its scorer "
           f"({_causes(failures)}), so " + "; ".join(missed) + ". Check this file by hand "
           "(node ~/.claude/tools/aiscore.mjs <file>) before it ships, and fix the scorer.")
    if flagged:
        msg += "\nThe word list flagged:\n" + bullets(flagged)
    emit_context("PostToolUse", msg)


def run(hook_input):
    tool = hook_input.get("tool_name", "")
    tin = hook_input.get("tool_input", {}) or {}

    # ── FILE WRITE → post-write nudge (prose files only) ──────────────────────
    if tool in FILE_TOOLS:
        path = str(tin.get("file_path", "")).lower()
        if not path.endswith(PROSE_EXT):
            return
        if tool == "MultiEdit":
            text = "\n\n".join(str(e.get("new_string", "")) for e in tin.get("edits", []) or [])
        else:
            text = str(tin.get("content", "") or tin.get("new_string", ""))
        if len(text) < 400:  # too small to be a real artifact
            return
        crit, soft, score, failures = analyze(text)
        flagged = crit + soft
        if failures:
            warn_unchecked(path, failures, flagged)
            return
        if not flagged and score < 40:
            return
        head = f"AI-TELL CHECK ({os.path.basename(path)}): the voice guard flagged this generated file."
        body = bullets(flagged) if flagged else f"  • generic AI-writing score {score}/100 (elevated)"
        tail = ("Fix these before the file ships to a customer/colleague. This is a nudge, not a block — "
                "the send gate blocks the irreversible surface. Ref: rules/structural-voice.md.")
        emit_context("PostToolUse", f"{head}\n{body}\n{tail}")
        return

    # ── EXTERNAL SEND → block on critical, nudge below ────────────────────────
    if not is_send_tool(tool):
        return
    text = "\n\n".join(harvest(tin))
    if len(text.strip()) < 3:
        return
    crit, soft, score, failures = analyze(text)

    if failures:
        deny_unchecked(_causes(failures), crit)
        return

    if crit:
        emit_pre_deny(
            "AI-TELL GATE blocked this send — hard tells in the outgoing content:\n"
            + bullets(crit) + "\n\n"
            "Revise the content to cut these, then resend. (Block set = hard-ban words/phrases + "
            "critical announced-hedge/candor structures.) If the flagged text is a VERBATIM quote or "
            "was authored by the user to send as-is, tell the user it was gated and let them decide — "
            "don't silently rephrase their words. Ref: rules/structural-voice.md."
        )
        return

    soft_flag = soft or (score >= 40 and len(text) > 200)
    if soft_flag:
        body = bullets(soft) if soft else f"  • generic AI-writing score {score}/100 (elevated)"
        emit_context(
            "PreToolUse",
            "AI-TELL NUDGE (send allowed): softer tells in the outgoing content — consider a quick "
            f"pass before it lands with a customer/colleague:\n{body}",
        )
    return


def main():
    # Unreadable input: the tier can't be told, so exit 2, which Claude Code treats as blocking on
    # PreToolUse (the send doesn't happen) and shows to Claude on PostToolUse. Never a silent pass.
    try:
        hook_input = json.loads(sys.stdin.read())
        if not isinstance(hook_input, dict):
            raise ValueError("not a JSON object")
    except Exception as e:
        sys.stderr.write(f"Voice gate couldn't read its hook input ({type(e).__name__}: {e}), so it blocked "
                         "this call rather than let it through unchecked.\n")
        sys.exit(2)
    try:
        run(hook_input)
    except Exception as e:  # a bug in this hook must not turn into a pass (D1)
        cause = f"internal error {type(e).__name__}: {str(e)[:120]}"
        tool = hook_input.get("tool_name")
        if hook_input.get("hook_event_name") == "PostToolUse" or (isinstance(tool, str) and tool in FILE_TOOLS):
            tin = hook_input.get("tool_input")
            path = str(tin.get("file_path", "")) if isinstance(tin, dict) else ""
            warn_unchecked(path, [("hook", cause)])
        else:
            deny_unchecked(cause)


if __name__ == "__main__":
    main()
