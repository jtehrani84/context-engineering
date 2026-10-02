#!/bin/bash
#
# Cron Manager — Install, uninstall, status, and test launchd agents (macOS)
#
# This manages the overnight intelligence gathering and synthesis pipeline.
# On macOS, we use launchd (not cron) for scheduled tasks.
#
# Usage:
#   ./manage.sh install    # Install all plists to ~/Library/LaunchAgents/
#   ./manage.sh install --with-backup   # ...and also the local session backup (opt-in)
#   ./manage.sh uninstall  # Remove all plists and unload agents
#   ./manage.sh status     # Show status of all agents
#   ./manage.sh test       # Run gather + synthesize once (dry run)
#   ./manage.sh logs       # Show recent log output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_DIR="${SCRIPT_DIR}/plists"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"

# All plist files managed by this script
PLIST_FILES=(
    "com.context.gather.web.plist"
    "com.context.gather.hn.plist"
    "com.context.gather.github.plist"
    "com.context.synthesize.morning.plist"
    "com.context.curate-prep.plist"
)

# Opt-in jobs. `install --with-backup` adds these; `uninstall` and `status` always cover them.
# The backup keeps a second copy of every session transcript, so it never turns on by default.
OPTIONAL_PLIST_FILES=(
    "com.context.session-backup.plist"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

is_optional() {
    case " ${OPTIONAL_PLIST_FILES[*]} " in
        *" $1 "*) return 0 ;;
    esac
    return 1
}

print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cmd_install() {
    echo "Installing launchd agents..."
    mkdir -p "${LAUNCH_AGENTS_DIR}"

    to_install=("${PLIST_FILES[@]}")
    if [ "${1:-}" = "--with-backup" ]; then
        to_install+=("${OPTIONAL_PLIST_FILES[@]}")
    fi

    for plist in "${to_install[@]}"; do
        src="${PLIST_DIR}/${plist}"
        dst="${LAUNCH_AGENTS_DIR}/${plist}"

        if [ ! -f "${src}" ]; then
            print_warning "Plist not found: ${src} — skipping"
            continue
        fi

        # Update paths in plist to match the actual install location and your home directory
        sed -e "s|__SCRIPT_DIR__|${SCRIPT_DIR}|g" -e "s|__HOME__|${HOME}|g" "${src}" > "${dst}"

        # Load the agent
        launchctl load "${dst}" 2>/dev/null || true
        print_status "Installed: ${plist}"
        if grep -q "YOUR_EXA_API_KEY_HERE" "${dst}"; then
            print_warning "${plist} still has the placeholder Exa key. Put your key in ${src} and re-run install."
        fi
    done

    echo ""
    echo "All agents installed. They will run on their configured schedules."
    echo "Run './manage.sh status' to verify."
}

cmd_uninstall() {
    echo "Uninstalling launchd agents..."

    for plist in "${PLIST_FILES[@]}" "${OPTIONAL_PLIST_FILES[@]}"; do
        dst="${LAUNCH_AGENTS_DIR}/${plist}"

        if [ -f "${dst}" ]; then
            launchctl unload "${dst}" 2>/dev/null || true
            rm -f "${dst}"
            print_status "Removed: ${plist}"
        else
            is_optional "${plist}" || print_warning "Not installed: ${plist}"
        fi
    done

    echo ""
    echo "All agents removed."
}

cmd_status() {
    echo "Launchd Agent Status:"
    echo "====================="
    echo ""

    for plist in "${PLIST_FILES[@]}" "${OPTIONAL_PLIST_FILES[@]}"; do
        label="${plist%.plist}"
        dst="${LAUNCH_AGENTS_DIR}/${plist}"

        if [ ! -f "${dst}" ]; then
            is_optional "${plist}" && continue   # opt-in job you never turned on: say nothing
            echo -e "  ${RED}NOT INSTALLED${NC}  ${label}"
            continue
        fi

        # Check if loaded
        if launchctl list | grep -q "${label}" 2>/dev/null; then
            # Get exit status
            exit_status=$(launchctl list | grep "${label}" | awk '{print $2}')
            if [ "${exit_status}" = "0" ] || [ "${exit_status}" = "-" ]; then
                echo -e "  ${GREEN}LOADED${NC}         ${label} (last exit: ${exit_status})"
            else
                echo -e "  ${YELLOW}LOADED (ERR)${NC}  ${label} (last exit: ${exit_status})"
            fi
        else
            echo -e "  ${YELLOW}NOT LOADED${NC}    ${label} (installed but not active)"
        fi
    done

    echo ""

    # Show last run times from raw directory
    echo "Recent raw files:"
    if [ -d "${SCRIPT_DIR}/raw" ]; then
        ls -lt "${SCRIPT_DIR}/raw/" 2>/dev/null | head -5
    else
        echo "  (no raw directory yet — agents haven't run)"
    fi
}

cmd_test() {
    echo "Running gather + synthesize pipeline (test mode)..."
    echo ""

    # Run gather scripts
    echo "=== Web Scan ==="
    if [ -f "${SCRIPT_DIR}/gather/web-scan.py" ]; then
        python3 "${SCRIPT_DIR}/gather/web-scan.py" && print_status "Web scan complete" || print_error "Web scan failed"
    else
        print_warning "web-scan.py not found"
    fi

    echo ""
    echo "=== HN Scan ==="
    if [ -f "${SCRIPT_DIR}/gather/hn-scan.py" ]; then
        python3 "${SCRIPT_DIR}/gather/hn-scan.py" && print_status "HN scan complete" || print_error "HN scan failed"
    else
        print_warning "hn-scan.py not found"
    fi

    echo ""
    echo "=== GitHub Scan ==="
    if [ -f "${SCRIPT_DIR}/gather/github-scan.py" ]; then
        python3 "${SCRIPT_DIR}/gather/github-scan.py" && print_status "GitHub scan complete" || print_error "GitHub scan failed"
    else
        print_warning "github-scan.py not found"
    fi

    echo ""
    echo "=== Synthesis ==="
    if [ -f "${SCRIPT_DIR}/synthesize/morning-digest.sh" ]; then
        bash "${SCRIPT_DIR}/synthesize/morning-digest.sh" && print_status "Synthesis complete" || print_error "Synthesis failed"
    else
        print_warning "morning-digest.sh not found"
    fi

    echo ""
    echo "Test complete. Check crons/raw/ for output."
}

cmd_logs() {
    echo "Recent launchd logs:"
    echo ""

    LOG_DIR="${HOME}/Library/Logs/context-crons"
    if [ -d "${LOG_DIR}" ]; then
        for logfile in "${LOG_DIR}"/*.log; do
            if [ -f "${logfile}" ]; then
                echo "=== $(basename "${logfile}") ==="
                tail -20 "${logfile}"
                echo ""
            fi
        done
    else
        echo "No log directory found at ${LOG_DIR}"
        echo "Logs will appear after the first scheduled run."
    fi
}

# Main dispatch
case "${1:-help}" in
    install)
        cmd_install "${2:-}"
        ;;
    uninstall)
        cmd_uninstall
        ;;
    status)
        cmd_status
        ;;
    test)
        cmd_test
        ;;
    logs)
        cmd_logs
        ;;
    *)
        echo "Context Engineering — Cron Manager"
        echo ""
        echo "Usage: ./manage.sh <command>"
        echo ""
        echo "Commands:"
        echo "  install    Install launchd agents (macOS scheduled tasks)"
        echo "             add --with-backup to also schedule the local session backup"
        echo "  uninstall  Remove all agents"
        echo "  status     Show agent status and recent runs"
        echo "  test       Run the full pipeline once (gather + synthesize)"
        echo "  logs       Show recent log output"
        echo ""
        echo "The pipeline:"
        echo "  4:30 AM  — web-scan.py gathers web intelligence (Exa)"
        echo "  4:45 AM  — hn-scan.py gathers practitioner sentiment"
        echo "  4:50 AM  — github-scan.py tracks releases and trending repos"
        echo "  5:00 AM  — morning-digest.sh synthesizes into wiki/inbox.md"
        echo ""
        echo "  Sun 11:00 PM — curate-prep.py writes CURATE-PENDING.md for /curate (read-only)"
        echo "  Opt-in (install --with-backup): 12:30 PM and 10:30 PM — backup-sessions.sh mirrors ~/.claude/projects (local only)"
        echo ""
        echo "Your first /morning-brief of the day reads the digest."
        echo ""
        echo "Before the first run: put your Exa key in the web plist, and make"
        echo "sure the claude CLI is in one of the PATH directories listed in the synthesize plist."
        ;;
esac
