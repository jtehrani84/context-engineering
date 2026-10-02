#!/usr/bin/env python3
"""
Hook self-test: feeds synthetic Claude Code payloads to every hook the kit ships and checks that each
one answers in the format Claude Code actually reads.

    python3 hooks/selftest.py              # test the hooks in this repo
    python3 hooks/selftest.py --installed  # test the copies in ~/.claude/hooks (after ./setup.sh)
    python3 hooks/selftest.py --fast       # skip cases marked slow (none today; kept for test-all.sh)
    python3 hooks/selftest.py --verbose    # print each hook's raw output

Exit code 0 = every check passed, 1 = at least one failed. Nothing here touches your real ~/.claude
or the network: each run gets a scratch HOME and a restricted PATH.

What "valid" means here (the Claude Code hooks reference):
  - exit code 0 (exit 2 would block the tool call, which no kit hook does)
  - stdout is empty, or one JSON object
  - PreToolUse:  hookSpecificOutput.permissionDecision is "deny" or "ask" (with a reason) or absent;
                 additionalContext is a nudge. "allow" is never emitted: say nothing instead, so the
                 normal permission flow still applies.
  - PostToolUse / SessionStart: hookSpecificOutput.additionalContext for a nudge. A PostToolUse block is
                 top-level {"decision": "block", "reason": ...} (with a non-empty reason); the kit's
                 proof gates use it only when KIT_PROOF_GATES=block is set.
  - hookEventName matches the event the hook is wired to
  - none of the legacy shapes that older kit versions printed ({"result": ...}, {"decision": "approve"})

Also asserts that every script in hooks/scripts and hooks/scripts-optional has at least one case
below, so a hook added later can't ship untested.
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

ALLOWED_PRE_KEYS = {"hookEventName", "permissionDecision", "permissionDecisionReason", "additionalContext", "updatedInput"}
ALLOWED_POST_KEYS = {"hookEventName", "additionalContext"}
ALLOWED_TOP_KEYS = {"hookSpecificOutput", "continue", "stopReason", "suppressOutput", "systemMessage"}
ALLOWED_POST_TOP_KEYS = ALLOWED_TOP_KEYS | {"decision", "reason"}


# ----------------------------------------------------------------------------------------------------
# contract check
# ----------------------------------------------------------------------------------------------------
def contract_errors(stdout, event):
    """Return a list of contract violations for one hook run (empty list = valid)."""
    text = stdout.strip()
    if not text:
        return []
    try:
        obj = json.loads(text)
    except ValueError:
        return [f"stdout is not JSON: {text[:80]!r}"]
    if not isinstance(obj, dict):
        return [f"stdout JSON is {type(obj).__name__}, not an object"]
    errs = []
    if "result" in obj:
        errs.append('legacy {"result": ...} shape (Claude Code does not read it)')
    if obj.get("decision") in ("approve", "allow"):
        errs.append('legacy {"decision": "approve"} shape')
    extra = set(obj) - (ALLOWED_POST_TOP_KEYS if event == "PostToolUse" else ALLOWED_TOP_KEYS)
    if extra:
        errs.append(f"unexpected top-level keys {sorted(extra)}")
    if "decision" in obj:
        if event != "PostToolUse":
            errs.append(f"top-level decision is only read on PostToolUse, not {event}")
        elif obj["decision"] != "block":
            errs.append(f"top-level decision {obj['decision']!r} is not 'block'")
        elif not str(obj.get("reason", "")).strip():
            errs.append('decision "block" without a reason')
    hso = obj.get("hookSpecificOutput")
    if hso is None:
        return errs  # {} = no decision
    if not isinstance(hso, dict):
        return errs + ["hookSpecificOutput is not an object"]
    if hso.get("hookEventName") != event:
        errs.append(f"hookEventName {hso.get('hookEventName')!r} != {event!r}")
    allowed = ALLOWED_PRE_KEYS if event == "PreToolUse" else ALLOWED_POST_KEYS
    extra = set(hso) - allowed
    if extra:
        errs.append(f"keys not valid for {event}: {sorted(extra)}")
    decision = hso.get("permissionDecision")
    if decision is not None:
        if decision == "allow":
            errs.append('permissionDecision "allow": prefer no decision so the normal permission flow applies')
        elif decision not in ("deny", "ask"):
            errs.append(f"permissionDecision {decision!r} is not deny/ask")
        if not str(hso.get("permissionDecisionReason", "")).strip():
            errs.append("permissionDecision without a permissionDecisionReason")
    if "additionalContext" in hso and not str(hso["additionalContext"]).strip():
        errs.append("empty additionalContext")
    return errs


def classify(stdout):
    """silent | deny | ask | context | block"""
    text = stdout.strip()
    if not text:
        return "silent"
    obj = json.loads(text)
    if obj.get("decision") == "block":
        return "block"
    hso = obj.get("hookSpecificOutput") or {}
    if hso.get("permissionDecision") in ("deny", "ask"):
        return hso["permissionDecision"]
    if hso.get("additionalContext"):
        return "context"
    return "silent"  # {} and other no-decision answers


def text_of(stdout):
    try:
        obj = json.loads(stdout.strip() or "{}")
    except ValueError:
        return stdout
    hso = obj.get("hookSpecificOutput") or {}
    parts = [str(hso.get(k, "")) for k in ("permissionDecisionReason", "additionalContext")]
    return " ".join(parts + [str(obj.get("reason", ""))])


# ----------------------------------------------------------------------------------------------------
# scratch environment: fake HOME, fake `sf`, throwaway git repos
# ----------------------------------------------------------------------------------------------------
class Env:
    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="hook-selftest-")
        self.home = os.path.join(self.root, "home")
        self.bin = os.path.join(self.root, "bin")
        os.makedirs(os.path.join(self.home, ".claude"))
        os.makedirs(self.bin)
        # A second scratch HOME with a schema and domain terms configured, for the two config-driven hooks.
        self.home_cfg = os.path.join(self.root, "home-cfg")
        os.makedirs(os.path.join(self.home_cfg, ".claude"))
        with open(os.path.join(self.home_cfg, ".claude", "schema.json"), "w") as f:
            json.dump({"tables": {"users": ["id", "email", "name", "created_at"],
                                  "orders": ["id", "user_id", "total", "status"]}}, f)
        with open(os.path.join(self.home_cfg, ".claude", "domain-terms.json"), "w") as f:
            json.dump({"React Server-Side Components": "The term is 'React Server Components'."}, f)
        self.repo_main = self._repo("main")
        self.repo_feature = self._repo("feature/x")

    def _repo(self, branch):
        d = os.path.join(self.root, "repo-" + branch.replace("/", "-"))
        os.makedirs(d)
        env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
                   GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com")
        for args in (["init", "-q", "-b", "main"], ["commit", "-q", "--allow-empty", "-m", "init"]):
            subprocess.run(["git", *args], cwd=d, env=env, capture_output=True)
        if branch != "main":
            subprocess.run(["git", "checkout", "-q", "-b", branch], cwd=d, env=env, capture_output=True)
        return d

    def env(self, configured=False, keep_path=False, extra=None):
        e = {"HOME": self.home_cfg if configured else self.home, "LANG": "C.UTF-8", **(extra or {})}
        if keep_path:
            e["PATH"] = os.environ.get("PATH", "/usr/bin:/bin")  # voice gate needs node
        else:
            e["PATH"] = self.bin + os.pathsep + "/usr/bin:/bin"  # restricted: system tools only
        return e

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


# ----------------------------------------------------------------------------------------------------
# cases
# ----------------------------------------------------------------------------------------------------
SLOP = ("We leverage a robust, seamless ecosystem to unlock holistic synergy. " * 25).strip()
PLAIN = "The deploy finished at noon and the smoke test passed on the first try. " * 30


def bash(cmd, **extra):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}, **extra}


def write(path, content):
    return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}}


def posted_bash(cmd, stdout=""):
    """A PostToolUse Bash payload, with the tool_response Claude Code sends after the command ran."""
    return {"tool_name": "Bash", "tool_input": {"command": cmd},
            "tool_response": {"stdout": stdout, "stderr": "", "interrupted": False}}


PROSE_FILLER = (" The rollout plan covers three phases and the team reviewed each one with the account group."
                " Dependencies were listed and owners were named for every step of the work.")
EXTERNAL_RISKY = ("Technical analysis prepared for the customer success team." + PROSE_FILLER +
                  " Switching the auth method leaves the streaming API untouched, and the fix is to rotate the key." + PROSE_FILLER)
AUDIT_RISKY = ("Audit of the generated summary: findings and verdict." + PROSE_FILLER +
               " The quarterly filing has no mention of the lawsuit, so the lawsuit claim is fabricated." + PROSE_FILLER)


def cases(env):
    """(hook file, label, event, payload, expectation). expectation = (kind, substring-or-None)."""
    S = "schema-check.py"
    G = "guardrail.py"
    out = []

    def add(hook, label, event, payload, kind, needle=None, **run):
        out.append((hook, label, event, payload, (kind, needle), run))

    # ---- schema-check: deny only a misspelled column on a known table; fail open on everything else ----
    add(S, "no schema configured -> no decision", "PreToolUse", bash('psql -c "SELECT id, emial FROM users"'), "silent")
    add(S, "valid columns -> no decision", "PreToolUse", bash('psql -c "SELECT id, email FROM users"'), "silent", configured=True)
    add(S, "misspelled column -> deny with suggestion", "PreToolUse",
        bash('psql -c "SELECT id, emial FROM users"'), "deny", "Did you mean", configured=True)
    add(S, "table.column form is checked", "PreToolUse",
        bash('sqlite3 app.db "SELECT o.totl FROM orders o"'), "deny", "totl", configured=True)
    add(S, "table not in the schema -> note, never a deny", "PreToolUse",
        bash('psql -c "SELECT id FROM invoices"'), "context", "not in", configured=True)
    add(S, "not a query command -> no decision", "PreToolUse", bash("ls -la"), "silent", configured=True)
    add(S, "non-Bash tool -> no decision", "PreToolUse", {"tool_name": "Read", "tool_input": {"file_path": "/x"}}, "silent", configured=True)
    add(S, "empty payload -> no decision", "PreToolUse", {}, "silent", configured=True)

    # ---- guardrail ----
    def g(label, cmd, kind, needle=None, cwd=None):
        add(G, label, "PreToolUse", bash(cmd, **({"cwd": cwd} if cwd else {})), kind, needle)

    g("force-push to main (flag first)", "git push --force origin main", "deny", "protected branch")
    g("force-push to main (flag last)", "git push origin main --force", "deny", "protected branch")
    g("force-push to main (-f)", "git push -f origin main", "deny")
    g("force-push to main (+refspec)", "git push origin +main", "deny")
    g("force-push to main (chained)", "cd app && git push --force origin main", "deny")
    g("force-with-lease to main is allowed", "git push --force-with-lease origin main", "silent")
    g("force-with-lease=ref:sha is allowed", "git push --force-with-lease=main:abc123 origin main", "silent")
    g("plain push to main is allowed", "git push origin main", "silent")
    g("plain force on a feature branch -> ask", "git push --force origin feature/x", "ask", "force-with-lease")
    g("bare force while main is checked out -> deny", "git push --force", "deny", "checked out", cwd=env.repo_main)
    g("bare force on a feature branch -> ask", "git push --force", "ask", cwd=env.repo_feature)
    g("deleting main on the remote -> deny", "git push origin --delete main", "deny")
    g("echoing a force-push is not a force-push", "echo git push --force origin main", "silent")
    g("rm -rf $HOME", "rm -rf $HOME", "deny", "Recursive delete")
    g('rm -rf "$HOME"', 'rm -rf "$HOME"', "deny")
    g("rm -rf ${HOME}", "rm -rf ${HOME}", "deny")
    g("rm -rf ~", "rm -rf ~", "deny")
    g("rm -rf /", "rm -rf /", "deny")
    g("rm -rf /*", "rm -rf /*", "deny")
    g("rm -fr .", "rm -fr .", "deny")
    g("sudo rm -rf / in a chain", "ls && sudo rm -rf /", "deny")
    g("rm -rf ./build is fine", "rm -rf ./build", "silent")
    g("rm -rf under home is fine", "rm -rf ~/scratch/tmp", "silent")
    g("--set-env-vars", "deploy app --set-env-vars A=1", "deny", "update-env-vars")
    g("git reset --hard -> ask", "git reset --hard HEAD~1", "ask")
    add(G, "Write to a .env file -> ask", "PreToolUse",
        {"tool_name": "Write", "tool_input": {"file_path": "/x/.env", "content": "A=1"}}, "ask")
    add(G, "ordinary command -> no decision", "PreToolUse", bash("ls -la"), "silent")

    # ---- domain-verification ----
    P = "domain-verification.py"
    add(P, "no terms configured -> silent", "PreToolUse", write("/x/a.md", "We use React Server-Side Components."), "silent")
    add(P, "configured wrong term -> nudge", "PreToolUse", write("/x/a.md", "We use React Server-Side Components."),
        "context", "Domain Verification", configured=True)
    add(P, "clean content -> silent", "PreToolUse", write("/x/a.md", "Plain sentence about orders."), "silent", configured=True)
    add(P, "Edit tool is checked too", "PreToolUse",
        {"tool_name": "Edit", "tool_input": {"file_path": "/x/a.md", "old_string": "a", "new_string": "react server-side components rock"}},
        "context", None, configured=True)
    add(P, "non-Edit/Write tool -> silent", "PreToolUse", bash("ls"), "silent", configured=True)

    # ---- output-quality-gate ----
    Q = "output-quality-gate.py"
    add(Q, "slop in a long .md -> nudge", "PostToolUse", write("/x/post.md", SLOP), "context", "OUTPUT QUALITY")
    add(Q, "plain long .md -> silent", "PostToolUse", write("/x/post.md", PLAIN), "silent")
    add(Q, "short file skipped", "PostToolUse", write("/x/post.md", "leverage synergy"), "silent")
    add(Q, "non-content extension skipped", "PostToolUse", write("/x/post.py", SLOP), "silent")

    # ---- voice-tell-gate (needs node + tools/aiscore.mjs; checks contract only) ----
    V = "voice-tell-gate.py"
    add(V, "slop in a long .md -> valid answer", "PostToolUse", write("/x/post.md", SLOP), "any", None, keep_path=True)
    add(V, "plain long .md -> valid answer", "PostToolUse", write("/x/post.md", PLAIN), "any", None, keep_path=True)
    add(V, "short file -> silent", "PostToolUse", write("/x/post.md", "short"), "silent", None, keep_path=True)
    add(V, "non-Write tool -> silent", "PostToolUse", bash("ls"), "silent", None, keep_path=True)

    # ---- session-init ----
    add("session-init.py", "SessionStart in a repo -> context", "SessionStart",
        {"hook_event_name": "SessionStart", "cwd": env.repo_feature}, "any")
    add("session-init.py", "SessionStart outside a repo -> valid answer", "SessionStart",
        {"hook_event_name": "SessionStart", "cwd": env.root}, "any")

    # ---- proof family (PostToolUse nudges; KIT_PROOF_GATES=block switches to a top-level block) ----
    D = "deploy-proof-gate.py"
    add(D, "deploy command -> nudge", "PostToolUse", posted_bash("terraform apply -auto-approve"), "context", "DEPLOY PROOF")
    add(D, "clasp deploy -> nudge names the Apps Script proof", "PostToolUse", posted_bash("clasp deploy"), "context", "Apps Script")
    add(D, "block mode -> top-level decision block", "PostToolUse", posted_bash("npm publish"), "block", "DEPLOY PROOF",
        extra_env={"KIT_PROOF_GATES": "block"})
    add(D, "dry run -> silent", "PostToolUse", posted_bash("terraform apply --dry-run"), "silent")
    add(D, "commit message mentioning a deploy -> silent", "PostToolUse",
        posted_bash('git commit -m "fix terraform apply ordering"'), "silent")
    add(D, "non-Bash tool -> silent", "PostToolUse", write("/x/a.md", "x"), "silent")
    C = "claim-faithfulness-gate.py"
    add(C, "external doc with over-confident claims -> nudge", "PostToolUse", write("/x/handoff.md", EXTERNAL_RISKY),
        "context", "/claim-audit")
    add(C, "block mode -> top-level decision block", "PostToolUse", write("/x/handoff.md", EXTERNAL_RISKY), "block", None,
        extra_env={"KIT_PROOF_GATES": "block"})
    add(C, "internal note -> silent", "PostToolUse", write("/x/notes.md", "Scratch notes on the parser." + PROSE_FILLER * 2),
        "silent")
    add(C, "code file -> silent", "PostToolUse", write("/x/a.py", EXTERNAL_RISKY), "silent")
    R = "refutation-oracle-gate.py"
    add(R, "audit calling something fabricated -> nudge", "PostToolUse", write("/x/audit.md", AUDIT_RISKY), "context", "UNVERIFIED")
    add(R, "block mode -> top-level decision block", "PostToolUse", write("/x/audit.md", AUDIT_RISKY), "block", None,
        extra_env={"KIT_PROOF_GATES": "block"})
    add(R, "ordinary prose -> silent", "PostToolUse", write("/x/post.md", PLAIN), "silent")

    # ---- graph-auto-index (installed, not wired by default; writes to a scratch HOME) ----
    A = "graph-auto-index.py"
    note = os.path.join(env.home, ".claude", "rules", "demo.md")
    os.makedirs(os.path.dirname(note), exist_ok=True)
    with open(note, "w") as f:
        f.write("# Demo\nNotes about Acme and the Orders service.\n")
    add(A, "indexes a rules file, says nothing", "PostToolUse", write(note, "x"), "silent")
    add(A, "file outside the graph -> silent", "PostToolUse", write("/tmp/other.txt", "x"), "silent")
    add(A, "empty payload -> silent", "PostToolUse", {}, "silent")
    return out


# Every hook also gets these: unreadable input must never break the session (exit 0, no bad output).
BAD_INPUTS = [("empty stdin", ""), ("not JSON", "this is not json"), ("JSON array", "[1,2]"), ("JSON null", "null")]
EVENT_OF = {"schema-check.py": "PreToolUse", "guardrail.py": "PreToolUse", "domain-verification.py": "PreToolUse",
            "output-quality-gate.py": "PostToolUse", "voice-tell-gate.py": "PostToolUse",
            "graph-auto-index.py": "PostToolUse", "session-init.py": "SessionStart",
            "deploy-proof-gate.py": "PostToolUse", "claim-faithfulness-gate.py": "PostToolUse",
            "refutation-oracle-gate.py": "PostToolUse"}


def find_hooks(installed):
    base = os.path.join(os.path.expanduser("~/.claude/hooks") if installed else HERE)
    found = {}
    for sub in ("scripts", "scripts-optional"):
        d = os.path.join(base, sub)
        if os.path.isdir(d):
            for name in sorted(os.listdir(d)):
                if name.endswith(".py"):
                    found[name] = os.path.join(d, name)
    return found


def run_hook(path, stdin_text, env_vars, cwd=None, timeout=30):
    p = subprocess.run([PY, path], input=stdin_text, capture_output=True, text=True, env=env_vars,
                       cwd=cwd or tempfile.gettempdir(), timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def main(argv):
    installed = "--installed" in argv
    fast = "--fast" in argv
    verbose = "--verbose" in argv
    hooks = find_hooks(installed)
    if not hooks:
        print("No hooks found to test.")
        return 1

    env = Env()
    passed = failed = skipped = 0
    failures = []

    def record(ok, name, detail=""):
        nonlocal passed, failed
        if ok:
            passed += 1
            print(f"  ok    {name}")
        else:
            failed += 1
            failures.append(name)
            print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))

    try:
        all_cases = cases(env)
        covered = {c[0] for c in all_cases}
        print(f"Testing {len(hooks)} hooks from {'~/.claude/hooks' if installed else HERE}\n")

        # coverage: a shipped hook with no case is a failure
        for name in hooks:
            if name not in covered:
                record(False, f"{name}: has no self-test case", "add cases to hooks/selftest.py")

        node_ok = shutil.which("node") is not None
        for hook, label, event, payload, (kind, needle), opts in all_cases:
            if hook not in hooks:
                continue  # e.g. an older install without that hook
            name = f"{hook}: {label}"
            if opts.get("slow") and fast:
                skipped += 1
                print(f"  skip  {name}")
                continue
            if hook == "voice-tell-gate.py" and not node_ok:
                skipped += 1
                print(f"  skip  {name} (node not installed)")
                continue
            e = env.env(configured=opts.get("configured", False),
                        keep_path=opts.get("keep_path", False), extra=opts.get("extra_env"))
            try:
                rc, out, err = run_hook(hooks[hook], json.dumps(payload), e, cwd=payload.get("cwd"))
            except subprocess.TimeoutExpired:
                record(False, name, "hook timed out")
                continue
            if verbose:
                print(f"        rc={rc} stdout={out.strip()[:300]!r}")
            errs = []
            if rc != 0:
                errs.append(f"exit code {rc} (stderr: {err.strip()[-200:]})")
            errs += contract_errors(out, event)
            if not errs:
                got = classify(out)
                if kind != "any" and got != kind:
                    errs.append(f"expected {kind}, got {got}: {text_of(out)[:160]!r}")
                elif needle and needle.lower() not in text_of(out).lower():
                    errs.append(f"output missing {needle!r}: {text_of(out)[:160]!r}")
            record(not errs, name, "; ".join(errs))

        # unreadable input: never break the session
        for hook, path in hooks.items():
            for label, text in BAD_INPUTS:
                name = f"{hook}: {label} -> exits 0, no bad output"
                try:
                    rc, out, err = run_hook(path, text, env.env(keep_path=True))
                except subprocess.TimeoutExpired:
                    record(False, name, "hook timed out")
                    continue
                errs = [] if rc == 0 else [f"exit code {rc} (stderr: {err.strip()[-160:]})"]
                errs += contract_errors(out, EVENT_OF.get(hook, "PreToolUse"))
                record(not errs, name, "; ".join(errs))
    finally:
        env.cleanup()

    total = passed + failed
    print(f"\n{passed}/{total} checks passed" + (f", {skipped} skipped" if skipped else ""))
    if failed:
        print("FAILED:\n  " + "\n  ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
