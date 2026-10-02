#!/usr/bin/env python3
"""
PreToolUse Guardrail Hook — Blocks dangerous operations before they execute.

This hook intercepts tool calls and checks them against your constraint list.
Customize BLOCKED_PATTERNS below with YOUR most expensive mistakes.

Examples included:
- Deploying with --set-env-vars (wipes all vars, use --update-env-vars)
- Force-pushing to main (any flag order; --force-with-lease is allowed)
- Recursive deletes of /, your home directory, or the project root
- Committing secrets

Output contract (Claude Code PreToolUse): deny or ask via
hookSpecificOutput.permissionDecision. Anything the hook doesn't object to exits 0 with no output,
so the normal permission flow applies.
"""

import json
import os
import re
import shlex
import subprocess
import sys

# Branches that must never be force-pushed to or deleted on the remote.
PROTECTED_BRANCHES = {"main", "master"}


# === CUSTOMIZE THIS ===
# Add patterns for commands that have burned you before. Force-push and recursive-delete are
# handled by the parser-based checks further down, because a regex can't tell
# "--force-with-lease" from "--force", or "main --force" from "--force main".
BLOCKED_PATTERNS = [
    {
        "pattern": r"--set-env-vars",
        "message": "BLOCKED: --set-env-vars REPLACES all environment variables. Use --update-env-vars to add/update without wiping existing vars.",
        "tool": "Bash",
    },
    {
        "pattern": r"git reset --hard",
        "message": "WARNING: git reset --hard discards uncommitted work permanently. Consider git stash instead.",
        "tool": "Bash",
    },
    {
        "pattern": r"\.(env|pem|key|cert|secret)",
        "message": "WARNING: This may involve a sensitive file. Ensure you're not committing secrets.",
        "tool": "Write",
    },
]


# --- Shell-aware checks (force-push, recursive delete) ---------------------------------------

_SEPARATORS = set(";&|()<>\n")
_WRAPPERS = {"sudo", "command", "exec", "nohup", "time", "env", "nice"}
_SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}


def _segments(command):
    """Split a shell command line into simple commands (lists of tokens).

    Operators (; && || | & subshell parens) split segments. Quotes are removed, variables are NOT
    expanded, so "$HOME" arrives as the token $HOME. Falls back to whitespace splitting if the
    quoting is unbalanced.
    """
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>\n")
        lex.whitespace = " \t\r"  # a newline separates commands
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        tokens = command.split()
    segments, current = [], []
    for tok in tokens:
        if tok and set(tok) <= _SEPARATORS:
            if current:
                segments.append(current)
            current = []
        else:
            current.append(tok)
    if current:
        segments.append(current)
    return segments


def _strip_prefix(seg):
    """Drop VAR=value assignments and sudo/env/command-style wrappers from the front."""
    i = 0
    while i < len(seg):
        tok = seg[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tok) or tok in _WRAPPERS:
            i += 1
            continue
        break
    return seg[i:]


def _simple_commands(command, depth=0):
    """Yield each simple command, descending into `bash -c '...'` and `eval '...'` strings."""
    for seg in _segments(command):
        seg = _strip_prefix(seg)
        if not seg:
            continue
        yield seg
        if depth < 2:
            name = os.path.basename(seg[0])
            inner = None
            if name in _SHELLS and "-c" in seg[1:-1]:
                inner = seg[seg.index("-c") + 1]
            elif name == "eval" and len(seg) > 1:
                inner = " ".join(seg[1:])
            if inner:
                yield from _simple_commands(inner, depth + 1)


_GIT_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
_PUSH_VALUE_OPTS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}


def _git_push_args(seg):
    """Return the arguments after `git ... push`, or None if this isn't a git push."""
    if os.path.basename(seg[0]) != "git":
        return None
    i = 1
    while i < len(seg):
        tok = seg[i]
        if tok == "push":
            return seg[i + 1:]
        if tok in _GIT_VALUE_OPTS:
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        return None  # some other git subcommand
    return None


def _current_branch(cwd):
    try:
        out = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd or None,
                             capture_output=True, text=True, timeout=2)
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _branch_of(ref):
    ref = ref.lstrip("+")
    dest = ref.split(":", 1)[1] if ":" in ref else ref
    if dest.startswith("refs/heads/"):
        dest = dest[len("refs/heads/"):]
    return dest


def check_force_push(command, cwd=""):
    """Deny force-pushes to protected branches, ask on other plain force-pushes.

    --force-with-lease (and --force-if-includes) is the safe form and is never flagged.
    Catches: `--force main`, `main --force`, `-f`, clustered short flags like `-uf`, a `+main`
    refspec, `HEAD:main`, and a bare `git push --force` while a protected branch is checked out.
    Also blocks deleting a protected branch on the remote.
    """
    for seg in _simple_commands(command):
        args = _git_push_args(seg)
        if args is None:
            continue
        force, delete, positionals = False, False, []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "--":
                positionals.extend(args[i + 1:])
                break
            if a in _PUSH_VALUE_OPTS:
                i += 2
                continue
            if a == "--force":
                force = True
            elif a == "--delete":
                delete = True
            elif a.startswith("--"):
                pass  # --force-with-lease[=..], --force-if-includes, --tags, --set-upstream, ...
            elif a.startswith("-") and len(a) > 1:
                if "f" in a[1:]:
                    force = True
                if "d" in a[1:]:
                    delete = True
            else:
                positionals.append(a)
            i += 1
        refspecs = positionals[1:]  # first positional is the remote
        plus_forced = any(r.startswith("+") for r in refspecs)
        targets = [_branch_of(r) for r in refspecs]
        if delete or any(r.startswith(":") for r in refspecs):
            if any(t in PROTECTED_BRANCHES for t in targets):
                return "BLOCKED: Deleting a protected branch on the remote is destructive and affects the team."
        if not (force or plus_forced):
            continue
        if any(t in PROTECTED_BRANCHES for t in targets):
            return ("BLOCKED: Force-pushing to a protected branch is destructive and affects the team. "
                    "Use a feature branch, or --force-with-lease if you must rewrite history.")
        if not refspecs or any(t in ("HEAD", "") for t in targets):
            if _current_branch(cwd) in PROTECTED_BRANCHES:
                return ("BLOCKED: This force-push would update a protected branch (it is checked out). "
                        "Use a feature branch, or --force-with-lease if you must rewrite history.")
        return ("WARNING: Plain --force overwrites remote history without checking what is there. "
                "Prefer --force-with-lease.")
    return None


_DANGEROUS_RM_TARGET = re.compile(
    r"^(?:(?:~|\$HOME|\$\{HOME\}|\.|\.\.)/*\*?|/+\*?|\*)$"
)


def check_recursive_delete(command):
    """Deny `rm -r` on /, the home directory, the project root, or a bare glob.

    `rm -rf ./build` and `rm -rf ~/scratch/tmp` are fine; only the bare dangerous targets match.
    Handles -rf, -fr, -Rf, -r -f, --recursive, "$HOME", ${HOME}, ~/, /*, and sudo/bash -c wrappers.
    """
    for seg in _simple_commands(command):
        if os.path.basename(seg[0]) != "rm":
            continue
        recursive, targets, end_opts = False, [], False
        for a in seg[1:]:
            if not end_opts and a == "--":
                end_opts = True
            elif not end_opts and a.startswith("--"):
                if a == "--recursive":
                    recursive = True
            elif not end_opts and a.startswith("-") and len(a) > 1:
                if "r" in a[1:] or "R" in a[1:]:
                    recursive = True
            else:
                targets.append(a)
        if recursive and any(_DANGEROUS_RM_TARGET.match(t) for t in targets):
            return "BLOCKED: Recursive delete on root/home/project directory. Too dangerous."
    return None


def check_command(tool_name, tool_input, cwd=""):
    """Check if the tool call matches any blocked patterns."""
    # Get the content to check based on tool type
    content = ""
    if tool_name == "Bash":
        content = tool_input.get("command", "")
    elif tool_name == "Write":
        content = tool_input.get("file_path", "")
    elif tool_name == "Edit":
        content = tool_input.get("file_path", "")

    if tool_name == "Bash" and content:
        for check in (lambda c: check_force_push(c, cwd), check_recursive_delete):
            message = check(content)
            if message:
                return message

    for rule in BLOCKED_PATTERNS:
        # Only check if rule applies to this tool (or no tool specified)
        if rule.get("tool") and rule["tool"] != tool_name:
            continue

        if re.search(rule["pattern"], content, re.IGNORECASE):
            return rule["message"]

    return None


def main():
    """Hook entry point."""
    try:
        hook_input = json.loads(sys.stdin.read())
    except Exception:
        sys.exit(0)  # unreadable payload: no decision, never break the session
    if not isinstance(hook_input, dict):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})
    if not isinstance(tool_input, dict):
        sys.exit(0)

    violation = check_command(tool_name, tool_input, hook_input.get("cwd", ""))

    if not violation:
        sys.exit(0)  # no decision; normal permission flow applies

    # Claude Code PreToolUse contract: hookSpecificOutput.permissionDecision.
    # BLOCKED rules deny outright; WARNING rules make the user confirm.
    decision = "deny" if violation.startswith("BLOCKED") else "ask"
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": violation,
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
