#!/usr/bin/env python3
"""
Consistency checks for the voice system as the kit ships it. Offline; runs voice-doctor with a scratch HOME.

  1. hooks/scripts/voice-tell-gate.py (what setup.sh installs) is byte-identical to tools/hook/voice-tell-gate.py
     (the source the docs and tools/hook-tests/ name).
  2. scripts/wire-hooks.py wires voice-tell-gate with the matchers `voice-doctor --print-hooks` prints for the
     default config: the PreToolUse send matcher (VOICE_SEND_MATCHER) and the PostToolUse file-write matcher.
  3. Every tool in VOICE_SEND_TOOLS is in the hook's SEND_SUFFIXES, so a wired send is also one the hook checks.
  4. settings.json.example shows the same two voice-tell-gate matchers.
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
check("installed hook copy == tools/hook source", read("hooks/scripts/voice-tell-gate.py") == read("tools/hook/voice-tell-gate.py"))

# 2
with tempfile.TemporaryDirectory() as home:
    p = subprocess.run(["node", os.path.join(T, "onboarding", "voice-doctor.mjs"), "--print-hooks"],
                       capture_output=True, text=True, timeout=60, env={**os.environ, "HOME": home, "CLAUDE_CONFIG_DIR": os.path.join(home, ".claude")})
try:
    printed = json.loads(p.stdout)["hooks"]
except Exception as e:  # noqa: BLE001
    printed = {}
    check("voice-doctor --print-hooks prints JSON", False, f"{e}; stderr {p.stderr[-200:]!r}")
want = {(ev, entry.get("matcher")) for ev, entries in printed.items() for entry in entries
        if any("voice-tell-gate.py" in h.get("command", "") for h in entry.get("hooks", []))}
wired = {(ev, m) for ev, m, script, _prior in wh.HOOKS if script == "voice-tell-gate.py"}
check("wire-hooks voice-tell-gate rows == voice-doctor --print-hooks", bool(want) and wired == want,
      f"wire-hooks {sorted(wired)} vs doctor {sorted(want)}")
check("VOICE_SEND_MATCHER is the PreToolUse row", ("PreToolUse", wh.VOICE_SEND_MATCHER) in want)

# 3
hook = read("tools/hook/voice-tell-gate.py").decode()
m = re.search(r"^SEND_SUFFIXES = \((.*?)^\)", hook, re.S | re.M)
suffixes = set(re.findall(r'"([a-z0-9_]+)"', m.group(1))) if m else set()
missing = [t for t in wh.VOICE_SEND_TOOLS if t not in suffixes]
check("every wired send tool is in the hook's SEND_SUFFIXES", bool(suffixes) and not missing, f"missing {missing}")

# 4
example = read("settings.json.example").decode()
for ev, matcher in sorted(want):
    pat = re.compile(r'"' + re.escape(ev) + r'"\s*:')
    check(f"settings.json.example shows {ev} {matcher[:40]}...", json.dumps(matcher) in example and bool(pat.search(example)))

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
