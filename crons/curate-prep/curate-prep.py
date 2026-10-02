#!/usr/bin/env python3
"""
Curate Prep: READ-ONLY weekly analysis that gets /curate most of the way done.

Runs on a schedule (Sunday night by default) so your next /curate is a review, not a
cold scan. It does the tedious, non-destructive part of /curate (staleness, orphans,
MEMORY.md budget, wiki index health) and writes CURATE-PENDING.md. It NEVER deletes,
archives, moves, or edits a memory or wiki file. Those calls stay in the /curate run,
where you confirm each one.

Fail-visible: if anything goes wrong it still writes CURATE-PENDING.md, containing the
error, and exits 1 so `crons/manage.sh status` shows a non-zero last exit. A broken run
shows up at your next /curate instead of vanishing.

Data protection: the report lists your memory and wiki file names. It is written to
~/.claude/ and stays on your machine. Do not commit or share it.

Configuration (flag beats environment variable beats auto-detect):
  --memory-dir / CURATE_MEMORY_DIR   folder holding MEMORY.md and the topic files.
                                     Auto-detect: the ~/.claude/projects/*/memory folder
                                     whose MEMORY.md changed most recently.
  --wiki-dir   / CURATE_WIKI_DIR     your wiki folder (needs an index.md). Auto-detect:
                                     ~/.claude/wiki, then ~/wiki. Skipped if none exists.
  --out        / CURATE_OUT_FILE     where to write the report.
                                     Default: ~/.claude/crons/curate-prep/CURATE-PENDING.md
                                     (the path skills/curate.md Step 0 reads)

Usage:
  python3 curate-prep.py                 # auto-detect everything
  python3 curate-prep.py --memory-dir ~/.claude/projects/-Users-me-work/memory
"""
import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()

# Decay thresholds in days, matching skills/curate.md Step 1.
FAST_DECAY_DAYS = 14    # session logs, deploy or build status
MEDIUM_DECAY_DAYS = 30  # project state, ongoing work
SLOW_DECAY_DAYS = 90    # feedback, decisions, preferences, references
MEMORY_LINE_LIMIT = 200  # Claude Code only loads the first 200 lines of MEMORY.md
MAX_STALE_ROWS = 60
MAX_WIKI_ROWS = 30

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


def parse_frontmatter(text):
    """Lightweight frontmatter parse (no yaml dependency)."""
    m = FRONTMATTER_RE.match(text)
    fields = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if ":" in line and not line.strip().startswith("#"):
            k, _, v = line.partition(":")
            fields[k.strip()] = v.strip().strip('"').strip("'")
    return fields


def days_since(date_str, now=None):
    """Whole days since an ISO date string (YYYY-MM-DD), or None if unparseable."""
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d")
    except ValueError:
        return None
    return ((now or datetime.now()) - d).days


def decay_class(ftype, name):
    n = name.lower()
    if "session" in n or "deploy" in n or "build-status" in n:
        return "fast", FAST_DECAY_DAYS
    if ftype in ("feedback", "reference", "user") or "decision" in n:
        return "slow", SLOW_DECAY_DAYS
    if ftype == "project":
        return "medium", MEDIUM_DECAY_DAYS
    return "medium", MEDIUM_DECAY_DAYS


def detect_memory_dir():
    """Newest ~/.claude/projects/*/memory folder that has a MEMORY.md, or None."""
    best, best_mtime = None, -1.0
    projects = HOME / ".claude" / "projects"
    if not projects.is_dir():
        return None
    for d in projects.iterdir():
        idx = d / "memory" / "MEMORY.md"
        if idx.is_file() and idx.stat().st_mtime > best_mtime:
            best, best_mtime = d / "memory", idx.stat().st_mtime
    return best


def detect_wiki_dir():
    for cand in (HOME / ".claude" / "wiki", HOME / "wiki"):
        if cand.is_dir():
            return cand
    return None


def analyze(mem_dir, wiki_dir):
    lines = []
    now_iso = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    lines.append(f"# CURATE-PENDING: pre-computed {now_iso}")
    lines.append("")
    lines.append("> Read-only analysis for the next `/curate`. Nothing listed here was")
    lines.append("> deleted or edited. Review each item and decide inside `/curate`.")
    lines.append("")

    index_path = mem_dir / "MEMORY.md"
    mem_files = sorted(p for p in mem_dir.glob("*.md") if p.name != "MEMORY.md")
    index_text = index_path.read_text(encoding="utf-8", errors="replace") if index_path.exists() else ""
    index_lines = index_text.count("\n") + (0 if index_text.endswith("\n") or not index_text else 1)

    orphans = [p.name for p in mem_files if p.name not in index_text]

    stale_rows = []
    for p in mem_files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm = parse_frontmatter(text)
        ftype = fm.get("type", "?")
        lv = fm.get("last_verified", "")
        age_lv = days_since(lv)
        mtime_days = int((time.time() - p.stat().st_mtime) / 86400)
        klass, threshold = decay_class(ftype, p.name)
        # Effective age: last_verified if the file has it, else file modification time.
        eff_age = age_lv if age_lv is not None else mtime_days
        if eff_age > threshold:
            rec = "archive" if klass == "fast" else "review"
            stale_rows.append((p.name, ftype, eff_age, klass, lv or "none (used mtime)", rec))
    stale_rows.sort(key=lambda r: -r[2])

    lines.append("## MEMORY.md budget")
    if index_lines > MEMORY_LINE_LIMIT:
        status = "OVER LIMIT (lines past 200 are not loaded)"
    elif index_lines > 180:
        status = "near limit"
    else:
        status = "ok"
    lines.append(f"- {index_lines}/{MEMORY_LINE_LIMIT} lines: **{status}**")
    lines.append(f"- Memory files on disk: {len(mem_files)}. Orphaned (not in the index): **{len(orphans)}**")
    lines.append("")

    lines.append(f"## Orphaned memories ({len(orphans)}): on disk but not in MEMORY.md")
    if orphans:
        lines.append("Add a one-line index entry, or confirm each is intentionally de-indexed.")
        lines.append("")
        lines.extend(f"- [ ] `{name}`" for name in orphans)
    else:
        lines.append("None. The index is in sync.")
    lines.append("")

    lines.append(f"## Stale candidates ({len(stale_rows)}): past the decay threshold")
    if stale_rows:
        lines.append("| File | Type | Age (days) | Decay | last_verified | Suggest |")
        lines.append("|------|------|-----------:|-------|---------------|---------|")
        for name, ftype, age, klass, lv, rec in stale_rows[:MAX_STALE_ROWS]:
            lines.append(f"| `{name}` | {ftype} | {age} | {klass} | {lv} | {rec} |")
        if len(stale_rows) > MAX_STALE_ROWS:
            lines.append(f"| ...and {len(stale_rows) - MAX_STALE_ROWS} more | | | | | |")
    else:
        lines.append("None past threshold.")
    lines.append("")

    lines.append("## Wiki health")
    if wiki_dir and wiki_dir.is_dir():
        pages = list(wiki_dir.rglob("*.md"))
        idx = wiki_dir / "index.md"
        idx_text = idx.read_text(encoding="utf-8", errors="replace") if idx.exists() else ""
        not_in_index = []
        for p in pages:
            rel = str(p.relative_to(wiki_dir))
            if p.name in ("index.md", "inbox.md", "log.md"):
                continue
            if p.name not in idx_text and rel not in idx_text:
                not_in_index.append(rel)
        lines.append(f"- {len(pages)} wiki pages on disk")
        lines.append(f"- {len(not_in_index)} not referenced in index.md")
        lines.extend(f"  - [ ] `{rel}`" for rel in not_in_index[:MAX_WIKI_ROWS])
        if len(not_in_index) > MAX_WIKI_ROWS:
            lines.append(f"  - ...and {len(not_in_index) - MAX_WIKI_ROWS} more")
    else:
        lines.append("- No wiki folder found (set CURATE_WIKI_DIR to include one).")
    lines.append("")

    lines.append("---")
    lines.append("_Next: run `/curate`. It reads this file first when it is under 7 days old and skips the cold scan._")
    return "\n".join(lines) + "\n"


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read-only weekly prep for /curate.")
    ap.add_argument("--memory-dir", default=os.environ.get("CURATE_MEMORY_DIR"))
    ap.add_argument("--wiki-dir", default=os.environ.get("CURATE_WIKI_DIR"))
    ap.add_argument("--out", default=os.environ.get("CURATE_OUT_FILE"))
    args = ap.parse_args(argv)

    out = Path(args.out).expanduser() if args.out else HOME / ".claude" / "crons" / "curate-prep" / "CURATE-PENDING.md"
    try:
        mem_dir = Path(args.memory_dir).expanduser() if args.memory_dir else detect_memory_dir()
        if mem_dir is None or not mem_dir.is_dir():
            raise RuntimeError(
                "no memory folder found. Set CURATE_MEMORY_DIR or pass --memory-dir "
                "(it is the folder that holds MEMORY.md, under ~/.claude/projects/<project>/memory)."
            )
        wiki_dir = Path(args.wiki_dir).expanduser() if args.wiki_dir else detect_wiki_dir()
        report = analyze(mem_dir, wiki_dir)
        rc = 0
    except Exception as e:  # fail-visible
        report = (
            f"# CURATE-PENDING: FAILED {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
            "> curate-prep hit an error. This stub is intentional so the failure is visible\n"
            "> at your next /curate. Run /curate as a normal cold scan.\n"
            f"> Error: {e}\n"
        )
        rc = 1
    write_atomic(out, report)
    print(f"[curate-prep] wrote {out}" + ("" if rc == 0 else " (FAILED stub)"))
    return rc


if __name__ == "__main__":
    sys.exit(main())
