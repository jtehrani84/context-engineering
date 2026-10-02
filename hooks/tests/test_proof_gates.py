#!/usr/bin/env python3
"""
Self-test for the three proof-family hooks: deploy-proof-gate, claim-faithfulness-gate,
refutation-oracle-gate. Stdlib only. Run from anywhere:

    python3 hooks/tests/test_proof_gates.py

Each case feeds a synthetic Claude Code hook payload to the real script on stdin and checks what
it prints. It verifies the output contract (valid hookSpecificOutput.additionalContext for a nudge,
top-level decision:"block" for block mode, nothing at all when the hook stays quiet), that the
hooks fire on what they should, stay silent on what they should, and never crash on garbage input.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.normpath(os.path.join(HERE, "..", "scripts"))
DEPLOY = os.path.join(SCRIPTS, "deploy-proof-gate.py")
CLAIM = os.path.join(SCRIPTS, "claim-faithfulness-gate.py")
REFUTE = os.path.join(SCRIPTS, "refutation-oracle-gate.py")


def run(script, payload, env_extra=None, raw=None):
    env = dict(os.environ)
    env.pop("KIT_PROOF_GATES", None)
    env.update(env_extra or {})
    stdin = raw if raw is not None else json.dumps(payload)
    return subprocess.run([sys.executable, script], input=stdin, capture_output=True,
                          text=True, env=env, timeout=20)


def parsed(p):
    assert p.returncode == 0, f"non-zero exit {p.returncode}: {p.stderr}"
    out = p.stdout.strip()
    return json.loads(out) if out else None


def nudge_text(out):
    assert out is not None, "expected a nudge, hook was silent"
    assert set(out.keys()) == {"hookSpecificOutput"}, out
    h = out["hookSpecificOutput"]
    assert h["hookEventName"] == "PostToolUse", h
    assert isinstance(h["additionalContext"], str) and h["additionalContext"], h
    return h["additionalContext"]


def bash(cmd, stdout="", cwd=None, resp_shape="dict"):
    resp = {"stdout": stdout, "stderr": "", "interrupted": False} if resp_shape == "dict" else stdout
    payload = {"tool_name": "Bash", "tool_input": {"command": cmd}, "tool_response": resp}
    if cwd:
        payload["cwd"] = cwd
    return payload


def write(path, content, tool="Write"):
    if tool == "Write":
        return {"tool_name": "Write", "tool_input": {"file_path": path, "content": content}}
    if tool == "Edit":
        return {"tool_name": "Edit", "tool_input": {"file_path": path, "old_string": "x", "new_string": content}}
    return {"tool_name": "MultiEdit",
            "tool_input": {"file_path": path, "edits": [{"old_string": "x", "new_string": content}]}}


class DeployProofGate(unittest.TestCase):
    def test_command_signatures_fire(self):
        for cmd in ["gcloud run deploy svc --source .", "terraform apply -auto-approve", "npm publish",
                    "npx prisma migrate deploy", "kubectl apply -f k.yaml",
                    "./deploy.sh prod", "clasp push", "clasp deploy -i AKfy", "helm upgrade app ./chart"]:
            with self.subTest(cmd=cmd):
                text = nudge_text(parsed(run(DEPLOY, bash(cmd))))
                self.assertIn("MANDATORY DEPLOY PROOF", text)

    def test_apps_script_signature_folded_in(self):
        text = nudge_text(parsed(run(DEPLOY, bash("clasp deploy"))))
        self.assertIn("Apps Script", text)
        self.assertIn("Executions", text)

    def test_quiet_on_unrelated_and_proof_steps(self):
        for cmd in ["ls -la", "git status", "npm test", "./verify-deploy.sh", "terraform apply --dry-run",
                    "kubectl rollout status deploy/app", "npx prisma migrate status",
                    "gcloud run deploy --help", "docker run --rm node:20 node -v"]:
            with self.subTest(cmd=cmd):
                self.assertIsNone(parsed(run(DEPLOY, bash(cmd))))

    def test_quoted_prose_does_not_fire(self):
        self.assertIsNone(parsed(run(DEPLOY, bash('git commit -m "fix terraform apply ordering"'))))
        self.assertIsNone(parsed(run(DEPLOY, bash("echo 'remember to clasp push later'"))))
        # a bash -c wrapper keeps the command visible
        nudge_text(parsed(run(DEPLOY, bash("bash -c 'terraform apply'"))))

    def test_tool_response_is_read_not_tool_output(self):
        # Output-only signal (a wrapper that hides the deploy verb) must fire via tool_response.
        nudge_text(parsed(run(DEPLOY, bash("./ship-it", stdout="Deploying container to Cloud Run service [x]..."))))
        nudge_text(parsed(run(DEPLOY, bash("./ship-it", stdout="Service [x] revision [x-00042-abc] has been deployed"))))
        # a string-shaped tool_response works too
        nudge_text(parsed(run(DEPLOY, bash("./ship-it", stdout="deployment complete", resp_shape="str"))))
        # the dead legacy field must NOT be what triggers it
        legacy = {"tool_name": "Bash", "tool_input": {"command": "./ship-it"}, "tool_output": "deployment complete"}
        self.assertIsNone(parsed(run(DEPLOY, legacy)))

    def test_output_signal_ignored_when_just_reading_text(self):
        self.assertIsNone(parsed(run(DEPLOY, bash("cat release-notes.txt", stdout="release created for v1"))))
        self.assertIsNone(parsed(run(DEPLOY, bash("grep -r deployment deploy.log", stdout="deployment complete"))))

    def test_generic_build_words_do_not_fire(self):
        self.assertIsNone(parsed(run(DEPLOY, bash("swift build", stdout="Build succeeded"))))
        self.assertIsNone(parsed(run(DEPLOY, bash("kubectl get pods", stdout="rollout complete"))))

    def test_names_project_verify_script(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "verify-deploy.sh"), "w") as fh:
                fh.write("#!/bin/sh\nexit 0\n")
            text = nudge_text(parsed(run(DEPLOY, bash("gcloud run deploy svc", cwd=d))))
            self.assertIn("./verify-deploy.sh", text)
        with tempfile.TemporaryDirectory() as d:
            text = nudge_text(parsed(run(DEPLOY, bash("gcloud run deploy svc", cwd=d))))
            self.assertIn("No project proof script", text)

    def test_block_mode_uses_top_level_decision(self):
        out = parsed(run(DEPLOY, bash("npm publish"), env_extra={"KIT_PROOF_GATES": "block"}))
        self.assertEqual(set(out.keys()), {"decision", "reason"})
        self.assertEqual(out["decision"], "block")
        self.assertIn("MANDATORY DEPLOY PROOF", out["reason"])

    def test_non_bash_and_garbage_are_silent(self):
        self.assertIsNone(parsed(run(DEPLOY, {"tool_name": "Read", "tool_input": {"file_path": "x"}})))
        for raw in ["", "not json", "[]", "null", '{"tool_name":"Bash"}', '{"tool_name":"Bash","tool_input":"str"}']:
            with self.subTest(raw=raw):
                self.assertIsNone(parsed(run(DEPLOY, None, raw=raw)))

    def test_does_not_read_dead_legacy_field(self):
        with open(DEPLOY) as fh:
            src = fh.read()
        self.assertNotIn('"tool_output"', src)


FILLER = (" The rollout plan covers three phases and the team reviewed each one in detail with the account group."
          " Dependencies were listed and owners were named for every step of the work.")


class ClaimFaithfulnessGate(unittest.TestCase):
    EXTERNAL_RISKY = ("Technical analysis prepared for the customer success team." + FILLER +
                      " Switching the auth method leaves the streaming API untouched, and the fix is to rotate the key." + FILLER)

    def test_fires_on_external_doc_with_tells_all_write_tools(self):
        for tool in ("Write", "Edit", "MultiEdit"):
            with self.subTest(tool=tool):
                text = nudge_text(parsed(run(CLAIM, write("/tmp/handoff.md", self.EXTERNAL_RISKY, tool))))
                self.assertIn("CLAIM-FAITHFULNESS CHECK", text)
                self.assertIn("/claim-audit", text)

    def test_quiet_without_audience_or_without_tells(self):
        internal = "Scratch notes on the parser." + FILLER + " Switching the flag leaves it untouched, the fix is easy." + FILLER
        self.assertIsNone(parsed(run(CLAIM, write("/tmp/notes.md", internal))))
        clean = ("Technical analysis prepared for the customer success team." + FILLER +
                 " The release note states the parser may fail on nested input." + FILLER)
        self.assertIsNone(parsed(run(CLAIM, write("/tmp/clean.md", clean))))

    def test_plural_supports_is_not_a_support_handoff(self):
        text = "The library supports streaming and never blocks the main loop." + FILLER + FILLER
        self.assertIsNone(parsed(run(CLAIM, write("/tmp/lib.md", text))))

    def test_quiet_on_code_short_text_and_own_rule_files(self):
        self.assertIsNone(parsed(run(CLAIM, write("/tmp/x.py", self.EXTERNAL_RISKY))))
        self.assertIsNone(parsed(run(CLAIM, write("/tmp/short.md", "leadership: leaves it untouched"))))
        self.assertIsNone(parsed(run(CLAIM, write("/Users/x/.claude/rules/claims-faithful-to-source.md", self.EXTERNAL_RISKY))))
        self.assertIsNone(parsed(run(CLAIM, write("/Users/x/.claude/commands/claim-audit.md", self.EXTERNAL_RISKY))))

    def test_calibrated_doc_gets_softer_tone(self):
        doc = self.EXTERNAL_RISKY + " This is a hypothesis, inferred from the logs, unconfirmed until re-verify."
        text = nudge_text(parsed(run(CLAIM, write("/tmp/h.md", doc))))
        self.assertIn("already carries calibration language", text)

    def test_block_mode(self):
        out = parsed(run(CLAIM, write("/tmp/handoff.md", self.EXTERNAL_RISKY), env_extra={"KIT_PROOF_GATES": "block"}))
        self.assertEqual(set(out.keys()), {"decision", "reason"})
        self.assertEqual(out["decision"], "block")

    def test_garbage_is_silent(self):
        for raw in ["", "nope", "[]", '{"tool_name":"Write","tool_input":null}']:
            with self.subTest(raw=raw):
                self.assertIsNone(parsed(run(CLAIM, None, raw=raw)))


class RefutationOracleGate(unittest.TestCase):
    AUDIT_RISKY = ("Audit of the generated summary: findings and verdict." + FILLER +
                   " The quarterly filing has no mention of the lawsuit, so the lawsuit claim is fabricated." + FILLER)

    def test_fires_on_audit_with_refutation_tells_all_write_tools(self):
        for tool in ("Write", "Edit", "MultiEdit"):
            with self.subTest(tool=tool):
                text = nudge_text(parsed(run(REFUTE, write("/tmp/audit.md", self.AUDIT_RISKY, tool))))
                self.assertIn("REFUTATION-ORACLE CHECK", text)
                self.assertIn("UNVERIFIED", text)

    def test_quiet_on_ordinary_prose_or_audit_without_refutation(self):
        prose = "A note about the office move." + FILLER + " Someone said the plan was fabricated for the stage show." + FILLER
        self.assertIsNone(parsed(run(REFUTE, write("/tmp/n.md", prose))))
        audit_ok = "Audit of the summary: findings and verdict." + FILLER + " Every claim was confirmed against its source." + FILLER
        self.assertIsNone(parsed(run(REFUTE, write("/tmp/a.md", audit_ok))))

    def test_quiet_on_code_short_and_own_rule_files(self):
        self.assertIsNone(parsed(run(REFUTE, write("/tmp/a.js", self.AUDIT_RISKY))))
        self.assertIsNone(parsed(run(REFUTE, write("/tmp/a.md", "audit: fabricated"))))
        self.assertIsNone(parsed(run(REFUTE, write("/x/refutation-needs-the-right-oracle.md", self.AUDIT_RISKY))))
        self.assertIsNone(parsed(run(REFUTE, write("/Users/x/.claude/workflows/notes.md", self.AUDIT_RISKY))))

    def test_disciplined_audit_gets_softer_tone(self):
        doc = (self.AUDIT_RISKY + " Lane not run: chat history was unverified. Right oracle named: the newsroom,"
               " which would live there by design; re-check pending.")
        text = nudge_text(parsed(run(REFUTE, write("/tmp/d.md", doc))))
        self.assertIn("already shows right-oracle discipline", text)

    def test_block_mode(self):
        out = parsed(run(REFUTE, write("/tmp/audit.md", self.AUDIT_RISKY), env_extra={"KIT_PROOF_GATES": "block"}))
        self.assertEqual(set(out.keys()), {"decision", "reason"})
        self.assertEqual(out["decision"], "block")

    def test_garbage_is_silent(self):
        for raw in ["", "{", "42", '{"tool_name":"Edit","tool_input":[]}']:
            with self.subTest(raw=raw):
                self.assertIsNone(parsed(run(REFUTE, None, raw=raw)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
