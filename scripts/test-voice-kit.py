#!/usr/bin/env python3
"""
Consistency checks for the voice system as the kit ships it. Offline; runs voice-doctor with a scratch HOME.

  1. hooks/scripts/voice-tell-gate.py and hooks/scripts/voice-draft-gate.py (what setup.sh installs) are
     byte-identical to tools/hook/ (the source the docs and tools/hook-tests/ name).
  2. scripts/wire-hooks.py wires the voice hooks exactly as `voice-doctor --print-hooks` prints them for the default
     config (event, matcher and command): voice-tell-gate on PreToolUse with the send matcher (VOICE_SEND_MATCHER, a
     regular expression over mcp__<server>__<tool>; a bare name list would match no MCP tool) and on PostToolUse
     for file writes, and voice-draft-gate on Stop with the guarded command merge-hooks.mjs writes.
  2b. The send matcher reaches every send tool under any MCP server and no read tool, and the Stop command, run
     through /bin/sh with its script missing, exits 0 with a note (an unguarded python3 would exit 2, which blocks
     every reply on Stop). wire-hooks adds the Stop entry only when the script is installed.
  3. Every tool in VOICE_SEND_TOOLS is in the hook's SEND_SUFFIXES, so a wired send is also one the hook checks.
  4. settings.json.example shows the same voice matchers and the guarded Stop command.
  5. tools/voice-overlay.mjs is the blank template: REVIEWED false and every list empty, so no one's personal
     overlay ships in the kit.
  6. The retired voice files (setup.sh RETIRED) are gone from tools/, and setup.sh still lists them.
Exit 0 = every check passed.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(REPO, "tools")
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + ("" if ok else f": {detail}"))


def read(rel):
    with open(os.path.join(REPO, rel), "rb") as fh:
        return fh.read()


spec = importlib.util.spec_from_file_location("wire_hooks", os.path.join(REPO, "scripts", "wire-hooks.py"))
wh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wh)

# 1
for name in ("voice-tell-gate.py", "voice-draft-gate.py"):
    check(f"installed copy of {name} == tools/hook source", read(f"hooks/scripts/{name}") == read(f"tools/hook/{name}"))

# 2
with tempfile.TemporaryDirectory() as home:
    p = subprocess.run(["node", os.path.join(T, "onboarding", "voice-doctor.mjs"), "--print-hooks"],
                       capture_output=True, text=True, timeout=60, env={**os.environ, "HOME": home, "CLAUDE_CONFIG_DIR": os.path.join(home, ".claude")})
try:
    printed = json.loads(p.stdout)["hooks"]
except Exception as e:  # noqa: BLE001
    printed = {}
    check("voice-doctor --print-hooks prints JSON", False, f"{e}; stderr {p.stderr[-200:]!r}")
VOICE = ("voice-tell-gate.py", "voice-draft-gate.py")
want = {(ev, entry.get("matcher") or "", h.get("command", "")) for ev, entries in printed.items() for entry in entries
        for h in entry.get("hooks", []) if any(n in h.get("command", "") for n in VOICE)}
wired = {(ev, m, wh.command_for(script)) for ev, m, script, _prior in wh.HOOKS if script in VOICE}
check("wire-hooks voice rows == voice-doctor --print-hooks (event, matcher, command)", len(want) == 3 and wired == want,
      f"wire-hooks {sorted(wired)} vs doctor {sorted(want)}")
check("VOICE_SEND_MATCHER is the PreToolUse row", any(ev == "PreToolUse" and m == wh.VOICE_SEND_MATCHER for ev, m, _ in want))
check("voice-draft-gate is the Stop row", any(ev == "Stop" and "voice-draft-gate.py" in c for ev, _, c in want))

# 2b
send_re = re.compile(wh.VOICE_SEND_MATCHER)
check("the send matcher is a regular expression, not a bare name list", not re.fullmatch(r"[A-Za-z0-9_|]+", wh.VOICE_SEND_MATCHER))
reach = [t for t in wh.VOICE_SEND_TOOLS if not (send_re.search(f"mcp__github__{t}") and send_re.search(f"mcp__plugin_x_y__{t}"))]
check("the send matcher reaches every send tool under any MCP server", not reach, f"misses {reach}")
reads = [t for t in ("mcp__slack__slack_read_channel", "mcp__github__get_issue", "Write", "Bash", "slack_send_message")
         if send_re.search(t)]
check("the send matcher reaches no read tool, built-in tool or bare name", not reads, f"matches {reads}")
probe = wh.DRAFT_GATE_COMMAND.replace(wh.DRAFT_GATE, "missing-" + wh.DRAFT_GATE)
with tempfile.TemporaryDirectory() as home:
    r = subprocess.run(["/bin/sh", "-c", probe], input='{"hook_event_name": "Stop"}', capture_output=True, text=True,
                       timeout=30, env={**os.environ, "HOME": home})
check("the Stop command with its script missing exits 0 with a note (never 2)",
      r.returncode == 0 and "draft not checked" in r.stdout and '"block"' not in r.stdout, f"exit {r.returncode}, {r.stdout[:120]!r}")
bare = subprocess.run(["/bin/sh", "-c", "python3 ~/.claude/hooks/scripts/missing-" + wh.DRAFT_GATE], capture_output=True,
                      text=True, timeout=30)
check("(control: an unguarded python3 on a missing script exits 2)", bare.returncode == 2, f"exit {bare.returncode}")
with tempfile.TemporaryDirectory() as claude:
    s0 = {}
    wh.wire(s0, claude)
    check("wire-hooks adds no Stop entry when the draft gate script isn't installed",
          not any(wh.DRAFT_GATE in json.dumps(e) for e in s0.get("hooks", {}).get("Stop", [])))
    os.makedirs(os.path.join(claude, "hooks", "scripts"))
    open(os.path.join(claude, "hooks", "scripts", wh.DRAFT_GATE), "w").close()
    s1 = {"hooks": {"Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "python3 " + wh.DRAFT_GATE_PATH}]}]}}
    wh.wire(s1, claude)
    stop = [e for e in s1["hooks"]["Stop"] if wh.DRAFT_GATE in json.dumps(e)]
    check("an unguarded draft-gate Stop entry from earlier docs is moved to the guarded command",
          len(stop) == 1 and stop[0]["hooks"][0]["command"] == wh.DRAFT_GATE_COMMAND, json.dumps(stop)[:200])

# 3
hook = read("tools/hook/voice-tell-gate.py").decode()
m = re.search(r"^SEND_SUFFIXES = \((.*?)^\)", hook, re.S | re.M)
suffixes = set(re.findall(r'"([a-z0-9_]+)"', m.group(1))) if m else set()
missing = [t for t in wh.VOICE_SEND_TOOLS if t not in suffixes]
check("every wired send tool is in the hook's SEND_SUFFIXES", bool(suffixes) and not missing, f"missing {missing}")

# 4
example = read("settings.json.example").decode()
ex = json.loads("".join(l for l in example.splitlines(True) if not l.strip().startswith("//")))
shown = {(ev, e.get("matcher") or "", h.get("command", "")) for ev, es in ex.get("hooks", {}).items() for e in es
         for h in e.get("hooks", []) if any(n in h.get("command", "") for n in VOICE)}
for row in sorted(want):
    check(f"settings.json.example shows {row[0]} {row[1][:30] or row[2][:30]}...", row in shown)

# 5
code = ("const m = await import(process.argv[1]);"
        "const lists = Object.entries(m).filter(([, v]) => Array.isArray(v) && v.length).map(([k]) => k);"
        "console.log(JSON.stringify({ reviewed: m.REVIEWED, nonEmpty: lists }));")
q = subprocess.run(["node", "--input-type=module", "-e", code, "file://" + os.path.join(T, "voice-overlay.mjs")], capture_output=True, text=True, timeout=30)
try:
    ov = json.loads(q.stdout)
except Exception:  # noqa: BLE001
    ov = {"reviewed": None, "nonEmpty": ["(could not load: " + q.stderr.strip()[-120:] + ")"]}
check("tools/voice-overlay.mjs is the blank template", ov["reviewed"] is False and not ov["nonEmpty"], json.dumps(ov))

# 6
setup = read("setup.sh").decode()
r = re.search(r"^RETIRED=\((.*?)\)", setup, re.M)
retired = r.group(1).split() if r else []
check("setup.sh lists retired voice files", "tools/voice-setup.mjs" in retired and "tools/voice-overlay.skeleton.mjs" in retired, str(retired))
check("retired files are not shipped", not any(os.path.exists(os.path.join(REPO, x)) for x in retired))

print(f"\n{sum(results)}/{len(results)} voice kit checks passed")
sys.exit(0 if all(results) else 1)
