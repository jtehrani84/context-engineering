#!/usr/bin/env python3
r"""
DRAFT GATE: scores the DRAFTS Claude shows in chat, the moment the reply ends. Nothing can intercept Claude's chat text
before it is displayed, so this is a Stop hook: when Claude finishes a reply that holds a draft meant for someone else (a
Slack message, an email, a post, a DM), it scores that draft locally with the send hook's own scorer and either sends
Claude back to fix it or tells the user what's still in it. It complements voice-tell-gate.py, which gates file writes
and MCP sends; this one covers the piece the user copies out of the chat by hand.

WHAT COUNTS AS A DRAFT (only these are scored, never the whole reply: Claude often quotes a banned word while explaining
it, "the filter caught 'seamless'", and that must not trip anything). Each stretch of the reply between tool calls is
read on its own, the way Claude Code shows it, and lines end only at \n or \r (as in Markdown):
  1. A fenced block whose info string starts with draft as a word: ```draft, ```draft slack, ~~~draft email,
     ```draft_email, ```draft-email, ```drafts, ```draft: slack, ```text draft. Not ```draft.js or ```draft-gate.test
     (code). The fence may sit in a list item at any indent or inside a blockquote. A ```draft example shown inside
     another fence is not a draft. An unclosed draft fence runs to the end of the stretch (or of its blockquote).
  2. Fallback, only when the stretch has no draft fence: a "Written for:" line, which your rules can ask Claude to put
     on a piece it hands over for another audience (also **Written for:**, **Written for**:, _Written for:_, as a
     heading or a list item). After that line the hook scores ONE piece: the first blockquote (">" lines, read as
     rendered: lazy continuation lines included, a paragraph's lines joined by a space) or the first untagged fence,
     within LEAD_IN prose lines ("Here it is:", a subject line). Nothing after that piece is scored, and a tagged fence
     (a diff, json, a log, gate output) is never the piece. If the line or the lead-in names a saved file
     (drafts/x.md), or nothing follows, the piece went to a file and the hook does nothing: the file gate covers files.
THE REPLY = the text blocks of the assistant records after the prompt that started this turn, or after the last "Stop
  hook feedback" or stop_hook_summary record (so after a block only the revision is scored, not the draft that was
  already flagged), across tool calls. A user record that arrives mid-turn (a task-notification, a message typed while
  Claude was working) does not end the turn: a prompt-shaped user record starts a turn only if the record before it ends
  a reply (an assistant record with no tool call waiting for its result, the file's start, a stop_hook_summary, an
  interrupted tool call, a compact summary). Tool results, thinking, subagent (sidechain) records and earlier turns are
  never scored. The transcript can lag the conversation, so the last_assistant_message field from the Stop input is
  added when the transcript doesn't hold it yet, and while continuing (stop_hook_active) with no feedback record in the
  file yet, only that field is scored. The transcript is read backwards from its end and stops at the turn's prompt,
  so a long session costs nothing extra; a record that won't parse is counted and named in the note.

DECISIONS, scored with voice-tell-gate.py's analyze() (imported read-only, so this gate and the send gate always agree).
analyze() also reads the flat view of the drafts (whitespace collapsed, backticks dropped), so "table\nstakes",
"sea`m`less" and "As `Globex`, we" read the way they render, in a draft and in a send alike (D9). With an older send
gate that has no flat_view(), this gate reads that view itself with the send gate's lexicon(). Every message also
carries the send gate's note when the per-user company-names file couldn't be read, as a send's message does.
  • hard tells (BLOCK_WORDS, BLOCK_PHRASES, critical overlay structures) -> block the stop: the reason tells Claude what
    to cut and to show the corrected draft in the same reply; the user sees a one-line systemMessage that it was flagged.
  • the user's own words: if every hard tell sits in a sentence the user wrote this turn word for word (a relay of their
    message), the stop is allowed with a note listing them. If Claude shows the same draft again after a block (it kept
    the user's words, as the reason allows), that stop is allowed with a note too, not blocked a second time.
  • soft tells only (NUDGE_WORDS, softer structures, a generic score of 40 or more on a draft over 200 characters) ->
    allow the stop and list them for the user in a systemMessage.
  • LOOP GUARD: at most MAX_BLOCKS (2) blocks per turn, counted in a small per-session state file under
    ~/.cache/voice-system/draft-gate/ (keyed by the turn's prompt_id, or the prompt record's promptId on builds that
    don't send it). The count never goes down within a turn, so if the turn goes on after an allowed stop (another Stop
    hook blocked) this gate doesn't start over. The stop after the second block is allowed and the user is told the
    draft is still flagged and which tells remain. If the count can't be saved while continuing, the stop is allowed
    the same way. Claude Code's own cap (8 continuations) is a second backstop. Cleanup removes only this gate's own
    week-old files.
  • FAILURE: if the transcript, the scorer, the normalizer, the send gate (import or analyze(), including a sys.exit
    in it), the hook input or this hook's own code fails, the stop is ALLOWED (a Stop hook that fails closed would trap
    the session) and the user sees "draft not checked: <cause>". Never silent when a draft might have been missed; an
    unreadable transcript next to a last message with no draft is said once per session. The send gate's node calls
    are held to SCORER_TIMEOUT (5 s) and NORMALIZER_TIMEOUT (3 s) here, so a hung scorer can't stall a stop past 10 s.
    Anything the send gate prints goes to stderr. A reply with no draft costs nothing and never loads the scorer.

PROVEN on Claude Code 2.1.286 (headless, a throwaway Stop hook in a temp settings file, 2026-10-02):
  stdin  session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name="Stop",
         stop_hook_active (false on the first stop, true on the stop after a block), last_assistant_message (the text
         of the final assistant message only), background_tasks, session_crons.
  stdout {"decision": "block", "reason": ...} made Claude continue; the reason reached Claude as a user message
         "Stop hook feedback:\n<reason>" (an isMeta user record in the transcript), and Claude Code also showed the user
         "Stop hook error occurred". {"systemMessage": ...} was shown to the user ("Stop says: <message>", a
         system/informational event in stream-json) both with a block and on an allowed stop.

INSTALL: the starter kit's ./setup.sh copies this file to ~/.claude/hooks/scripts/voice-draft-gate.py (voice-tell-gate.py
  must sit next to it, or set VOICE_TELL_GATE) and wires it on Stop with a guarded command, the one
  node ~/.claude/tools/onboarding/merge-hooks.mjs writes:
  "hooks": {"Stop": [{"matcher": "", "hooks": [{"type": "command", "command":
    "[ -f ~/.claude/hooks/scripts/voice-draft-gate.py ] || { echo '{\"systemMessage\": ...}'; exit 0; }; python3 ~/.claude/hooks/scripts/voice-draft-gate.py"}]}]}
  The guard lets the reply end with a "draft not checked" note if the script goes missing: python3 on a missing file
  exits 2, and exit 2 on Stop would block every reply. ./setup.sh --uninstall takes the entry out with the script.
  voice-doctor's draft-gate-wiring check fails until the entry and the script are both in place.

HONEST SCOPE: this checks a draft after it is on screen. The user may already have read it; the block makes Claude show
a fixed version right below. It catches the same known shapes the send gate does, nothing more, and only in drafts
marked one of the two ways above: an unmarked draft in plain prose is not seen. In the "Written for:" fallback the
first blockquote is taken as the piece, so a quoted incoming message placed first, with the reply quoted after it and
no ```draft fence, is scored instead of the reply; the ```draft fence avoids that. The words and forms are the send
gate's lists, so a form it lists ("delves", "seamlessly") is matched here the same way, and one it doesn't isn't.
Env overrides (tests and copies): VOICE_TELL_GATE (the send hook's path), VOICE_DRAFT_STATE_DIR, and the send hook's own
VOICE_AISCORE, VOICE_NORMALIZE, VOICE_SCORER_TIMEOUT (here capped at the 5 s and 3 s above). Tests: ~/.claude/tools/hook-tests/voice-draft-gate.test.py.

CHANGE NOTE 2026-10-02 (new). First version.
CHANGE NOTE 2026-10-02 (review fixes, same day). An adversarial review found 23 problems; all are fixed except two parts: one
  belongs to the send gate (inflected forms like "seamlessly", since added there as its D7) and "Written for —" with a
  dash, left out on purpose: the marker is "Written for:". Mid-turn user records no longer end the turn (F1); drafts are
  found per stretch, in lists and quotes, with \n-only line ends and more info-string spellings, and look-alikes like
  ```draft.js are left alone (F2-F8, FB5); the "Written for:" fallback scores one piece and only when there's no draft
  fence (FB1-FB3); the user's own words and an unchanged re-show aren't blocked again (FB4); the loop guard never counts
  down in a turn and keeps its key without prompt_id (LOOP-1, LOOP-2); own timeouts, no __pycache__, cleanup limited
  to its own files, BaseException caught, no silent skip of unreadable records, linear long-line reads, and no repeated
  note for an unreadable transcript (PERF-1/2, WRITE-1/2, FAIL-1/2, FB6). Tests: hook-tests/voice-draft-gate.test.py R1-R8.
CHANGE NOTE 2026-10-02 (docs only, after the merge into the hook-holes branch). The INSTALL section and the scope note
  were out of date: merge-hooks.mjs now wires this gate on Stop and the doctor checks it, and the send gate's lists carry
  inflected forms (its D7), so the "seamlessly" caveat is gone. No code changed.
"""
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True  # loading the send gate must not leave a __pycache__ next to the hooks

HERE = os.path.dirname(os.path.abspath(__file__))
SEND_GATE = os.environ.get("VOICE_TELL_GATE") or os.path.join(HERE, "voice-tell-gate.py")
STATE_DIR = os.environ.get("VOICE_DRAFT_STATE_DIR") or os.path.expanduser("~/.cache/voice-system/draft-gate")
MAX_BLOCKS = 2          # blocks per turn before the stop is allowed with a still-flagged note
LEAD_IN = 3             # prose lines allowed between "Written for:" and the piece
STATE_MAX_AGE = 7 * 86400
CHUNK = 1 << 20         # bytes per backwards read of the transcript
SCORER_TIMEOUT = 5.0    # this gate's own limits on the send gate's two node calls (5 + 3 s keeps a stop under 10 s)
NORMALIZER_TIMEOUT = 3.0

# A fence opener at any indent, inside any number of blockquote markers (a list item or a quote still renders a fence).
_FENCE_OPEN = re.compile(r"^((?:[ \t]*>[ ]?)*)([ \t]*)(`{3,}|~{3,})(.*)$")
_QUOTE_MARK = re.compile(r"^[ \t]*>[ ]?")
# ```draft, ```drafts, ```draft_email, ```draft-email, ```draft: slack; not ```draft.js or ```draft-gate.test
_DRAFT_TOKEN = re.compile(r"drafts?(?:[-_:][a-z]+)*:?", re.I)
_PROSE_INFO = {"text", "txt", "plain", "plaintext", "markdown", "md"}  # ```text draft
_WRITTEN_FOR = re.compile(r"^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d{1,3}[.)]\s+|>\s?)*[*_]{0,2}\s*written for\s*[*_]{0,2}\s*:", re.I)
_QUOTE = re.compile(r"^ {0,3}> ?(.*)$")
_STARTS_BLOCK = re.compile(r"^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d{1,3}[.)]\s|`{3,}|~{3,}|[-*_](?:\s*[-*_]){2,}\s*$)")
# a saved file named on the "Written for:" line or in the lead-in: the piece is in the file, the file gate covers it
_FILE_REF = re.compile(r"(?<![\w.])(?:~?/)?(?:[\w.\-]+/)*[\w\-][\w.\-]*\.(?:md|mdx|txt|html?|docx?|rtf|eml)\b", re.I)
_INTERRUPTED = "[Request interrupted"
FEEDBACK_PREFIX = "Stop hook feedback:"


class DraftError(Exception):
    """Something the gate needs didn't work. str(e) is a short cause for the user's note."""


# ── the reply ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _lines_backwards(path):
    """Non-empty lines of a file, last first, read in CHUNK-sized blocks from the end. A line longer than a block is
    collected in pieces and joined once, so one huge record costs linear time."""
    with open(path, "rb") as f:
        f.seek(0, 2)
        pos, tail = f.tell(), []  # tail: the pieces of the line being read, last piece first
        while pos > 0:
            step = min(CHUNK, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step)
            parts = buf.split(b"\n")
            if len(parts) == 1:
                tail.append(buf)
                continue
            ln = parts[-1] + b"".join(reversed(tail))
            if ln.strip():
                yield ln
            for ln in reversed(parts[1:-1]):
                if ln.strip():
                    yield ln
            tail = [parts[0]]
        ln = b"".join(reversed(tail))
        if ln.strip():
            yield ln


def _content(rec):
    m = rec.get("message")
    c = m.get("content") if isinstance(m, dict) else None
    return c if isinstance(c, (str, list)) else None


def _texts(rec):
    c = _content(rec)
    if isinstance(c, str):
        return [c]
    return [b["text"] for b in (c or []) if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)]


def _is_feedback(rec):
    return any(t.startswith(FEEDBACK_PREFIX) for t in _texts(rec))


def _results(rec):
    c = _content(rec)
    return [b for b in (c or []) if isinstance(c, list) and isinstance(b, dict) and b.get("type") == "tool_result"]


def _result_text(block):
    c = block.get("content")
    if isinstance(c, str):
        return c
    return " ".join(str(b.get("text", "")) for b in (c or []) if isinstance(c, list) and isinstance(b, dict))


def _is_prompt(rec):
    """Shaped like a user prompt: not a tool result, not meta (skill text, hook feedback), not a compact summary.
    Whether it starts the turn depends on the record before it (see read_turn)."""
    if rec.get("isMeta") or rec.get("isCompactSummary"):
        return False
    c = _content(rec)
    return isinstance(c, str) or (bool(c) and not _results(rec))


def _origin(rec):
    o = rec.get("origin")
    return o.get("kind") if isinstance(o, dict) else None


class Turn:
    """segments: the reply's text, one string per stretch between tool calls, in order. boundary: "feedback", "stop",
    "prompt" or None (where collecting stopped). turn_id: the promptId of the prompt that started the turn, if found.
    words: what the user wrote this turn (that prompt plus messages typed mid-turn). skipped: unreadable records in
    the reply; trailing: True if the only one is the file's last line (probably still being written)."""

    def __init__(self):
        self.segments, self.boundary, self.turn_id, self.words, self.skipped, self.trailing = [], None, None, [], 0, False


def read_turn(path):
    """Read the transcript backwards to the prompt that started this turn. The reply is collected up to the first
    boundary: a Stop-hook feedback record, a stop_hook_summary record, or that prompt. A prompt-shaped user record
    only starts the turn if the record before it ends a reply: an assistant record with no tool call still waiting for
    the result, the file's start, a stop_hook_summary, an interrupted tool call or a compact summary. Otherwise it
    arrived mid-turn (a task-notification, a message typed while Claude worked) and reading goes on past it.
    Raises DraftError if the file can't be read or holds no records."""
    if not isinstance(path, str) or not path:
        raise DraftError("no transcript_path in the hook input")
    t = Turn()
    segs, cur = [], []      # newest first; cur = the current stretch's texts, newest first
    answered = set()        # tool_use ids whose results come later in the file
    pending = []            # prompt-shaped user records waiting for the record before them, newest first
    collecting, parsed, first = True, 0, True

    def close(start):
        nonlocal collecting
        if collecting:
            segs.append(cur[:])
            t.boundary, collecting = ("prompt" if start else t.boundary), False
        for rec in pending:
            if _origin(rec) != "task-notification":
                t.words.extend(_texts(rec))
        if start and pending:
            t.turn_id = pending[-1].get("promptId") or pending[-1].get("uuid")
        pending.clear()

    try:
        for raw in _lines_backwards(os.path.expanduser(path)):
            last_line, first = first, False
            try:
                rec = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                if collecting:
                    t.skipped += 1
                    t.trailing = t.trailing or (last_line and t.skipped == 1)
                continue
            if not isinstance(rec, dict) or rec.get("isSidechain"):
                continue
            parsed += 1
            typ = rec.get("type")
            if typ == "system" and rec.get("subtype") == "stop_hook_summary":
                if pending:
                    close(True)
                    break
                if collecting:
                    segs.append(cur[:])
                    t.boundary, collecting = "stop", False
                continue
            if typ not in ("user", "assistant"):
                continue
            if pending:  # this record decides whether the pending prompt started the turn
                if typ == "assistant":
                    calls = [b.get("id") for b in (_content(rec) or []) if isinstance(b, dict) and b.get("type") == "tool_use"]
                    start = not any(c in answered for c in calls)
                elif _is_feedback(rec):
                    start = False  # typed while Claude was continuing after a Stop block
                elif _results(rec):
                    start = any(_result_text(b).lstrip().startswith(_INTERRUPTED) for b in _results(rec))
                elif rec.get("isCompactSummary"):
                    start = True
                elif rec.get("isMeta"):
                    continue  # a command caveat or skill text next to the prompt: look further back
                else:
                    pending.append(rec)  # another queued message: the group shares one fate
                    continue
                if start:
                    close(True)
                    break
                for p in pending:
                    if _origin(p) != "task-notification":
                        t.words.extend(_texts(p))
                pending.clear()
            if typ == "user":
                for b in _results(rec):
                    answered.add(b.get("tool_use_id"))
                if _is_feedback(rec):
                    if collecting:
                        segs.append(cur[:])
                        t.boundary, collecting = "feedback", False
                elif _is_prompt(rec):
                    pending.append(rec)
            else:
                for b in reversed(_content(rec) if isinstance(_content(rec), list) else []):
                    if not isinstance(b, dict) or not collecting:
                        continue
                    if b.get("type") == "tool_use" and cur:
                        segs.append(cur)
                        cur = []
                    elif b.get("type") == "text" and isinstance(b.get("text"), str):
                        cur.append(b["text"])
        else:
            if pending:
                close(True)
            elif collecting:
                segs.append(cur[:])
                collecting = False
    except OSError as e:
        raise DraftError(f"couldn't read the transcript ({e.strerror or e})")
    if not parsed:
        raise DraftError("the transcript holds no readable records")
    t.segments = ["\n\n".join(reversed(s)) for s in reversed(segs) if s]
    t.words = t.words[::-1]
    return t


# ── the drafts ────────────────────────────────────────────────────────────────────────────────────────────────────
def _split(text):
    """Lines the way Markdown sees them: only \\n, \\r\\n and \\r end a line (not U+2028, \\x1c and the like)."""
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def _unquote(line, depth):
    """line without its first `depth` blockquote markers, or None if it has fewer (the quote ended)."""
    for _ in range(depth):
        m = _QUOTE_MARK.match(line)
        if not m:
            return None
        line = line[m.end():]
    return line


def _blocks(text):
    """One text block as top-level items: ("line", text) or ("fence", info, body). Linear. A fence may sit in a list
    (any indent) or a blockquote; it closes on the same character repeated at least as many times with nothing after
    it, at the same quote depth. An unclosed fence runs to the end of the block, or to the end of its quote."""
    lines = _split(text)
    out, i, n = [], 0, len(lines)
    while i < n:
        m = _FENCE_OPEN.match(lines[i])
        if m and not (m.group(3)[0] == "`" and "`" in m.group(4)):
            depth, indent = m.group(1).count(">"), len(m.group(2).expandtabs(4))
            ch, width, info = m.group(3)[0], len(m.group(3)), m.group(4).strip()
            body, j = [], i + 1
            while j < n:
                inner = _unquote(lines[j], depth)
                if inner is None:
                    break
                s = inner.strip()
                if len(s) >= width and s == ch * len(s):
                    j += 1
                    break
                k = len(inner) - len(inner.lstrip(" "))
                body.append(inner[min(k, indent):])
                j += 1
            out.append(("fence", info, "\n".join(body)))
            i = j
        else:
            out.append(("line", lines[i]))
            i += 1
    return out


def _is_draft_info(info):
    toks = info.split()
    if not toks:
        return False
    if _DRAFT_TOKEN.fullmatch(toks[0]):
        return True
    return len(toks) > 1 and toks[0].lower() in _PROSE_INFO and bool(_DRAFT_TOKEN.fullmatch(toks[1]))


def _quote_piece(items, j):
    """The blockquote starting at items[j], as Markdown renders it: a paragraph's lines joined by a space (a lazy
    continuation line without ">" included), paragraphs by a blank line, consecutive quotes split only by blank lines
    kept together. Stops at the first other line or fence."""
    paras, cur = [], []
    while j < len(items) and items[j][0] == "line":
        line = items[j][1]
        q = _QUOTE.match(line)
        if q:
            body = re.sub(r"^(?:[ \t]*>[ ]?)*", "", q.group(1)).strip()
            if body:
                cur.append(body)
            elif cur:
                paras.append(" ".join(cur))
                cur = []
        elif not line.strip():
            if cur:
                paras.append(" ".join(cur))
                cur = []
        elif cur and not _STARTS_BLOCK.match(line) and not _WRITTEN_FOR.match(line):
            cur.append(line.strip())  # lazy continuation
        else:
            break
        j += 1
    if cur:
        paras.append(" ".join(cur))
    return "\n\n".join(paras)


def find_drafts(text):
    """The draft segments of one stretch of the reply. Every draft fence; only if there is none, the piece after each
    "Written for:" line: the first blockquote or untagged fence within LEAD_IN prose lines, unless that line or the
    lead-in names a saved file. Nothing else around it (a quoted incoming message, a diff, gate output) is scored."""
    items = _blocks(text)
    fences = [it for it in items if it[0] == "fence" and _is_draft_info(it[1])]
    if fences:
        return [it[2] for it in fences if it[2].strip()]
    drafts = []
    for k, it in enumerate(items):
        if it[0] != "line" or not _WRITTEN_FOR.match(it[1]) or _FILE_REF.search(it[1]):
            continue
        j, prose, piece = k + 1, 0, ""
        while j < len(items):
            cur = items[j]
            if cur[0] == "fence":
                piece = cur[2] if not cur[1] else ""  # a tagged fence (code, a diff, a log) isn't the piece
                break
            line = cur[1]
            if _QUOTE.match(line):
                piece = _quote_piece(items, j)
                break
            if line.strip():
                if _WRITTEN_FOR.match(line) or prose >= LEAD_IN or _FILE_REF.search(line):
                    break
                prose += 1
            j += 1
        if piece.strip():
            drafts.append(piece)
    return drafts


# ── the scorer (the send hook's own) ──────────────────────────────────────────────────────────────────────────────
def load_send_gate():
    if not os.path.isfile(SEND_GATE):
        raise DraftError(f"couldn't load the send gate: no file at {SEND_GATE}")
    try:
        with contextlib.redirect_stdout(sys.stderr):  # anything it prints must not reach Claude Code as a decision
            loader = importlib.machinery.SourceFileLoader("voice_tell_gate", SEND_GATE)
            spec = importlib.util.spec_from_loader("voice_tell_gate", loader)
            mod = importlib.util.module_from_spec(spec)
            loader.exec_module(mod)
    except BaseException as e:  # SystemExit too: a send gate that exits must not exit this hook with its code
        raise DraftError(f"couldn't load the send gate ({type(e).__name__}: {str(e)[:120]})")
    for name in ("analyze", "bullets", "lexicon"):
        if not callable(getattr(mod, name, None)):
            raise DraftError(f"couldn't load the send gate: it has no {name}()")
    for name, cap in (("SCORER_TIMEOUT", SCORER_TIMEOUT), ("NORMALIZER_TIMEOUT", NORMALIZER_TIMEOUT)):
        v = getattr(mod, name, None)
        setattr(mod, name, min(v, cap) if isinstance(v, (int, float)) and v > 0 else cap)
    return mod


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def score(gate, text):
    """The send gate's analyze() on the drafts, plus its word list on one more view: line breaks and runs of spaces
    collapsed to one space and backticks dropped, the way the piece reads once rendered or pasted. That pass only adds
    hits ("table\\nstakes", "sea`m`less"); the send gate's own lists and rules are used unchanged."""
    with contextlib.redirect_stdout(sys.stderr):
        crit, soft, total, failures = gate.analyze(text)
        if callable(getattr(gate, "flat_view", None)):  # the send gate reads this view itself (D9): the gates agree
            extra = ([], [])
        else:  # an older send gate: read the view here
            flat = re.sub(r"\s+", " ", text.replace("`", ""))
            extra = gate.lexicon(flat) if flat != text else ([], [])
    seen = {_norm(i.get("text", "")) for i in crit + soft}
    crit = crit + [i for i in extra[0] if _norm(i.get("text", "")) not in seen]
    seen |= {_norm(i.get("text", "")) for i in crit}
    soft = [i for i in soft if _norm(i.get("text", "")) not in {_norm(c.get("text", "")) for c in crit}]
    soft = soft + [i for i in extra[1] if _norm(i.get("text", "")) not in seen]
    return crit, soft, total, failures


def own_words(hits, text, words):
    """True if every hard hit sits in a sentence of the draft that the user wrote this turn, word for word (a relay
    of their own message). A word the user only named ("call it seamless") doesn't count."""
    said = _norm("\n".join(words))
    if not said or not hits:
        return False
    sentences = [_norm(s) for s in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text.replace("`", ""))) if s.strip()]
    for h in hits:
        k = _norm(h.get("text", ""))
        if not k or not any(k in s and len(s) >= 12 and s in said for s in sentences):
            return False
    return True


# ── the loop guard ────────────────────────────────────────────────────────────────────────────────────────────────
_STATE_NAME = re.compile(r"^[0-9a-f]{32}\.json(?:\.\d+\.tmp)?$")


def _state_path(session):
    return os.path.join(STATE_DIR, hashlib.sha256(str(session).encode()).hexdigest()[:32] + ".json")


def load_state(session):
    try:
        with open(_state_path(session)) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(session, state):
    """Write this session's state (atomic). Returns None, or a short cause if it couldn't be saved."""
    try:
        os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
        p = _state_path(session)
        tmp = f"{p}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(dict(state, at=int(time.time())), f)
        os.replace(tmp, p)
    except OSError as e:
        return e.strerror or str(e)
    try:  # best-effort: drop this gate's own files for other sessions after a week, nothing else in the dir
        cutoff = time.time() - STATE_MAX_AGE
        for name in os.listdir(STATE_DIR):
            q = os.path.join(STATE_DIR, name)
            if q != p and _STATE_NAME.match(name) and os.path.getmtime(q) < cutoff:
                os.remove(q)
    except OSError:
        pass
    return None


# ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────
def emit(obj):
    print(json.dumps(obj))


def note(msg):
    emit({"systemMessage": msg})


def _short(issues, cap=6):
    names = [str(i.get("text", "") or i.get("type", "")).strip() for i in issues[:cap]]
    return ", ".join(n for n in names if n) + (f", +{len(issues) - cap} more" if len(issues) > cap else "")


def run(inp):
    session = inp.get("session_id") or "no-session"
    active = inp.get("stop_hook_active") is True
    last = inp.get("last_assistant_message")
    last = last if isinstance(last, str) and last.strip() else None

    unchecked = []  # causes, shown to the user as "draft not checked: ..."
    read_failed = False
    try:
        t = read_turn(inp.get("transcript_path"))
    except DraftError as e:
        t, read_failed = Turn(), True
        t.boundary = "error"
        unchecked.append(str(e) + ("; only the last message was checked" if last else ""))
    if t.skipped and not (t.trailing and t.skipped == 1 and last):
        unchecked.append(f"{t.skipped} transcript record{'s' if t.skipped > 1 else ''} in this reply couldn't be read")
    segments = t.segments
    if active and t.boundary in ("prompt", None):
        # continuing after a Stop block, but the feedback record isn't in the file yet: the reply is the last message
        segments = []
        if not last:
            unchecked.append("the transcript doesn't show the reply after the Stop-hook feedback yet")
    if last and not any(last.strip() in s for s in segments) and last.strip() not in "\n\n".join(segments):
        segments = segments + [last]
    turn = str(inp.get("prompt_id") or t.turn_id or "")

    drafts = [d for s in segments for d in find_drafts(s)]
    pre = ("Voice draft gate: draft not checked: " + "; ".join(unchecked)) if unchecked else ""
    state = None
    if not drafts:
        if pre and read_failed and last:
            # the last message was read and holds no draft: say it once per session, not on every reply
            state = load_state(session)
            if state.get("noted") != "transcript":
                save_state(session, dict(state, noted="transcript"))
                note(pre + " (this note shows once per session)")
        elif pre:
            note(pre)
        return

    try:
        gate = load_send_gate()
    except DraftError as e:
        note("Voice draft gate: draft not checked: " + "; ".join(unchecked + [str(e)]))
        return
    try:  # D9: the send gate's note when the per-user company-names file couldn't be read fully, on every message here
        with contextlib.redirect_stdout(sys.stderr):
            names = (gate._names_note() or "").strip() if callable(getattr(gate, "_names_note", None)) else ""
    except Exception:
        names = ""
    nn = ("\n" + names) if names else ""
    text = "\n\n".join(drafts)
    try:
        crit, soft, total, failures = score(gate, text)
    except BaseException as e:  # SystemExit too
        note("Voice draft gate: draft not checked: " + "; ".join(unchecked + [f"the send gate's analyze() failed "
             f"({type(e).__name__}: {str(e)[:120]})"]) + ". The reply was allowed." + nn)
        return
    if failures:
        msg = "Voice draft gate: draft not checked: " + "; ".join(unchecked + [c for _, c in failures])
        msg += ". The reply was allowed. Check the draft by hand (node ~/.claude/tools/aiscore.mjs <file>) before you send it."
        if crit or soft:
            msg += "\nThe word list did run and flagged:\n" + gate.bullets(crit + soft)
        note(msg + nn)
        return
    tail = (("\n" + pre) if pre else "") + nn

    if crit:
        if own_words(crit, text, t.words):
            note("Voice draft gate (reply allowed): the draft has hard tells, but they're in your own words from this "
                 "turn, so Claude kept them. Your call before you send it:\n" + gate.bullets(crit + soft) + tail)
            return
        state = load_state(session)
        same_turn = state.get("turn") == turn
        blocks = state.get("blocks") if active and same_turn else 0
        blocks = blocks if isinstance(blocks, int) and not isinstance(blocks, bool) and blocks > 0 else 0
        digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
        if blocks >= MAX_BLOCKS:
            save_state(session, dict(state, turn=turn, blocks=MAX_BLOCKS))  # never lower within the turn
            note(f"Voice draft gate: the draft is still flagged after {MAX_BLOCKS} blocks, so the reply was allowed. "
                 "Fix these before you send it:\n" + gate.bullets(crit + soft) + tail)
            return
        if blocks and state.get("draft") == digest:
            note("Voice draft gate (reply allowed): Claude showed the same draft again after the block, so it stays as "
                 "it is. It still has hard tells; your call before you send it:\n" + gate.bullets(crit + soft) + tail)
            return
        err = save_state(session, dict(state, turn=turn, blocks=blocks + 1, draft=digest))
        if err and active:
            note("Voice draft gate: the draft is still flagged, and the loop guard couldn't save its count "
                 f"({err}), so the reply was allowed rather than risk a loop. Fix these before you send it:\n"
                 + gate.bullets(crit + soft) + tail)
            return
        reason = (
            f"VOICE DRAFT GATE (block {blocks + 1} of {MAX_BLOCKS} for this reply): the draft you just showed has hard "
            "tells, the send hook's block set:\n" + gate.bullets(crit) + "\n\n"
            "Cut these and show the corrected draft in this same reply, in a ```draft fence, so the user sees the clean "
            "version. Keep the explanation to a line. If the flagged text is the user's own words to send as-is, or a "
            "verbatim quote, tell the user it was flagged and let them decide; don't silently rephrase their words. "
            "You can show their words unchanged: this gate won't block the same draft twice."
        )
        user = f"Voice draft gate: the draft had hard tells ({_short(crit)}); Claude will fix it, or ask you if they're your words."
        emit({"decision": "block", "reason": reason + nn, "systemMessage": user + tail})
        return

    if soft or (total >= 40 and len(text) > 200):
        body = gate.bullets(soft) if soft else f"  • generic AI-writing score {total}/100 (elevated)"
        note("Voice draft gate (reply allowed): softer tells in the draft, worth a pass before you send it:\n" + body + tail)
    elif pre or names:
        note((pre + nn) if pre else "Voice draft gate: the draft was checked." + nn)


def main():
    # Every path out allows the stop (exit 0). A failure is shown to the user, never silent.
    try:
        inp = json.loads(sys.stdin.read())
        if not isinstance(inp, dict):
            raise ValueError("not a JSON object")
    except Exception as e:
        note(f"Voice draft gate: draft not checked: couldn't read the hook input ({type(e).__name__}: {str(e)[:120]}).")
        return
    try:
        run(inp)
    except BaseException as e:  # SystemExit and KeyboardInterrupt too: never exit non-zero, never trap the session
        note(f"Voice draft gate: draft not checked: internal error {type(e).__name__}: {str(e)[:120]}. The reply was allowed.")


if __name__ == "__main__":
    main()
