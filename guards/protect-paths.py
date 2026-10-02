#!/usr/bin/env python3
"""
protect-paths.py - PreToolUse guard: deny Write/Edit/MultiEdit/NotebookEdit into protected paths.

Use it to protect the files a check is graded against (eval gold sets, holdouts, a gate registry, a
lockfile). A detector can notice a tampered file after the fact; this hook stops the write in the first
place, so the agent that is being graded cannot edit what it is graded against.

Configure the protected set yourself. Nothing is protected until you add a path:
  - env  PROTECT_PATHS       one or more absolute paths separated by the OS path separator (":")
  - file PROTECT_PATHS_FILE  one absolute path per line, "#" comments allowed
                             (default: ~/.claude/protected-paths.txt)

FAIL CLOSED. Unparseable hook input or an internal error denies the call. A security guard that fails
open is not a guard.

Output contract (Claude Code PreToolUse): a block is a JSON object on stdout with
hookSpecificOutput.permissionDecision = "deny" plus permissionDecisionReason; exit 0. A pass-through
prints nothing (no decision), so the normal permission flow still applies.

Wire it as a PreToolUse hook with matcher "Write|Edit|MultiEdit|NotebookEdit".

Honest scope: this covers the file-writing tools only. A Bash command that redirects into a protected
path (echo > file, sed -i, mv) is not seen here. Pair it with a Bash-command check or a read-only mount
if the stakes are high.
"""
import json
import os
import sys

WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    return 0


def protected_roots():
    roots = []
    env = os.environ.get("PROTECT_PATHS", "")
    for p in env.split(os.pathsep):
        p = p.strip()
        if p:
            roots.append(os.path.abspath(os.path.expanduser(p)))
    cfg = os.environ.get("PROTECT_PATHS_FILE") or os.path.join(
        os.path.expanduser("~"), ".claude", "protected-paths.txt")
    try:
        if os.path.exists(cfg):
            with open(cfg) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        roots.append(os.path.abspath(os.path.expanduser(line)))
    except Exception:
        # config unreadable -> keep whatever the env gave us (still safe to continue)
        pass
    return roots


def is_protected(file_path, roots):
    """Return the matching protected root if file_path resolves inside (or equals) one, else None."""
    target = os.path.abspath(os.path.expanduser(file_path))
    real = os.path.realpath(target)  # a symlink into a protected dir counts
    norm = os.path.normpath(file_path).replace("\\", "/")
    for p in roots:
        p = p.rstrip("/")
        real_p = os.path.realpath(p)
        for t, root in ((target, p), (real, real_p), (real, p), (target, real_p)):
            if t == root or t.startswith(root + "/"):
                return p
        # defense in depth: a relative/odd path that still references the protected tail
        # (last two path components) anywhere in the normalized path
        tail = "/".join(p.split("/")[-2:])
        if tail and ("/" + tail + "/") in ("/" + norm.strip("/") + "/"):
            return p
    return None


def main():
    # Parse hook input; unparseable -> fail closed.
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return deny("protect-paths: unparseable hook input; blocking (fail-closed)")

    try:
        tool = data.get("tool_name") or data.get("tool") or ""
        if tool not in WRITE_TOOLS:
            return 0

        ti = data.get("tool_input") or data.get("input") or {}
        fp = ti.get("file_path") or ti.get("notebook_path") or ti.get("path") or ""
        if not fp:
            return 0

        hit = is_protected(fp, protected_roots())
        if hit:
            return deny(
                f"protect-paths: '{fp}' is inside a protected path ({hit}). "
                "A check the agent can edit proves nothing. Propose the change to the owner "
                "and let them make it; do not edit it directly."
            )
        return 0
    except Exception as e:
        return deny(f"protect-paths: internal error ({e}); blocking (fail-closed)")


if __name__ == "__main__":
    sys.exit(main())
