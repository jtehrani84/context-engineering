#!/usr/bin/env python3
"""
Wire the kit's hooks into ~/.claude/settings.json. Merge-safe, idempotent, safe to re-run on upgrade.

    python3 scripts/wire-hooks.py <settings.json> [--dry-run]

What it does for each hook in HOOKS below (plus OPTIONAL_PROOF_GATES when KIT_WIRE_PROOF_GATES=1):
  - not wired yet            -> adds it (nested {matcher, hooks:[...]} form, which is what Claude Code reads)
  - wired in the old flat
    form (the flat shape the
    May 2026 settings example
    showed)                  -> rewrites that entry into the nested form
  - wired, matcher is one
    this kit shipped earlier -> moves it to the current matcher (you never changed it)
  - wired, any other matcher -> left alone; it's yours

To change a hook's matcher in a later kit release: edit its row in HOOKS and put the OLD matcher in
that row's `prior` list. Existing installs pick the change up on the next ./setup.sh run; anyone who set
their own matcher keeps it.

MIGRATE_ONLY hooks are never added. If you already wired one in the old flat form, its entry is rewritten
into the nested form so Claude Code actually runs it, and nothing else changes.

Nothing else in settings.json is touched (your auth key, model, permissions and any other hooks stay
as they are). The file is backed up once to settings.json.pre-kit-backup before the first change.
"""
import json
import os
import shutil
import sys

CMD_PREFIX = "python3 ~/.claude/hooks/scripts/"

# (event, matcher, script, prior_matchers)
# prior_matchers = matchers an earlier kit release wired for this script and that are safe to replace.
HOOKS = [
    ("SessionStart", "", "session-init.py", []),
    ("PreToolUse", "Bash", "guardrail.py", []),
    ("PreToolUse", "Edit|Write", "domain-verification.py", []),
    ("PreToolUse", "Bash", "schema-check.py", []),
    ("PostToolUse", "Write", "output-quality-gate.py", []),
    ("PostToolUse", "Write", "voice-tell-gate.py", []),
    # Proof family. deploy-proof-gate only speaks after a deploy or publish command, so it is on by default.
    ("PostToolUse", "Bash", "deploy-proof-gate.py", []),
]

# Installed but not wired by default. Only an existing (old flat-form) entry is migrated.
MIGRATE_ONLY = [
    ("PostToolUse", "Write|Edit", "graph-auto-index.py", []),
]

# The two prose proof gates run on every doc you write and are keyword heuristics, so they are opt-in:
#   KIT_WIRE_PROOF_GATES=1 ./setup.sh
# Leaving the variable unset never unwires them once you have turned them on.
OPTIONAL_PROOF_GATES = [
    ("PostToolUse", "Write|Edit|MultiEdit", "claim-faithfulness-gate.py", []),
    ("PostToolUse", "Write|Edit|MultiEdit", "refutation-oracle-gate.py", []),
]


def proof_gates_requested(env=None):
    env = os.environ if env is None else env
    return env.get("KIT_WIRE_PROOF_GATES", "").strip().lower() in ("1", "true", "yes", "all")


def active_hooks(env=None):
    return HOOKS + (OPTIONAL_PROOF_GATES if proof_gates_requested(env) else [])


def load_settings(path):
    """Read settings.json, tolerating whole-line // comments (the REFERENCE file uses them)."""
    with open(path) as f:
        lines = f.readlines()
    return json.loads("".join(l for l in lines if not l.strip().startswith("//")))


def _commands(entry):
    """Every command string in an entry, nested or legacy flat."""
    cmds = []
    if isinstance(entry.get("command"), str):
        cmds.append(entry["command"])
    for h in entry.get("hooks", []) or []:
        if isinstance(h, dict) and isinstance(h.get("command"), str):
            cmds.append(h["command"])
    return cmds


def _matcher_text(matcher):
    """Legacy entries stored a matcher as {'tool_name': 'Bash'} or {'tool_name': ['Edit','Write']}."""
    if isinstance(matcher, dict):
        name = matcher.get("tool_name", "")
        return "|".join(name) if isinstance(name, list) else str(name)
    return matcher if isinstance(matcher, str) else ""


def _nested(matcher, command):
    entry = {"hooks": [{"type": "command", "command": command}]}
    if matcher:
        entry["matcher"] = matcher
    return entry


def wire(settings):
    """Apply HOOKS to the settings dict in place. Returns (added, migrated, kept) lists of strings."""
    hooks = settings.setdefault("hooks", {})
    added, migrated, kept = [], [], []
    rows = [(r, True) for r in active_hooks()] + [(r, False) for r in MIGRATE_ONLY]
    for (event, matcher, script, prior), may_add in rows:
        command = CMD_PREFIX + script
        entries = hooks.get(event, []) if not may_add else hooks.setdefault(event, [])
        if not isinstance(entries, list):
            continue
        idx = [i for i, e in enumerate(entries)
               if isinstance(e, dict) and any(script in c for c in _commands(e))]
        if not idx:
            if not may_add:
                continue
            entries.append(_nested(matcher, command))
            added.append(script)
            continue
        for i in idx:
            e = entries[i]
            if "hooks" not in e and "command" in e:
                # legacy flat entry: {'type','command','matcher'?}. Claude Code reads the nested form.
                old = _matcher_text(e.get("matcher"))
                entries[i] = _nested(matcher if old in [matcher] + prior else old, e["command"])
                migrated.append(f"{script}: old flat entry rewritten to the nested form")
                continue
            current = _matcher_text(e.get("matcher"))
            if current == matcher:
                continue
            if current in prior and len(e.get("hooks", [])) == 1:
                if matcher:
                    e["matcher"] = matcher
                else:
                    e.pop("matcher", None)
                migrated.append(f"{script}: matcher '{current}' -> '{matcher}'")
            else:
                kept.append(f"{script}: kept your matcher '{current}' (kit now uses '{matcher}')")
    return added, migrated, kept


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in argv
    if len(args) != 1:
        print(__doc__)
        return 2
    path = args[0]
    try:
        settings = load_settings(path)
    except Exception:
        print("  Could not parse settings.json, so hook wiring was skipped.", file=sys.stderr)
        print("  Wire hooks manually using settings.json.example.", file=sys.stderr)
        return 0
    if not isinstance(settings, dict) or not isinstance(settings.get("hooks", {}), dict):
        print("  settings.json has an unexpected 'hooks' shape, so wiring was skipped.", file=sys.stderr)
        return 0

    added, migrated, kept = wire(settings)
    for line in kept:
        print(f"  note: {line}")
    if not (added or migrated):
        print("  All kit hooks were already wired, nothing to change.")
        return 0

    if dry:
        if added:
            print("  [dry-run] Would wire: " + ", ".join(added))
        for m in migrated:
            print(f"  [dry-run] Would migrate {m}")
        return 0

    backup = path + ".pre-kit-backup"
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
        print(f"  Backed up your settings to {backup}")
    with open(path, "w") as f:
        json.dump(settings, f, indent=2)
    if added:
        print("  Wired: " + ", ".join(added))
    for m in migrated:
        print(f"  Migrated {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
