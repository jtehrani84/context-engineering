#!/bin/bash
# Run every offline test suite the kit ships, and say plainly which ones failed.
#
#   bash scripts/test-all.sh          # everything (the hook self-test includes one 6-second case, and the voice
#                                     # onboarding suite takes about two minutes)
#   bash scripts/test-all.sh --fast   # skip those two
#
# Nothing here needs an account, a model endpoint, or the network, and nothing touches your ~/.claude: each suite
# uses a scratch HOME or a temp directory. Requires python3, node, git and bash.
#
# One vendored check is reported on its own line instead of counted as a failure: the upstream
# detector's categories.test.js also checks a README.md that lives in the upstream repo and isn't
# vendored here, so it fails the same way on every kit version. Its other checks still have to pass.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1
FAST=""
[[ "${1:-}" == "--fast" ]] && FAST="--fast"
LOG="$(mktemp -d /tmp/kit-test-all.XXXXXX)"
trap 'rm -rf "$LOG"' EXIT
PASSED=(); FAILED=()

suite() {
    local name="$1"; shift
    local out="$LOG/$(echo "$name" | tr ' /' '__').log"
    if (cd "$REPO" && "$@") > "$out" 2>&1; then
        PASSED+=("$name"); printf '  ok    %-42s %s\n' "$name" "$(tail -n 1 "$out" | tr -d '\033' | sed 's/\[[0-9;]*m//g' | cut -c1-70)"
    else
        FAILED+=("$name"); printf '  FAIL  %s\n' "$name"; tail -n 15 "$out" | sed 's/^/          /'
    fi
}

categories_known() {
    # Pass when every failure in categories.test.js is the missing upstream README.
    local out; out="$(cd tools/avoid-ai-writing/detector && node categories.test.js 2>&1)"
    local fails; fails="$(printf '%s\n' "$out" | grep -c '✗' || true)"
    local readme; readme="$(printf '%s\n' "$out" | grep -A1 '✗' | grep -c "avoid-ai-writing/README.md" || true)"
    echo "categories.test.js: $fails failing check(s), $readme of them the unvendored upstream README"
    [[ "$fails" -eq "$readme" ]]
}

echo "Kit test suites ($REPO)"
echo ""
suite "hooks/selftest.py"              python3 hooks/selftest.py $FAST
suite "hooks/tests/test_proof_gates.py" python3 hooks/tests/test_proof_gates.py
suite "scripts/test-workflows.mjs"     node scripts/test-workflows.mjs
suite "scripts/test-setup-upgrade.sh"  bash scripts/test-setup-upgrade.sh
suite "scripts/test-crons.sh"          bash scripts/test-crons.sh
suite "scripts/test-llm-scripts.py"    python3 scripts/test-llm-scripts.py
suite "tests/test_smaller_batch.py"    python3 -m unittest tests/test_smaller_batch.py
suite "guards/run-tests.sh"            bash guards/run-tests.sh
suite "detector patterns.test.js"      bash -c 'cd tools/avoid-ai-writing/detector && node patterns.test.js'
suite "detector validate.test.js"      bash -c 'cd tools/avoid-ai-writing/detector && node validate.test.js'
suite "detector categories (known)"    categories_known
suite "harness-eval runs"              node harness-evolution/harness-eval.mjs
# The voice engine, its send hook and the /voice-setup onboarding tools (tools/). The onboarding suite takes about two
# minutes, so --fast skips it.
suite "scripts/test-voice-kit.py"      python3 scripts/test-voice-kit.py
suite "tools/aiscore.test.mjs"         node tools/aiscore.test.mjs
suite "tools/text-normalize.test.mjs"  node tools/text-normalize.test.mjs
suite "tools/prose-gate.unit.test.mjs" node tools/prose-gate.unit.test.mjs
suite "tools/hook-tests (send hook)"   python3 tools/hook-tests/voice-tell-gate.test.py
if [[ -z "$FAST" ]]; then
    suite "tools/onboarding/test"      bash -c 'node --test tools/onboarding/test/*.test.mjs'
fi
suite "README tree is current"         python3 scripts/gen-readme-tree.py --check
suite "compound-loop example guardrail" python3 examples/compound-loop/test_guardrail_example.py

echo ""
echo "${#PASSED[@]} suites passed, ${#FAILED[@]} failed"
[[ ${#FAILED[@]} -eq 0 ]]
