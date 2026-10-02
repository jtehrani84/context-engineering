#!/usr/bin/env python3
"""
Wire the kit's hooks into ~/.claude/settings.json. Merge-safe, idempotent, safe to re-run on upgrade.

    python3 scripts/wire-hooks.py <settings.json> [--dry-run]
    python3 scripts/wire-hooks.py <settings.json> --unwire-missing   # used by --uninstall

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
import re
import shutil
import sys

CMD_PREFIX = "python3 ~/.claude/hooks/scripts/"

# voice-tell-gate runs on two events. PostToolUse on file writes nudges; PreToolUse on the send tools blocks a send
# with a hard tell (and any send it can't check). VOICE_SEND_TOOLS is the default sendTools list of the voice config
# (tools/onboarding/lib/config.mjs), and VOICE_SEND_MATCHER is the matcher `voice-doctor --print-hooks` prints for it:
# a regular expression, because Claude Code reads a matcher of only letters, digits, _ and | as exact tool names, and
# the MCP tools are named mcp__<server>__<tool>. scripts/test-voice-kit.py fails when the two drift apart. If you add
# send tools in ~/.claude/voice/voice-config.json, run tools/onboarding/merge-hooks.mjs to rewrite this entry; a
# matcher you changed is kept on the next ./setup.sh run.
VOICE_SEND_TOOLS = (
    "slack_send_message", "slack_send_message_draft", "slack_schedule_message", "slack_create_canvas",
    "slack_update_canvas", "send_gmail_message", "draft_gmail_message", "create_doc", "import_to_google_doc",
    "batch_update_doc", "insert_doc_elements", "modify_doc_text", "find_and_replace_doc",
    "update_doc_headers_footers", "create_presentation", "import_to_google_slides",
    "batch_update_presentation", "create_form", "batch_update_form", "manage_document_comment",
    "manage_presentation_comment", "manage_spreadsheet_comment", "create_pull_request", "create_issue",
    "add_issue_comment", "create_pull_request_review", "update_pull_request", "update_issue",
    "add_comment_to_pending_review", "add_reply_to_pull_request_comment", "pull_request_review_write",
)
VOICE_SEND_MATCHER = "^(?:mcp__.+__(?:" + "|".join(VOICE_SEND_TOOLS) + "))$"

# (event, matcher, script, prior_matchers)
# prior_matchers = matchers an earlier kit release wired for this script and that are safe to replace.
HOOKS = [
    ("SessionStart", "", "session-init.py", []),
    ("PreToolUse", "Bash", "guardrail.py", []),
    ("PreToolUse", "Edit|Write", "domain-verification.py", []),
    ("PreToolUse", "Bash", "schema-check.py", []),
    ("PostToolUse", "Write", "output-quality-gate.py", []),
    ("PostToolUse", "Write|Edit|MultiEdit", "voice-tell-gate.py", ["Write"]),
    ("PreToolUse", VOICE_SEND_MATCHER, "voice-tell-gate.py", []),
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


def _runs(command, script):
    """True when the command runs this exact script. It compares file names, not substrings, so a hook
    of your own whose name only contains the kit's (architecture-guardrail.py, deploy-guardrail.py,
    my-schema-check.py) is never mistaken for the kit hook, which would leave the kit hook unwired."""
    return re.search(r"(?:^|[\s/\\'\"=])" + re.escape(script) + r"(?=$|[\s'\";|&)<>])", command) is not None


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
               if isinstance(e, dict) and any(_runs(c, script) for c in _commands(e))]
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


def kit_hook_names():
    """File names of every hook this kit ships: wired by default, opt-in, or never wired for you."""
    kit = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    names = {row[2] for row in HOOKS + OPTIONAL_PROOF_GATES + MIGRATE_ONLY}
    for sub in ("hooks/scripts", "hooks/scripts-optional"):
        d = os.path.join(kit, sub)
        if os.path.isdir(d):
            names.update(f for f in os.listdir(d) if f.endswith(".py"))
    return names


def unwire_missing(settings, claude_dir, names=None):
    """For --uninstall: drop each hook command that runs one of the kit's hooks from
    <claude_dir>/hooks/scripts/ when that file no longer exists. python3 exits 2 on a missing script, and
    Claude Code reads exit 2 from a PreToolUse hook as "block this tool call", so an entry left behind
    would block every Bash, Edit and Write. A kit hook you edited (uninstall keeps the file) stays wired,
    and so does every hook of your own. Returns the names it unwired."""
    names = kit_hook_names() if names is None else names
    hooks_dir = os.path.join(claude_dir, "hooks", "scripts")

    def dangling(command):
        for name in names:
            if re.search(r"\.claude[/\\]hooks[/\\]scripts[/\\]" + re.escape(name) + r"(?=$|[\s'\";|&)<>])", command) \
                    and not os.path.exists(os.path.join(hooks_dir, name)):
                return name
        return None

    removed = []
    hooks = settings.get("hooks", {})
    for event in list(hooks):
        entries = hooks[event]
        if not isinstance(entries, list):
            continue
        keep = []
        for e in entries:
            if isinstance(e, dict) and "hooks" not in e and isinstance(e.get("command"), str):
                name = dangling(e["command"])          # old flat entry
                if name:
                    removed.append(name)
                    continue
            elif isinstance(e, dict) and isinstance(e.get("hooks"), list) and e["hooks"]:
                left = []
                for h in e["hooks"]:
                    name = dangling(h["command"]) if isinstance(h, dict) and isinstance(h.get("command"), str) else None
                    if name:
                        removed.append(name)
                    else:
                        left.append(h)
                if not left:
                    continue
                e["hooks"] = left
            keep.append(e)
        if entries and not keep:
            del hooks[event]
        else:
            hooks[event] = keep
    return removed


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in argv
    if len(args) != 1:
        print(__doc__)
        return 2
    path = args[0]
    if "--unwire-missing" in argv:
        try:
            settings = load_settings(path)
        except Exception:
            print("  Could not parse settings.json, so no hook entries were removed. Take out any hook entry", file=sys.stderr)
            print("  that runs a script under ~/.claude/hooks/scripts/ that no longer exists.", file=sys.stderr)
            return 0
        if not isinstance(settings, dict) or not isinstance(settings.get("hooks", {}), dict):
            return 0
        removed = unwire_missing(settings, os.path.dirname(os.path.abspath(path)))
        if not removed:
            print("  settings.json: no hook entry points at a removed kit hook.")
            return 0
        if dry:
            print("  [dry-run] Would unwire: " + ", ".join(removed))
            return 0
        backup = path + ".pre-uninstall-backup"
        shutil.copy2(path, backup)
        with open(path, "w") as f:
            json.dump(settings, f, indent=2)
        print("  Unwired from settings.json (their files were removed): " + ", ".join(removed))
        print(f"  Backed up your settings to {backup}")
        return 0
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
