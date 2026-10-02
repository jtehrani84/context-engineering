#!/usr/bin/env python3
"""protect-paths.test.py - proof for the path-protection hook. Exit 1 on any failure.
Runs the hook as a subprocess with synthetic PreToolUse payloads, the way Claude Code does."""
import json
import os
import subprocess
import sys
import tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "protect-paths.py")
passed = failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("  FAIL: " + msg, file=sys.stderr)


def run(payload, env_extra=None, raw=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PROTECT_PATHS")}
    env.update(env_extra or {})
    p = subprocess.run([sys.executable, HOOK], input=raw if raw is not None else json.dumps(payload),
                       capture_output=True, text=True, env=env)
    out = p.stdout.strip()
    return p.returncode, (json.loads(out) if out else None)


def denied(res):
    return res and res.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"


with tempfile.TemporaryDirectory() as tmp:
    tmp = os.path.realpath(tmp)
    prot = os.path.join(tmp, "evals", "gold")
    os.makedirs(prot)
    env = {"PROTECT_PATHS": prot, "PROTECT_PATHS_FILE": os.path.join(tmp, "none.txt")}

    def write(path, tool="Write"):
        return {"tool_name": tool, "tool_input": {"file_path": path}}

    # a write inside the protected root is denied, with the documented contract
    rc, res = run(write(os.path.join(prot, "cases.json")), env)
    check(rc == 0 and denied(res), "write inside protected root -> deny JSON, exit 0")
    check(res and res["hookSpecificOutput"].get("hookEventName") == "PreToolUse", "deny carries hookEventName=PreToolUse")
    check(res and "permissionDecisionReason" in res["hookSpecificOutput"], "deny carries a reason")
    for tool in ("Edit", "MultiEdit", "NotebookEdit"):
        rc, res = run(write(os.path.join(prot, "x.json"), tool), env)
        check(denied(res), f"{tool} into protected root denied")
    # the root itself and a nested path
    check(denied(run(write(prot), env)[1]), "the protected root itself is denied")
    check(denied(run(write(os.path.join(prot, "a", "b", "c.txt")), env)[1]), "nested path denied")

    # lookalike sibling is NOT protected (dot/slash boundary, not string-prefix)
    rc, res = run(write(os.path.join(tmp, "evals", "gold-extra", "x.json")), env)
    check(rc == 0 and res is None, "sibling 'gold-extra' is not protected (no decision printed)")
    # unrelated path passes with NO decision (not an explicit allow)
    rc, res = run(write(os.path.join(tmp, "src", "app.py")), env)
    check(rc == 0 and res is None, "unrelated write -> pass-through, prints nothing")
    # non-write tools are ignored
    rc, res = run({"tool_name": "Read", "tool_input": {"file_path": os.path.join(prot, "cases.json")}}, env)
    check(rc == 0 and res is None, "Read of a protected path is not blocked")

    # traversal and symlink tricks resolve to the protected root
    rc, res = run(write(os.path.join(tmp, "src", "..", "evals", "gold", "x.json")), env)
    check(denied(res), ".. traversal into protected root denied")
    link = os.path.join(tmp, "shortcut")
    os.symlink(prot, link)
    check(denied(run(write(os.path.join(link, "x.json")), env)[1]), "symlink into protected root denied")

    # config file adds roots
    other = os.path.join(tmp, "lockdir")
    os.makedirs(other)
    cfg = os.path.join(tmp, "protected-paths.txt")
    open(cfg, "w").write("# comment\n\n" + other + "\n")
    rc, res = run(write(os.path.join(other, "harness.lock")), {"PROTECT_PATHS_FILE": cfg})
    check(denied(res), "path listed in PROTECT_PATHS_FILE denied")

    # nothing configured -> nothing protected (documented), no crash
    rc, res = run(write(os.path.join(prot, "cases.json")), {"PROTECT_PATHS_FILE": os.path.join(tmp, "none.txt")})
    check(rc == 0 and res is None, "no roots configured -> pass-through (nothing protected until you configure it)")

    # FAIL CLOSED on garbage input
    rc, res = run(None, env, raw="{not json")
    check(rc == 0 and denied(res), "unparseable hook input -> deny (fail-closed)")
    # empty stdin / missing file_path pass through
    rc, res = run(None, env, raw="")
    check(rc == 0 and res is None, "empty payload -> pass-through")
    rc, res = run({"tool_name": "Write", "tool_input": {}}, env)
    check(rc == 0 and res is None, "write with no file_path -> pass-through")

print(f"protect-paths.test: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
