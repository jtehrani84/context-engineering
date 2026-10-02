#!/bin/bash
# CLI Environment Check — Context Engineering kit
# Detects installed CLIs and recommends what to install for full kit value.
# Only git and python3 are required; setup.sh stops if either is missing.
#
# Usage: ./scripts/check-cli.sh [--quiet]
#   --quiet: only show missing/warnings, skip the full table

set -uo pipefail

QUIET=false
if [[ "${1:-}" == "--quiet" ]]; then
    QUIET=true
fi

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# Counters
REQUIRED_MISSING=0
RECOMMENDED_MISSING=0
OPTIONAL_MISSING=0

# --- Helper: check if a command exists and get version ---
check_cmd() {
    local cmd="$1"
    local version_flag="${2:---version}"
    local name="${3:-$cmd}"

    if command -v "$cmd" &>/dev/null; then
        local version
        version=$("$cmd" $version_flag 2>&1 | head -1 | sed 's/^[^0-9]*//' | cut -d' ' -f1 | cut -c1-20)
        echo "installed|$version"
    else
        echo "missing|"
    fi
}

# --- Print a row ---
print_row() {
    local status="$1"
    local name="$2"
    local version="$3"
    local purpose="$4"
    local tier="$5"

    if [[ "$status" == "installed" ]]; then
        if [[ "$QUIET" == false ]]; then
            printf "  ${GREEN}✓${NC} %-12s ${DIM}%-14s${NC} %s\n" "$name" "$version" "$purpose"
        fi
    else
        local color="$RED"
        [[ "$tier" == "recommended" ]] && color="$YELLOW"
        [[ "$tier" == "optional" ]] && color="$DIM"
        printf "  ${color}✗${NC} %-12s ${color}%-14s${NC} %s\n" "$name" "(missing)" "$purpose"
    fi
}

# --- Print install instructions ---
print_install() {
    local cmd="$1"
    local tier="$2"

    case "$cmd" in
        git)
            echo "      brew install git"
            ;;
        node)
            echo "      brew install node    # or: nvm install --lts"
            ;;
        python3)
            echo "      brew install python@3.12"
            ;;
        gh)
            echo "      brew install gh && gh auth login"
            ;;
        jq)
            echo "      brew install jq"
            ;;
        claude)
            echo "      npm install -g @anthropic-ai/claude-code"
            ;;
        docker)
            echo "      brew install --cask docker"
            ;;
    esac
}

# ═══════════════════════════════════════════════════
# TIER 1: REQUIRED — Kit won't function without these
# ═══════════════════════════════════════════════════

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  CLI Environment Check — Context Engineering                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${GREEN}Required${NC} — kit won't function without these:"
echo ""

REQUIRED_CMDS=(
    "git|--version|git|Version control, Claude Code dependency"
    "python3|--version|python3|Hook scripts, setup, review scripts"
)

REQUIRED_INSTALLS=()

for entry in "${REQUIRED_CMDS[@]}"; do
    IFS='|' read -r cmd flag name purpose <<< "$entry"
    result=$(check_cmd "$cmd" "$flag" "$name")
    status="${result%%|*}"
    version="${result##*|}"
    print_row "$status" "$name" "$version" "$purpose" "required"
    if [[ "$status" == "missing" ]]; then
        REQUIRED_MISSING=$((REQUIRED_MISSING + 1))
        REQUIRED_INSTALLS+=("$cmd")
    fi
done
echo ""

# ═══════════════════════════════════════════════════
# TIER 2: RECOMMENDED — most of the kit's value
# ═══════════════════════════════════════════════════

echo -e "${YELLOW}Recommended${NC} — install for full kit value:"
echo ""

RECOMMENDED_CMDS=(
    "node|--version|node|Voice engine, guards/, audit workflows (Node 18+)"
    "claude|--version|claude|Claude Code CLI (the morning digest cron calls it)"
    "gh|--version|gh|GitHub CLI: PRs, issues, the GitHub MCP server"
    "jq|--version|jq|JSON processing in scripts"
)

RECOMMENDED_INSTALLS=()

for entry in "${RECOMMENDED_CMDS[@]}"; do
    IFS='|' read -r cmd flag name purpose <<< "$entry"
    result=$(check_cmd "$cmd" "$flag" "$name")
    status="${result%%|*}"
    version="${result##*|}"
    print_row "$status" "$name" "$version" "$purpose" "recommended"
    if [[ "$status" == "missing" ]]; then
        RECOMMENDED_MISSING=$((RECOMMENDED_MISSING + 1))
        RECOMMENDED_INSTALLS+=("$cmd")
    fi
done
echo ""

# ═══════════════════════════════════════════════════
# TIER 3: OPTIONAL — Enables advanced features
# ═══════════════════════════════════════════════════

echo -e "${DIM}Optional${NC} — enables advanced features and integrations:"
echo ""

OPTIONAL_CMDS=(
    "docker|--version|docker|Containerized services, local dev"
)

OPTIONAL_INSTALLS=()

for entry in "${OPTIONAL_CMDS[@]}"; do
    IFS='|' read -r cmd flag name purpose <<< "$entry"
    result=$(check_cmd "$cmd" "$flag" "$name")
    status="${result%%|*}"
    version="${result##*|}"
    print_row "$status" "$name" "$version" "$purpose" "optional"
    if [[ "$status" == "missing" ]]; then
        OPTIONAL_MISSING=$((OPTIONAL_MISSING + 1))
        OPTIONAL_INSTALLS+=("$cmd")
    fi
done
echo ""

# ═══════════════════════════════════════════════════
# SUMMARY + INSTALL RECOMMENDATIONS
# ═══════════════════════════════════════════════════

echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"

TOTAL_MISSING=$((REQUIRED_MISSING + RECOMMENDED_MISSING + OPTIONAL_MISSING))

if [[ $TOTAL_MISSING -eq 0 ]]; then
    echo ""
    echo -e "  ${GREEN}All CLIs detected. Your environment is fully equipped.${NC}"
    echo ""
    exit 0
fi

# Show required installs first (blocking)
if [[ $REQUIRED_MISSING -gt 0 ]]; then
    echo ""
    echo -e "  ${RED}⚠ $REQUIRED_MISSING required CLI(s) missing — install before continuing:${NC}"
    echo ""
    for cmd in "${REQUIRED_INSTALLS[@]}"; do
        print_install "$cmd" "required"
    done
    echo ""
fi

# Show recommended installs (non-blocking but important)
if [[ $RECOMMENDED_MISSING -gt 0 ]]; then
    echo ""
    echo -e "  ${YELLOW}$RECOMMENDED_MISSING recommended CLI(s) missing — install for full kit value:${NC}"
    echo ""
    for cmd in "${RECOMMENDED_INSTALLS[@]}"; do
        print_install "$cmd" "recommended"
    done
    echo ""
fi

# Show optional installs (just informational)
if [[ $OPTIONAL_MISSING -gt 0 ]]; then
    echo ""
    echo -e "  ${DIM}$OPTIONAL_MISSING optional CLI(s) not found — install as needed:${NC}"
    echo ""
    for cmd in "${OPTIONAL_INSTALLS[@]}"; do
        print_install "$cmd" "optional"
    done
    echo ""
fi

# Feature mapping for missing recommended/optional
if [[ $RECOMMENDED_MISSING -gt 0 || $OPTIONAL_MISSING -gt 0 ]]; then
    echo -e "${CYAN}─────────────────────────────────────────────────────────────${NC}"
    echo ""
    echo -e "  ${CYAN}Skills unlocked by installing missing CLIs:${NC}"
    echo ""

    ALL_MISSING=("${RECOMMENDED_INSTALLS[@]+"${RECOMMENDED_INSTALLS[@]}"}" "${OPTIONAL_INSTALLS[@]+"${OPTIONAL_INSTALLS[@]}"}")
    for cmd in "${ALL_MISSING[@]}"; do
        case "$cmd" in
            node)
                echo "    node   → /voice-check engine, voice-tell-gate, guards/, /claim-audit and the other audit workflows"
                ;;
            claude)
                echo "    claude → the overnight morning digest (crons/synthesize)"
                ;;
            gh)
                echo "    gh     → GitHub MCP server, PR workflows, code search"
                ;;
            jq)
                echo "    jq     → JSON processing in your own scripts"
                ;;
            docker)
                echo "    docker → Local service development, MCP server hosting"
                ;;
        esac
    done
    echo ""
fi

# Exit code: 1 if required missing, 0 otherwise
if [[ $REQUIRED_MISSING -gt 0 ]]; then
    exit 1
else
    exit 0
fi
