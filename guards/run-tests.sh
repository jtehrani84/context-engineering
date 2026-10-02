#!/usr/bin/env bash
# Runs every guards self-test. Needs node 18+ and python3. Exit 0 only if all pass.
set -u
cd "$(dirname "$0")"
rc=0
for t in *.test.mjs; do
  node "$t" || rc=1
done
python3 protect-paths.test.py || rc=1
# the canary and fuzz CLIs double as self-tests; --seed-fail must go RED (proof that it can fail)
node canary.mjs >/dev/null || rc=1
if node canary.mjs --seed-fail >/dev/null 2>&1; then echo "canary --seed-fail did NOT fail: the detector is vacuous"; rc=1; else echo "canary --seed-fail: goes red as expected"; fi
node fuzz.mjs >/dev/null || rc=1
[ $rc -eq 0 ] && echo "guards: ALL PASS" || echo "guards: FAILURES"
exit $rc
