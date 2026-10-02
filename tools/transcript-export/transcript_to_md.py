#!/usr/bin/env python3
"""Convert a Claude Code session transcript (.jsonl) into readable Markdown.

Keeps your messages, Claude's replies, and thinking blocks in full. Clips bulky tool
input and output and system or hook text so the file is usable, not a multi-megabyte wall.

DATA PROTECTION. A session transcript holds everything that passed through the session:
pasted credentials, customer names, deal details, file contents. This script runs
locally and makes no network calls. By default it masks strings shaped like common
credentials (API keys, tokens, private keys), but pattern masking is a backstop, not a
guarantee. Treat the Markdown output as sensitive as the transcript. Do not upload it to
a summarizer, a web tool, or a shared drive unless you have read it first.

Where transcripts live: ~/.claude/projects/<project-folder>/<session-id>.jsonl

Usage:
  transcript_to_md.py SRC.jsonl OUT.md [--tool-trunc N] [--date YYYY-MM-DD] [--tz ZONE]
                                      [--no-redact]

  --tool-trunc N   max characters for each tool input or output block (default 2000)
  --date D         keep only rows from calendar day D, in the --tz zone
  --tz ZONE        IANA zone for timestamps and --date, for example America/New_York.
                   Default: this computer's local time zone.
  --no-redact      skip the credential-shape masking

A session file can span many calendar days, because pausing and resuming appends to the
same file. Use --date to slice out one day.

Older positional form still works: SRC.jsonl OUT.md [TOOL_TRUNC] [YYYY-MM-DD]
"""
import argparse
import datetime
import json
import re
import sys

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python < 3.9
    ZoneInfo = None

SYS_TRUNC = 800

# Credential shapes. Deliberately narrow so ordinary prose is never masked.
REDACTIONS = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
     "[REDACTED PRIVATE KEY]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}"), "[REDACTED API KEY]"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"), "[REDACTED SLACK TOKEN]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "[REDACTED GITHUB TOKEN]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED AWS KEY ID]"),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), "[REDACTED GOOGLE API KEY]"),
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9\-._~+/]{20,}=*"), r"\1 [REDACTED TOKEN]"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"), "[REDACTED JWT]"),
]


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Convert a Claude Code .jsonl transcript to Markdown.")
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("legacy", nargs="*", help="legacy positional TOOL_TRUNC and DATE")
    ap.add_argument("--tool-trunc", type=int, default=None)
    ap.add_argument("--date", default=None)
    ap.add_argument("--tz", default=None)
    ap.add_argument("--no-redact", action="store_true")
    a = ap.parse_args(argv)
    for extra in a.legacy:  # back-compat with the positional form
        if re.fullmatch(r"\d+", extra) and a.tool_trunc is None:
            a.tool_trunc = int(extra)
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", extra) and a.date is None:
            a.date = extra
        else:
            ap.error(f"unrecognized argument: {extra}")
    if a.tool_trunc is None:
        a.tool_trunc = 2000
    if a.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
        ap.error("--date must look like YYYY-MM-DD")
    return a


def make_tz(name):
    if not name:
        return None  # local zone, resolved per timestamp
    if ZoneInfo is None:
        sys.exit("--tz needs Python 3.9 or newer")
    try:
        return ZoneInfo(name)
    except Exception:
        sys.exit(f"unknown time zone: {name}")


def to_local(ts, tz):
    """Parse an ISO timestamp (UTC 'Z' form) and convert to tz (or local time). None on failure."""
    if not ts:
        return None
    try:
        dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(tz) if tz else dt.astimezone()


def clean(s):
    if not isinstance(s, str):
        s = str(s)
    return "".join(ch for ch in s if ch in "\n\t" or ord(ch) >= 32)


def convert(src, out_path, tool_trunc, date_filter, tz, redact, tz_label=None):
    def mask(s):
        if not redact:
            return s
        for pat, repl in REDACTIONS:
            s = pat.sub(repl, s)
        return s

    def trunc(s, n):
        s = mask(clean(s))
        if len(s) > n:
            return s[:n] + f"\n\n_... [truncated {len(s) - n} chars]_"
        return s

    def full(s):
        return mask(clean(s))

    def fmt_ts(ts):
        dt = to_local(ts, tz)
        if dt is None:
            return str(ts) if ts else ""
        return dt.strftime("%Y-%m-%d %H:%M:%S %Z")

    lines_in = lines_bad = human_turns = 0
    out = []
    emit = out.append

    with open(src, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            lines_in += 1
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                lines_bad += 1
                continue
            if not isinstance(obj, dict):
                lines_bad += 1
                continue

            typ = obj.get("type", "")
            raw_ts = obj.get("timestamp", "")
            ts = fmt_ts(raw_ts)

            # Date filter: skip rows outside the requested day. Summary rows carry no
            # timestamp, so they are skipped too when filtering.
            if date_filter:
                dt = to_local(raw_ts, tz)
                if dt is None or dt.strftime("%Y-%m-%d") != date_filter:
                    continue

            if typ == "summary":
                emit("\n---\n")
                emit(f"> **[COMPACTION SUMMARY]**\n>\n> {trunc(obj.get('summary', ''), 4000)}")
                emit("")
                continue

            msg = obj.get("message", {})
            if not isinstance(msg, dict):
                continue
            role = msg.get("role", typ)
            content = msg.get("content")
            tag = " · subagent" if obj.get("isSidechain", False) else ""

            if isinstance(content, str):
                blocks = [{"type": "text", "text": content}]
            elif isinstance(content, list):
                blocks = content
            else:
                continue

            # Genuine human turn (text) or a tool-result carrier?
            has_text = any(
                isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
                for b in blocks
            )
            only_toolresult = bool(blocks) and all(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks
            )

            if role == "user" and has_text:
                human_turns += 1
                emit("\n" + "=" * 70)
                emit(f"## USER  ·  {ts}")
                emit("=" * 70 + "\n")
            elif role == "user" and only_toolresult:
                emit(f"\n<sub>tool result · {ts}</sub>\n")
            elif role == "assistant":
                emit(f"\n### ASSISTANT{tag}  ·  {ts}\n")
            else:
                emit(f"\n<sub>{role}/{typ}{tag} · {ts}</sub>\n")

            for b in blocks:
                if not isinstance(b, dict):
                    emit(full(str(b)))
                    continue
                bt = b.get("type")
                if bt == "text":
                    t = b.get("text", "").strip()
                    if not t:
                        continue
                    # System reminders and hook dumps are long; clip them wherever they appear.
                    if role not in ("assistant", "user") or (role == "user" and not has_text) \
                            or t.startswith("<system-reminder>"):
                        emit(trunc(t, SYS_TRUNC))
                    else:
                        emit(full(t))
                elif bt == "thinking":
                    th = b.get("thinking", "") or b.get("text", "")
                    if th.strip():
                        emit("<details><summary>thinking</summary>\n")
                        emit(full(th))
                        emit("\n</details>")
                elif bt == "tool_use":
                    name = b.get("name", "?")
                    try:
                        inp_s = json.dumps(b.get("input", {}), indent=2, ensure_ascii=False)
                    except Exception:
                        inp_s = str(b.get("input"))
                    emit(f"\n**tool: {name}**")
                    emit("```json")
                    emit(trunc(inp_s, tool_trunc))
                    emit("```")
                elif bt == "tool_result":
                    c = b.get("content", "")
                    if isinstance(c, list):
                        parts = []
                        for x in c:
                            if isinstance(x, dict):
                                parts.append(x.get("text", "") or str(x.get("type", "")))
                            else:
                                parts.append(str(x))
                        c = "\n".join(parts)
                    emit("\n**result**")
                    emit("```")
                    emit(trunc(c, tool_trunc))
                    emit("```")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("# Session transcript\n\n")
        f.write(f"**Source:** `{src.split('/')[-1]}`  \n")
        if date_filter:
            f.write(f"**Filtered to date:** {date_filter} ({tz_label or 'local time'})  \n")
        f.write(f"**Converted:** {lines_in} JSONL rows into Markdown  \n")
        f.write(f"**Human turns:** {human_turns} · **Unparseable rows skipped:** {lines_bad}  \n")
        f.write(
            "**Note:** your messages, Claude's replies, and thinking blocks are kept in full; "
            f"tool inputs and outputs are clipped to {tool_trunc} chars and system or hook text "
            f"to {SYS_TRUNC} chars. "
            + ("Credential-shaped strings are masked. " if redact else "Credential masking was OFF. ")
            + "Treat this file as sensitive as the transcript.\n\n"
        )
        f.write("\n".join(out))

    return lines_in, lines_bad, human_turns


def main(argv=None):
    a = parse_args(sys.argv[1:] if argv is None else argv)
    tz = make_tz(a.tz)
    rows, bad, turns = convert(a.src, a.out, a.tool_trunc, a.date, tz, not a.no_redact, a.tz)
    print(f"rows_in={rows} bad={bad} human_turns={turns}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
