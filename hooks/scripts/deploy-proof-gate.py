#!/usr/bin/env python3
"""
PostToolUse hook (Bash): deploy-proof gate.

Fires after a Bash command that deploys, ships, or publishes something, in any project and any
stack. Hands Claude a reminder to capture a proof artifact from the RUNNING system before it
reports the work as shipped, live, or deployed.

WHY: when one agent writes, fixes, and deploys, nobody else ever crosses the work, so "deployed"
and "actually serving" can drift apart unnoticed. A commit, a clean local tree, or an earlier note
saying "deployed" is a claim. A signal from the running thing (an HTTP response, a row count, a
container hash, a fresh trace) is proof. See rules/proof-before-claim.md.

HONEST SCOPE: this hook nudges, it cannot prove. A PostToolUse hook fires on the tool call with no
before/after delta and no view into the deployed target. The proof is an executable artifact the
agent runs and reads. If the project has a verify-deploy.sh (or similar), the reminder names it;
otherwise it states the generic proof obligation for the detected target.

Output (Claude Code hooks contract):
  default               hookSpecificOutput.additionalContext      (a nudge Claude reads next to the result)
  KIT_PROOF_GATES=block   top-level {"decision": "block", "reason": ...}  (feeds the reason back to Claude)

Triggers (command-based, with a few output-based signals for wrapper scripts):
  Cloud Run, Cloud Functions, App Engine, Lambda/SAM, Vercel, Netlify, Fly, Render,
  Docker push, kubectl/helm apply, Terraform/CDK/Pulumi, npm/PyPI publish, Apps Script
  `clasp push` / `clasp deploy`, and any *deploy.sh.
"""
import glob
import json
import os
import re
import sys

MAX_OUTPUT_CHARS = 20000

# (substring in the command, label, suggested proof). Checked in order, case-insensitively,
# against the command with quoted strings removed (so a commit message that mentions
# "terraform apply" does not fire).
DEPLOY_SIGNATURES = [
    ("run deploy",              "Cloud Run service",   "curl the running revision URL, or `gcloud run services describe`, and confirm the live revision serves the change."),
    ("gcloud functions deploy", "Cloud Function",      "invoke the function and confirm a real response, not just deploy success."),
    ("gcloud app deploy",       "App Engine",          "fetch the served URL and confirm the new version is receiving traffic."),
    ("builds submit",           "container image build", "confirm the image is pulled AND the running container serves the new bytes (hash a served file against your tree)."),
    ("docker push",             "container image push", "confirm the target actually pulled and runs the new digest, not just that the push succeeded."),
    ("kubectl apply",           "Kubernetes manifest", "run `kubectl rollout status`, then hit the service and confirm the new pods serve."),
    ("helm upgrade",            "Helm release",        "run `helm status`, then probe the endpoint and confirm the release is serving."),
    ("terraform apply",         "Terraform infra",     "confirm the resource exists and is reachable through the provider API or console, not just that apply finished."),
    ("cdk deploy",              "CDK stack",           "hit the deployed endpoint or resource and confirm runtime behavior, not just CloudFormation success."),
    ("sam deploy",              "SAM/Lambda deploy",   "invoke the function and confirm a real response."),
    ("pulumi up",               "Pulumi stack",        "verify the live resource responds; a successful stack update is not runtime proof."),
    ("vercel deploy",           "Vercel deploy",       "open the deployment URL and confirm the new build serves the change."),
    ("vercel --prod",           "Vercel prod",         "open the production URL and confirm the new build is live."),
    ("netlify deploy",          "Netlify deploy",      "open the deploy URL and confirm the change is live."),
    ("flyctl deploy",           "Fly.io app",          "run `fly status`, then hit the app URL and confirm the new release serves."),
    ("fly deploy",              "Fly.io app",          "run `fly status`, then hit the app URL and confirm the new release serves."),
    ("render deploy",           "Render service",      "hit the service URL and confirm the new deploy is live."),
    ("npm publish",             "npm package publish", "install the published version fresh and confirm it imports and runs. Registry success is not proof."),
    ("twine upload",            "PyPI publish",        "pip install the published version in a clean environment and confirm it imports."),
    ("migrate deploy",          "database migration",  "query the migrated table and confirm the new column or row exists; a migration that reports success can still leave a column nobody can query."),
    # Apps Script (folded in from a standalone smoke gate): untyped runtime, so execution is the only proof.
    ("clasp deploy",            "Apps Script web app", "call the web-app endpoint with a synthetic payload and confirm a valid response, or check the Apps Script editor's Executions panel for the latest run. A clean deploy does not prove the code runs."),
    ("clasp push",              "Apps Script push",    "execute the changed path once (endpoint call or Executions panel). A push is not an execution, and it does not update the deployed web app; that takes a `clasp deploy`."),
]

# Output-level deploy signals, for wrapper scripts whose command line gives nothing away.
# Deliberately narrow: generic words like "rollout" or "build succeeded" appear in ordinary builds.
OUTPUT_SIGNALS = [
    "deploying container to cloud run",
    "deployment complete",
    "deploy complete",
    "release created",
    "created version",   # clasp
    "deployment id",     # clasp
]
# "Service [name] revision [name-00042] has been deployed" style lines need both halves.
OUTPUT_PAIRS = [("service [", "] revision")]

# Commands that are the proof step itself, dry runs, or read-only looks at a deploy.
SKIP_IF_COMMAND_HAS = [
    "verify-deploy", "execution-proof", "--dry-run", "--check-only", "rollout status",
    "services describe", "run services list", "--help", "migrate status",
]
# Output-only matches are ignored when the command is just reading or printing text.
READ_ONLY_FIRST_TOKENS = {
    "cat", "head", "tail", "less", "more", "grep", "rg", "egrep", "fgrep", "ag", "sed", "awk",
    "echo", "printf", "ls", "find", "fd", "bat", "wc", "diff", "jq",
}


def response_text(resp):
    """Flatten tool_response (a dict with stdout/stderr for Bash, or a plain string) to lowercase text."""
    parts = []
    if isinstance(resp, str):
        parts.append(resp)
    elif isinstance(resp, dict):
        for key in ("stdout", "stderr", "output", "content", "text"):
            val = resp.get(key)
            if isinstance(val, str):
                parts.append(val)
    elif isinstance(resp, list):
        for item in resp:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
    return "\n".join(parts)[:MAX_OUTPUT_CHARS].lower()


def strip_quoted(command):
    """Drop quoted strings so prose inside a commit message or echo cannot match a signature.
    `bash -c '...'` style wrappers are left intact because the command is inside the quotes."""
    if re.match(r"\s*(bash|sh|zsh)\s+-c\b", command):
        return command
    return re.sub(r"'[^']*'|\"[^\"]*\"", " ", command)


def first_token(command):
    m = re.match(r"\s*(?:\w+=\S+\s+)*([\w./-]+)", command)
    return os.path.basename(m.group(1)) if m else ""


def find_project_proof_script(cwd):
    """If the project ships its own verify/proof script, name it (the concrete proof artifact)."""
    patterns = ["verify-deploy.sh", "verify_deploy.sh", "scripts/verify-deploy.sh",
                "execution-proof.sh", "scripts/execution-proof.sh", "*/verify-deploy.sh"]
    for pat in patterns:
        for hit in glob.glob(os.path.join(cwd, pat)):
            if os.path.isfile(hit):
                return os.path.relpath(hit, cwd)
    return None


def emit(message):
    """Write the hook result. Nudge by default; block when KIT_PROOF_GATES=block."""
    if os.environ.get("KIT_PROOF_GATES", "").strip().lower() == "block":
        out = {"decision": "block", "reason": message}
    else:
        out = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": message}}
    print(json.dumps(out))


def main():
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError, ValueError):
        return
    if not isinstance(hook_input, dict) or hook_input.get("tool_name", "") != "Bash":
        return

    tool_input = hook_input.get("tool_input")
    if not isinstance(tool_input, dict):
        return
    raw_command = str(tool_input.get("command", ""))
    command = raw_command.lower()
    bare = strip_quoted(command)
    output_str = response_text(hook_input.get("tool_response"))

    if any(s in command for s in SKIP_IF_COMMAND_HAS):
        return

    matched_label = matched_proof = None
    for sig, label, proof in DEPLOY_SIGNATURES:
        if sig in bare:
            matched_label, matched_proof = label, proof
            break

    # Any project's own deploy wrapper (./deploy.sh, scripts/deploy.sh, bash prod-deploy.sh).
    if not matched_label and re.search(r"(^|[\s/])[\w.-]*deploy\.sh\b", bare):
        matched_label = "project deploy script"
        matched_proof = "hash a served file in the running target against your tree and confirm the routes resolve."

    if not matched_label and first_token(command) not in READ_ONLY_FIRST_TOKENS:
        if any(s in output_str for s in OUTPUT_SIGNALS) or \
           any(a in output_str and b in output_str for a, b in OUTPUT_PAIRS):
            matched_label = "a deploy"
            matched_proof = "capture a signal from the running target (HTTP response, row count, container hash), not just deploy success."

    if not matched_label:
        return

    cwd = hook_input.get("cwd") or os.getcwd()
    proof_script = find_project_proof_script(cwd)
    if proof_script:
        proof_line = (f"This project ships a proof script: run `./{proof_script}` and confirm it exits 0 "
                      f"before reporting shipped. ({matched_proof})")
    else:
        proof_line = (f"No project proof script found, so capture the artifact by hand: {matched_proof} "
                      "Consider adding a verify-deploy.sh to the repo so the proof is one command.")

    emit(
        f"MANDATORY DEPLOY PROOF ({matched_label}): do not report this as shipped, live, or working until "
        f"you have a proof artifact from the RUNNING system.\n{proof_line}\n\n"
        "A commit, a clean local tree, or an earlier note saying 'deployed' is a claim, not proof. When the "
        "same agent writes, fixes, and deploys, the running artifact is the only witness. "
        "If you cannot reach the target, say so: 'deployed, NOT verified against the running system.' "
        "Ref: rules/proof-before-claim.md."
    )


if __name__ == "__main__":
    main()
