#!/bin/bash
# Test the overnight cron set without scheduling anything on your machine.
#
#   bash scripts/test-crons.sh
#
# Uses a scratch HOME and a stub `launchctl` and `claude`, so nothing is loaded into launchd and no model is called.
# Proves: the five default plists install (the opt-in session backup does not), their placeholders resolve,
# their schedules are what the docs say, install warns about the placeholder Exa key, the digest script
# turns raw gather files into wiki/inbox.md, and uninstall removes everything.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d /tmp/kit-crons-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1   [$2]"; fi; }

export HOME="$TMP/home"
mkdir -p "$HOME" "$TMP/bin"
cp -R "$REPO/crons" "$TMP/crons"

# stubs: launchctl records its calls; claude answers with a fixed digest
cat > "$TMP/bin/launchctl" <<'EOF'
#!/bin/bash
echo "$@" >> "$HOME/launchctl.calls"
[ "$1" = "list" ] && cat "$HOME/launchctl.loaded" 2>/dev/null
exit 0
EOF
cat > "$TMP/bin/claude" <<'EOF'
#!/bin/bash
cat > /dev/null
printf '## Intelligence Digest: test\n\n### Ecosystem\n- stub item (Source: stub)\n'
EOF
chmod +x "$TMP/bin/launchctl" "$TMP/bin/claude"
export PATH="$TMP/bin:$PATH"

echo "== plist files"
PLISTS=(com.context.gather.web com.context.gather.hn com.context.gather.github com.context.synthesize.morning com.context.curate-prep)
for p in "${PLISTS[@]}"; do
    check "$p.plist exists" "[[ -f '$REPO/crons/plists/$p.plist' ]]"
    if command -v plutil >/dev/null 2>&1; then
        check "$p.plist is valid" "plutil -lint '$REPO/crons/plists/$p.plist' >/dev/null"
    fi
    check "$p.plist Label matches the filename" "grep -q '<string>$p</string>' '$REPO/crons/plists/$p.plist'"
    check "$p.plist has exactly one StartCalendarInterval" "[[ \$(grep -c '<key>StartCalendarInterval</key>' '$REPO/crons/plists/$p.plist') -eq 1 ]]"
done
sched() { python3 -c "import plistlib,sys; d=plistlib.load(open(sys.argv[1],'rb'))['StartCalendarInterval']; print(d['Hour'], d['Minute'])" "$1"; }
check "web runs at 4:30" "[[ \"\$(sched '$REPO/crons/plists/com.context.gather.web.plist')\" == '4 30' ]]"
check "github runs at 4:50" "[[ \"\$(sched '$REPO/crons/plists/com.context.gather.github.plist')\" == '4 50' ]]"
check "hn runs at 4:45" "[[ \"\$(sched '$REPO/crons/plists/com.context.gather.hn.plist')\" == '4 45' ]]"
check "digest runs at 5:00" "[[ \"\$(sched '$REPO/crons/plists/com.context.synthesize.morning.plist')\" == '5 0' ]]"
check "curate-prep runs at 23:00" "[[ \"\$(sched '$REPO/crons/plists/com.context.curate-prep.plist')\" == '23 0' ]]"

echo; echo "== manage.sh install"
bash "$TMP/crons/manage.sh" install > "$TMP/install.log" 2>&1
for p in "${PLISTS[@]}"; do
    check "$p installed to LaunchAgents" "[[ -f '$HOME/Library/LaunchAgents/$p.plist' ]]"
    check "$p was loaded" "grep -q 'load .*$p.plist' '$HOME/launchctl.calls'"
    check "$p: no unresolved placeholders" "! grep -q '__SCRIPT_DIR__\|__HOME__' '$HOME/Library/LaunchAgents/$p.plist'"
done
check "install reported no missing plists" "! grep -q 'not found' '$TMP/install.log'"
check "install warns that the Exa key is still the placeholder" "grep -q 'placeholder Exa key' '$TMP/install.log'"
check "opt-in session backup is not installed without --with-backup" "[[ ! -f '$HOME/Library/LaunchAgents/com.context.session-backup.plist' ]]"
if command -v plutil >/dev/null 2>&1; then
    for p in "${PLISTS[@]}"; do
        check "installed $p.plist is still valid" "plutil -lint '$HOME/Library/LaunchAgents/$p.plist' >/dev/null"
    done
fi
check "digest plist PATH includes ~/.local/bin (where claude usually lives)" "grep -q '$HOME/.local/bin' '$HOME/Library/LaunchAgents/com.context.synthesize.morning.plist'"
check "digest plist points at the real script" "grep -q '$TMP/crons/synthesize/morning-digest.sh' '$HOME/Library/LaunchAgents/com.context.synthesize.morning.plist' && [[ -f '$TMP/crons/synthesize/morning-digest.sh' ]]"
check "hn plist points at the real script" "grep -q '$TMP/crons/gather/hn-scan.py' '$HOME/Library/LaunchAgents/com.context.gather.hn.plist' && [[ -f '$TMP/crons/gather/hn-scan.py' ]]"

echo; echo "== morning-digest.sh turns raw files into wiki/inbox.md"
TODAY=$(date +%Y-%m-%d)
mkdir -p "$TMP/crons/raw"
echo "# web raw" > "$TMP/crons/raw/web-$TODAY.md"
echo "# hn raw"  > "$TMP/crons/raw/hn-$TODAY.md"
bash "$TMP/crons/synthesize/morning-digest.sh" > "$TMP/digest.log" 2>&1
check "digest script exited cleanly and found both raw files" "grep -q 'Found 2 raw' '$TMP/digest.log'"
check "digest written to ~/.claude/wiki/inbox.md" "grep -q 'stub item' '$HOME/.claude/wiki/inbox.md'"
bash "$TMP/crons/synthesize/morning-digest.sh" 2000-01-01 > "$TMP/digest-none.log" 2>&1
check "no raw files for a date -> skips quietly, exit 0" "[[ \$? -eq 0 ]] && grep -q 'Skipping' '$TMP/digest-none.log'"

echo; echo "== manage.sh uninstall"
bash "$TMP/crons/manage.sh" uninstall > "$TMP/uninstall.log" 2>&1
for p in "${PLISTS[@]}"; do
    check "$p removed" "[[ ! -f '$HOME/Library/LaunchAgents/$p.plist' ]]"
done

echo; echo "== $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
