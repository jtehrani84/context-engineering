#!/bin/bash
# Sandbox install + upgrade test for setup.sh. Never touches your real ~/.claude: every run gets a scratch HOME.
#
#   bash scripts/test-setup-upgrade.sh                 # old kit = a876e77 (the May 2026 release), new = working tree
#   OLD_REF=<ref> bash scripts/test-setup-upgrade.sh   # old kit = any git ref
#
# What it proves:
#   1. a fresh install from the OLD kit works (the May release copied files only; its users wired hooks
#      by copying settings.json.example, which used a flat format Claude Code ignores, so the test does too)
#   2. after `git pull`, re-running the NEW setup.sh:
#        - upgrades a rule, skill, and hook you never edited
#        - keeps a rule, skill, and hook you edited (byte-for-byte), and a rule of your own
#        - keeps your auth key and other settings, and never duplicates a hook
#        - rewrites an old flat-format hook entry, migrates a matcher the kit used to ship,
#          and keeps a matcher you set yourself
#        - wires the voice hooks: the send hook (regex mcp__ matcher) and the file-write nudge, and the draft gate
#          on Stop with the guarded command, so a missing script can never block a reply
#        - writes settings.json back in its own layout, so every entry it didn't change keeps its bytes
#   3. a second run changes nothing; --dry-run writes nothing
#   4. --uninstall removes unedited kit files, keeps edited ones, and unwires only the hooks it removed;
#      with no terminal and no answer it removes nothing and says so (exit 1); --yes skips the prompt
#   5. --check makes no network call and reports whether the model endpoint is configured
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
TMP="$(mktemp -d /tmp/kit-upgrade-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1   [$2]"; fi; }

# ---- old kit (git ref) and new kit (working tree, including untracked new files) ----
if [[ -z "${OLD_REF:-}" ]]; then
    if git cat-file -e a876e77^{commit} 2>/dev/null; then OLD_REF="a876e77"
    elif git diff --quiet HEAD -- . && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then OLD_REF="HEAD~1"; else OLD_REF="HEAD"; fi
fi
mkdir -p "$TMP/old" "$TMP/new"
git archive "$OLD_REF" | tar -x -C "$TMP/old"
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do
    [[ -e "$f" ]] || continue
    mkdir -p "$TMP/new/$(dirname "$f")"; cp -p "$f" "$TMP/new/$f"
done
echo "old kit = $OLD_REF, new kit = working tree"

export HOME="$TMP/home"
mkdir -p "$HOME/.claude"
C="$HOME/.claude"
cat > "$C/settings.json" <<'EOF'
{
  "model": "test-model",
  "env": { "LLM_BASE_URL": "https://models.example.test/v1", "ANTHROPIC_AUTH_TOKEN": "sk-test-not-a-real-key" },
  "permissions": { "allow": ["Bash(ls *)"] }
}
EOF

echo; echo "== 1. fresh install from the old kit"
bash "$TMP/old/setup.sh" > "$TMP/old-install.log" 2>&1; OLD_RC=$?
check "old setup.sh exited 0 and installed files" '[[ $OLD_RC -eq 0 && -f "$C/rules/architecture.md" && -f "$C/commands/curate.md" && -x "$C/hooks/scripts/guardrail.py" ]]'
# The May release never touched settings.json; its README said to copy settings.json.example (JSON with
# // comments, flat hook entries). Do exactly that when the old setup left no hooks behind.
if ! grep -q 'hooks/scripts' "$C/settings.json"; then
    python3 - "$TMP/old/settings.json.example" "$C/settings.json" <<'PYEOF'
import json, sys
ex = json.loads("".join(l for l in open(sys.argv[1]) if not l.strip().startswith("//")))
s = json.load(open(sys.argv[2]))
s["hooks"] = ex["hooks"]
json.dump(s, open(sys.argv[2], "w"), indent=2)
PYEOF
fi
check "old install has 6 kit hooks wired (setup or the copied example)" '[[ $(grep -c "hooks/scripts/" "$C/settings.json") -ge 6 ]]'

echo; echo "== 2. simulate real-world state, then upgrade"
# unedited old copies stay as installed. Now edit some, and add your own files.
echo "my own extra rule line" >> "$C/rules/architecture.md"                 # edited rule  -> must be kept
echo "my own extra skill line" >> "$C/commands/design-doc.md"                # edited skill -> must be kept
echo "# my hook tweak" >> "$C/hooks/scripts/output-quality-gate.py"          # edited hook  -> must be kept
echo "# my own rule" > "$C/rules/my-own-rule.md"                             # not from the kit
cp "$C/rules/architecture.md" "$TMP/architecture.edited"
cp "$C/commands/design-doc.md" "$TMP/design-doc.edited"
cp "$C/hooks/scripts/output-quality-gate.py" "$TMP/output-quality-gate.edited"
cp "$C/rules/my-own-rule.md" "$TMP/my-own-rule.orig"
OLD_CURATE_HASH=$(shasum -a 256 "$C/commands/curate.md" | cut -d' ' -f1)
# settings: an old flat-format entry for schema-check (rewritten fresh so the test owns its shape), and a
# matcher you customized for domain-verification
python3 - <<'PYEOF'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p))
pre = s["hooks"]["PreToolUse"]
pre[:] = [e for e in pre if "schema-check" not in json.dumps(e) and "domain-verification" not in json.dumps(e)]
pre.append({"type": "command", "command": "python3 ~/.claude/hooks/scripts/schema-check.py", "matcher": {"tool_name": "Bash"}})
pre.append({"matcher": "Edit", "hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/scripts/domain-verification.py"}]})
s["hooks"]["Notification"] = [{"hooks": [{"type": "command", "command": "echo mine"}]}]
json.dump(s, open(p, "w"), indent=2)
PYEOF

bash "$TMP/new/setup.sh" > "$TMP/new-install.log" 2>&1; NEW_RC=$?
check "new setup.sh exited 0" '[[ $NEW_RC -eq 0 ]]'
check "unedited skill upgraded (curate.md now the new version)" 'cmp -s "$TMP/new/skills/curate.md" "$C/commands/curate.md" && [[ "$(shasum -a 256 "$C/commands/curate.md" | cut -d" " -f1)" != "$OLD_CURATE_HASH" ]]'
check "unedited rule upgraded (communication.md now the new version)" 'cmp -s "$TMP/new/rules/communication.md" "$C/rules/communication.md"'
check "new rule installed (proof-before-claim.md)" 'cmp -s "$TMP/new/rules/proof-before-claim.md" "$C/rules/proof-before-claim.md"'
check "new skill installed (claim-audit.md)" 'cmp -s "$TMP/new/skills/claim-audit.md" "$C/commands/claim-audit.md"'
check "unedited hook upgraded (guardrail.py is the new version)" 'cmp -s "$TMP/new/hooks/scripts/guardrail.py" "$C/hooks/scripts/guardrail.py"'
check "upgraded hook is still executable" '[[ -x "$C/hooks/scripts/guardrail.py" ]]'
check "edited rule kept byte-for-byte" 'cmp -s "$TMP/architecture.edited" "$C/rules/architecture.md"'
check "edited skill kept byte-for-byte" 'cmp -s "$TMP/design-doc.edited" "$C/commands/design-doc.md"'
check "edited hook kept byte-for-byte" 'cmp -s "$TMP/output-quality-gate.edited" "$C/hooks/scripts/output-quality-gate.py"'
check "your own rule untouched" 'cmp -s "$TMP/my-own-rule.orig" "$C/rules/my-own-rule.md"'
check "log says which edited files were kept" 'grep -q "kept yours" "$TMP/new-install.log"'
check "log says which files were upgraded" 'grep -q "upgraded (was an unedited earlier kit version)" "$TMP/new-install.log"'

if python3 - "$C/settings.json" <<'PYEOF'

import json, sys
s = json.load(open(sys.argv[1]))
fails = []
def need(cond, msg):
    if not cond: fails.append(msg)
need(s.get("model") == "test-model", "model preserved")
need(s["env"]["ANTHROPIC_AUTH_TOKEN"] == "sk-test-not-a-real-key", "auth key preserved")
need(s["permissions"]["allow"] == ["Bash(ls *)"], "permissions preserved")
need(s["hooks"].get("Notification") == [{"hooks": [{"type": "command", "command": "echo mine"}]}], "other hooks preserved")
allh = [(ev, e) for ev, es in s["hooks"].items() for e in es]
def entries(script): return [e for ev, e in allh if script in json.dumps(e)]
for script in ["session-init", "guardrail", "domain-verification", "/schema-check", "output-quality-gate", "deploy-proof-gate", "graph-auto-index"]:
    need(len(entries(script)) == 1, f"{script} wired exactly once (got {len(entries(script))})")
# voice-tell-gate runs on two events: once on file writes (PostToolUse) and once on the send tools (PreToolUse)
for ev, want in (("PostToolUse", "Write|Edit|MultiEdit"), ("PreToolUse", None)):
    vt = [e for e in s["hooks"].get(ev, []) if "voice-tell-gate" in json.dumps(e)]
    need(len(vt) == 1, f"voice-tell-gate wired exactly once in {ev} (got {len(vt)})")
    if vt and want: need(vt[0].get("matcher") == want, f"voice-tell-gate {ev} matcher migrated to {want!r} (got {vt[0].get('matcher')!r})")
    if vt and not want: need(str(vt[0].get("matcher", "")).startswith("^(?:mcp__"), f"voice-tell-gate {ev} has the send-tool matcher (got {vt[0].get('matcher')!r})")
# voice-draft-gate runs on Stop, once, with the guarded command (a missing script ends the reply with a note)
dg = [e for e in s["hooks"].get("Stop", []) if "voice-draft-gate" in json.dumps(e)]
need(len(dg) == 1, f"voice-draft-gate wired exactly once on Stop (got {len(dg)})")
if dg:
    cmd = dg[0]["hooks"][0]["command"]
    need(dg[0].get("matcher", "") == "" and cmd.startswith("[ -f ~/.claude/hooks/scripts/voice-draft-gate.py ] ||")
         and cmd.endswith("; python3 ~/.claude/hooks/scripts/voice-draft-gate.py"), f"voice-draft-gate Stop command is guarded (got {cmd!r})")
need(not any("voice-draft-gate" in json.dumps(e) for ev, e in allh if ev != "Stop"), "voice-draft-gate wired on no other event")
flat = [e for ev, e in allh if "hooks" not in e]
need(not flat, f"no flat entries left (got {len(flat)})")
sc = entries("/schema-check")[0]
need("hooks" in sc and "command" not in sc, "old flat schema-check entry rewritten to nested form")
need(sc.get("matcher") == "Bash", f"schema-check matcher is 'Bash' (got {sc.get('matcher')!r})")
gi = entries("graph-auto-index")[0]
need("hooks" in gi and gi.get("matcher") == "Write|Edit", f"flat graph-auto-index entry migrated, not dropped (got {gi!r})")
pv = entries("domain-verification")[0]
need(pv.get("matcher") == "Edit", f"user-customized matcher kept (got {pv.get('matcher')!r})")
for f in fails: print("        settings.json:", f)
sys.exit(1 if fails else 0)
PYEOF
then ok "settings.json: auth/model/permissions/other hooks kept, no duplicates, flat entry rewritten, custom matcher kept"
else bad "settings.json assertions (details above)"; fi
check "settings backup written once" '[[ -f "$C/settings.json.pre-kit-backup" ]]'
check "the draft gate script is installed next to the send hook" '[[ -x "$C/hooks/scripts/voice-draft-gate.py" ]] && cmp -s "$TMP/new/hooks/scripts/voice-draft-gate.py" "$C/hooks/scripts/voice-draft-gate.py"'
# The installed Stop command, run the way Claude Code runs it (/bin/sh, Stop JSON on stdin): with the script in place it
# runs the gate (a reply with no draft: nothing printed, exit 0); with the script gone it ends the reply with a note.
STOP_CMD="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print([h["command"] for e in s["hooks"]["Stop"] for h in e["hooks"] if "voice-draft-gate" in h["command"]][0])' "$C/settings.json")"
STOP_IN='{"hook_event_name":"Stop","session_id":"t","transcript_path":"/nonexistent.jsonl","stop_hook_active":false,"last_assistant_message":"Done."}'
OUT_OK="$(printf '%s' "$STOP_IN" | /bin/sh -c "$STOP_CMD")"; RC_OK=$?
check "installed Stop command runs the gate: a reply with no draft passes (exit 0, no block)" '[[ $RC_OK -eq 0 ]] && ! grep -q "\"block\"" <<<"$OUT_OK"'
mv "$C/hooks/scripts/voice-draft-gate.py" "$TMP/dg.py"
OUT_MISS="$(printf '%s' "$STOP_IN" | /bin/sh -c "$STOP_CMD")"; RC_MISS=$?
mv "$TMP/dg.py" "$C/hooks/scripts/voice-draft-gate.py"
check "installed Stop command with the script missing: exit 0 and a draft-not-checked note (guarded)" '[[ $RC_MISS -eq 0 ]] && grep -q "draft not checked" <<<"$OUT_MISS"'

echo; echo "== 3. idempotent re-run, dry run"
H1=$(find "$C" -type f -not -name '*.pyc' -exec shasum -a 256 {} + | sort | shasum -a 256)
bash "$TMP/new/setup.sh" > "$TMP/rerun.log" 2>&1
H2=$(find "$C" -type f -not -name '*.pyc' -exec shasum -a 256 {} + | sort | shasum -a 256)
check "second run changes nothing" '[[ "$H1" == "$H2" ]]'
check "second run says hooks already wired" 'grep -q "already wired" "$TMP/rerun.log"'
bash "$TMP/new/setup.sh" --dry-run > "$TMP/dry.log" 2>&1
H3=$(find "$C" -type f -not -name '*.pyc' -exec shasum -a 256 {} + | sort | shasum -a 256)
check "--dry-run writes nothing" '[[ "$H2" == "$H3" ]]'

echo; echo "== 3b. dry run against a stale install reports, writes nothing"
git -C "$REPO" show "$OLD_REF:skills/curate.md" > "$C/commands/curate.md" 2>/dev/null
H4=$(find "$C" -type f -not -name '*.pyc' -exec shasum -a 256 {} + | sort | shasum -a 256)
bash "$TMP/new/setup.sh" --dry-run > "$TMP/dry2.log" 2>&1
H5=$(find "$C" -type f -not -name '*.pyc' -exec shasum -a 256 {} + | sort | shasum -a 256)
check "dry run over a stale skill: reports the upgrade" 'grep -q "curate.md upgraded" "$TMP/dry2.log"'
check "dry run over a stale skill: still writes nothing" '[[ "$H4" == "$H5" ]]'

echo; echo "== 4. matcher migration (what a future kit release does)"
if python3 - "$TMP/new/scripts" <<'PYEOF'

import importlib.util, sys, copy, json
spec = importlib.util.spec_from_file_location("wire_hooks", sys.argv[1] + "/wire-hooks.py")
wh = importlib.util.module_from_spec(spec); spec.loader.exec_module(wh)
fails = []
def need(cond, msg):
    if not cond: fails.append(msg)
# pretend a later release changed voice-tell-gate's matcher from 'Write' to 'Write|Edit|MultiEdit'
wh.HOOKS = [h for h in wh.HOOKS if h[2] != "voice-tell-gate.py"] + [("PostToolUse", "Write|Edit|MultiEdit", "voice-tell-gate.py", ["Write"])]
mk = lambda m: {"hooks": {"PostToolUse": [{"matcher": m, "hooks": [{"type": "command", "command": wh.CMD_PREFIX + "voice-tell-gate.py"}]}]}}
s = mk("Write"); added, migrated, kept = wh.wire(s)
need(s["hooks"]["PostToolUse"][0]["matcher"] == "Write|Edit|MultiEdit" and migrated, "shipped matcher 'Write' migrated to the new one")
s = mk("Write|Bash"); added, migrated, kept = wh.wire(s)
need(s["hooks"]["PostToolUse"][0]["matcher"] == "Write|Bash" and kept and not migrated, "user matcher kept and reported")
wh.HOOKS = [h for h in wh.HOOKS if h[2] == "voice-tell-gate.py"]
s = mk("Write|Edit|MultiEdit"); added, migrated, kept = wh.wire(s)
need(not added and not migrated and not kept, "already-current matcher: no change")
# an entry that also runs someone else's hook is never retargeted
s = {"hooks": {"PostToolUse": [{"matcher": "Write", "hooks": [{"type": "command", "command": wh.CMD_PREFIX + "voice-tell-gate.py"}, {"type": "command", "command": "echo other"}]}]}}
added, migrated, kept = wh.wire(s)
need(s["hooks"]["PostToolUse"][0]["matcher"] == "Write" and kept, "shared entry left alone")
for f in fails: print("        migration:", f)
sys.exit(1 if fails else 0)
PYEOF
then ok "matcher migration: shipped matcher moves, your matcher stays, shared entries untouched"
else bad "matcher migration (details above)"; fi

if python3 - "$TMP/new/scripts" <<'PYEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("wire_hooks", sys.argv[1] + "/wire-hooks.py")
wh = importlib.util.module_from_spec(spec); spec.loader.exec_module(wh)
fails = []
def need(cond, msg):
    if not cond: fails.append(msg)
event, matcher = [(h[0], h[1]) for h in wh.HOOKS if h[2] == "guardrail.py"][0]
# a hook of your own whose file name merely CONTAINS the kit's must not stop the kit hook being wired
for own in ("architecture-guardrail.py", "deploy-guardrail.py"):
    s = {"hooks": {event: [{"matcher": matcher, "hooks": [{"type": "command", "command": "python3 ~/.claude/hooks/scripts/" + own}]}]}}
    added, migrated, kept = wh.wire(s)
    cmds = [h["command"] for e in s["hooks"][event] for h in e["hooks"]]
    need("guardrail.py" in added and cmds.count(wh.CMD_PREFIX + "guardrail.py") == 1, f"kit guardrail.py wired next to your {own}")
    need(any(c.endswith(own) for c in cmds), f"your {own} kept")
# a kit hook that is already wired is still recognized (no duplicate), however the command spells its path
for cmd in (wh.CMD_PREFIX + "guardrail.py", 'python3 "$HOME/.claude/hooks/scripts/guardrail.py"', wh.CMD_PREFIX + "guardrail.py || true"):
    s = {"hooks": {event: [{"matcher": matcher, "hooks": [{"type": "command", "command": cmd}]}]}}
    added, migrated, kept = wh.wire(s)
    need("guardrail.py" not in added, f"already-wired guardrail recognized: {cmd}")
for f in fails: print("        name match:", f)
sys.exit(1 if fails else 0)
PYEOF
then ok "a hook of yours named like a kit hook (architecture-guardrail.py) doesn't stop the kit hook being wired"
else bad "hook name matching (details above)"; fi

if python3 - "$TMP/new/scripts" "$TMP/layout" <<'PYEOF'
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("wire_hooks", sys.argv[1] + "/wire-hooks.py")
wh = importlib.util.module_from_spec(spec); spec.loader.exec_module(wh)
fails = []
def need(cond, msg):
    if not cond: fails.append(msg)
# settings.json the way Claude Code writes it (2-space indent, <, > and & as \u escapes, no final newline) and the way
# an editor writes it (4 spaces, final newline). Wiring adds the kit hooks and leaves every other byte alone.
mine = {"model": "m", "permissions": {"allow": ["Bash(echo a > b && echo c)"]}, "env": {"NOTE": "caf\u00e9 \u2014 <tag>"},
        "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo 'mine' > /dev/null && true"}]}],
                  "Stop": [{"hooks": [{"type": "command", "command": "echo my-stop"}]}]}}
for label, style in (("Claude Code layout", {"indent": 2, "ascii": False, "go": True, "newline": ""}),
                     ("4-space layout", {"indent": 4, "ascii": False, "go": False, "newline": "\n"})):
    d = os.path.join(sys.argv[2], label.replace(" ", "-"))
    os.makedirs(os.path.join(d, "hooks", "scripts"), exist_ok=True)
    open(os.path.join(d, "hooks", "scripts", wh.DRAFT_GATE), "w").close()
    p = os.path.join(d, "settings.json")
    original = wh.dump_json(mine, style)
    open(p, "w").write(original)
    rc = wh.main(["wire-hooks.py", p])
    after = open(p).read()
    s = json.loads(after)
    need(rc == 0 and wh.json_style(after, s) == style, f"{label}: written back in the same layout")
    for ev, es in mine["hooks"].items():
        for e in es:
            need(wh.dump_json(e, style).strip() in after or json.dumps(e) in json.dumps(s["hooks"][ev]), f"{label}: your {ev} entry kept")
    need(s["permissions"] == mine["permissions"] and s["env"] == mine["env"], f"{label}: other settings kept")
    stop = [e for e in s["hooks"]["Stop"] if wh.DRAFT_GATE in json.dumps(e)]
    need(s["hooks"]["Stop"][0] == mine["hooks"]["Stop"][0] and len(stop) == 1, f"{label}: your Stop hook kept, draft gate added once")
    # every original entry is still in the file byte for byte (as the file's own layout prints it)
    for ev, es in mine["hooks"].items():
        for e in es:
            ind = style["indent"] if isinstance(style["indent"], str) else " " * style["indent"]
            block = "\n".join(ind * 3 + ln for ln in wh.dump_json(e, {**style, "newline": ""}).splitlines())
            need(block in after, f"{label}: your {ev} entry is byte-identical")
    before = after
    rc = wh.main(["wire-hooks.py", p])
    need(open(p).read() == before, f"{label}: a second run writes nothing")
for f in fails: print("        layout:", f)
sys.exit(1 if fails else 0)
PYEOF
then ok "wiring keeps settings.json's own layout (Claude Code's escapes, 4-space files) and your entries' bytes"
else bad "settings.json layout (details above)"; fi

echo; echo "== 5. --check is offline and reports the model endpoint"
check "setup.sh hard-codes no URL at all" '! grep -Eq "https?://[A-Za-z0-9]" "$TMP/new/setup.sh"'
check "README has no copy-paste installer URL piped into bash" '! grep -Eq "curl[^|]*https?://[^ ]+[^|]*\| *bash" "$TMP/new/README.md"'
env -u LLM_BASE_URL -u LLM_API_KEY bash "$TMP/new/setup.sh" --check > "$TMP/check-noep.log" 2>&1
check "--check with no endpoint: says it is not configured" 'grep -q "Model endpoint not configured" "$TMP/check-noep.log"'
LLM_BASE_URL="http://127.0.0.1:9/v1" LLM_API_KEY="x" bash "$TMP/new/setup.sh" --check > "$TMP/check-ep.log" 2>&1
check "--check with an endpoint set: reports it configured, without calling it" 'grep -q "Model endpoint configured" "$TMP/check-ep.log"'

echo; echo "== 5b. a machine with no settings.json at all gets a minimal one, wired"
env HOME="$TMP/fresh" bash -c 'mkdir -p "$HOME"; bash "$0/setup.sh" < /dev/null' "$TMP/new" > "$TMP/fresh.log" 2>&1
check "fresh setup with no settings.json exits 0 and creates one with hooks" '[[ -f "$TMP/fresh/.claude/settings.json" ]] && grep -q "guardrail.py" "$TMP/fresh/.claude/settings.json"'

echo; echo "== 5c. a non-interactive uninstall says why it stopped, and --yes runs it without a prompt"
NB=$(find "$TMP/fresh/.claude" -type f | wc -l)
env HOME="$TMP/fresh" bash "$TMP/new/setup.sh" --uninstall < /dev/null > "$TMP/uninstall-noinput.log" 2>&1; NOIN_RC=$?
NA=$(find "$TMP/fresh/.claude" -type f | wc -l)
check "--uninstall with no terminal and no answer removes nothing" '[[ $NB -eq $NA && -f "$TMP/fresh/.claude/hooks/scripts/guardrail.py" ]]'
check "--uninstall with no answer exits 1 and says Cancelled, pointing at --yes" '[[ $NOIN_RC -eq 1 ]] && grep -q "Cancelled" "$TMP/uninstall-noinput.log" && grep -q -- "--yes" "$TMP/uninstall-noinput.log"'
env HOME="$TMP/fresh" bash "$TMP/new/setup.sh" --uninstall --yes < /dev/null > "$TMP/uninstall-yes.log" 2>&1; YES_RC=$?
check "--uninstall --yes with no terminal exits 0, removes kit files and unwires their hooks" '[[ $YES_RC -eq 0 && ! -f "$TMP/fresh/.claude/hooks/scripts/guardrail.py" ]] && ! grep -q "scripts/guardrail.py" "$TMP/fresh/.claude/settings.json"'

echo; echo "== 6. uninstall keeps what you edited"
printf 'y\n' | bash "$TMP/new/setup.sh" --uninstall > "$TMP/uninstall.log" 2>&1
check "edited rule survives uninstall" '[[ -f "$C/rules/architecture.md" ]] && cmp -s "$TMP/architecture.edited" "$C/rules/architecture.md"'
check "edited skill survives uninstall" '[[ -f "$C/commands/design-doc.md" ]]'
check "your own rule survives uninstall" '[[ -f "$C/rules/my-own-rule.md" ]]'
check "an unedited kit rule is removed" '[[ ! -f "$C/rules/proof-before-claim.md" ]]'
check "an unedited kit skill is removed" '[[ ! -f "$C/commands/morning-brief.md" ]]'
check "an unedited kit hook is removed and unwired" '[[ ! -f "$C/hooks/scripts/guardrail.py" ]] && ! grep -q "scripts/guardrail.py" "$C/settings.json"'
check "the hook you edited is kept and still wired" '[[ -f "$C/hooks/scripts/output-quality-gate.py" ]] && grep -q "scripts/output-quality-gate.py" "$C/settings.json"'
check "settings.json backed up before unwiring" '[[ -f "$C/settings.json.pre-uninstall-backup" ]]'
check "the voice hooks are removed and unwired (send hook, file-write nudge, draft gate on Stop)" '[[ ! -f "$C/hooks/scripts/voice-tell-gate.py" && ! -f "$C/hooks/scripts/voice-draft-gate.py" ]] && ! grep -q "voice-tell-gate.py\|voice-draft-gate.py" "$C/settings.json"'
if python3 - "$C" <<'PYEOF'
import json, os, re, sys
c = sys.argv[1]
s = json.load(open(os.path.join(c, "settings.json")))
bad = []
for entries in s.get("hooks", {}).values():
    for e in entries:
        for h in e.get("hooks", []) + ([e] if "command" in e else []):
            m = re.search(r"\.claude/hooks/scripts/([\w.-]+\.py)", h.get("command", ""))
            if m and not os.path.exists(os.path.join(c, "hooks", "scripts", m.group(1))):
                bad.append(m.group(1))
mine = s.get("hooks", {}).get("Notification") == [{"hooks": [{"type": "command", "command": "echo mine"}]}]
for b in bad:
    print("        dangling hook entry (python3 exits 2, Claude Code blocks the tool):", b)
if not mine:
    print("        your own Notification hook was not kept")
sys.exit(1 if bad or not mine else 0)
PYEOF
then ok "uninstall leaves no hook entry pointing at a removed file, and keeps your own hook"
else bad "uninstall hook unwiring (details above)"; fi

echo; echo "== $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
