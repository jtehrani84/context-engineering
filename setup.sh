#!/bin/bash
# Context Engineering Starter Kit — Setup Script
# Run this after cloning the repo to install the foundation.
#
# What it does:
#   1. Creates ~/.claude/ directory structure (won't overwrite existing)
#   2. Copies rules, hooks, and skill templates
#   3. Asks for your info to personalize CLAUDE.md
#   4. Wires hooks into settings
#
# Usage: ./setup.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE — no files will be written ==="
    echo ""
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Context Engineering Starter Kit — Setup          ║${NC}"
echo -e "${CYAN}║  From Day 0 to Day 5 in 30 minutes               ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# --- Step 1: Create directory structure ---
echo -e "${GREEN}[1/6]${NC} Creating directory structure..."

DIRS=(
    "$CLAUDE_DIR/rules"
    "$CLAUDE_DIR/hooks/scripts"
    "$CLAUDE_DIR/commands"
    "$CLAUDE_DIR/wiki"
    "$CLAUDE_DIR/wiki/people"
    "$CLAUDE_DIR/wiki/entities"
    "$CLAUDE_DIR/wiki/concepts"
    "$CLAUDE_DIR/wiki/projects"
    "$CLAUDE_DIR/wiki/tools"
    "$CLAUDE_DIR/wiki/events"
    "$CLAUDE_DIR/wiki/insights"
)

for dir in "${DIRS[@]}"; do
    if [[ "$DRY_RUN" == false ]]; then
        mkdir -p "$dir"
    fi
    echo "  + $dir"
done
echo ""

# --- Step 2: Copy rules ---
echo -e "${GREEN}[2/6]${NC} Installing rules..."

for rule_file in "$SCRIPT_DIR/rules/"*.md; do
    filename=$(basename "$rule_file")
    dest="$CLAUDE_DIR/rules/$filename"
    if [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}! $filename already exists — skipping${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then
            cp "$rule_file" "$dest"
        fi
        echo "  + $filename installed"
    fi
done
echo ""

# --- Step 3: Copy hooks ---
echo -e "${GREEN}[3/6]${NC} Installing hooks..."

for hook_file in "$SCRIPT_DIR/hooks/scripts/"*.py; do
    filename=$(basename "$hook_file")
    dest="$CLAUDE_DIR/hooks/scripts/$filename"
    if [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}! $filename already exists — skipping${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then
            cp "$hook_file" "$dest"
            chmod +x "$dest"
        fi
        echo "  + $filename installed"
    fi
done
echo ""

# --- Step 4: Copy skills ---
echo -e "${GREEN}[4/6]${NC} Installing skills..."

for skill_file in "$SCRIPT_DIR/skills/"*.md; do
    filename=$(basename "$skill_file")
    dest="$CLAUDE_DIR/commands/$filename"
    if [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}! $filename already exists — skipping${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then
            cp "$skill_file" "$dest"
        fi
        echo "  + $filename installed"
    fi
done
echo ""

# --- Step 5: Copy wiki templates ---
echo -e "${GREEN}[5/6]${NC} Setting up wiki..."

# Copy wiki templates
for wiki_file in "$SCRIPT_DIR/wiki/"*.md; do
    filename=$(basename "$wiki_file")
    dest="$CLAUDE_DIR/wiki/$filename"
    if [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}! wiki/$filename already exists — skipping${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then
            cp "$wiki_file" "$dest"
        fi
        echo "  + wiki/$filename"
    fi
done

# Copy people templates
for template in "$SCRIPT_DIR/wiki/people/"_template-*.md; do
    if [[ -f "$template" ]]; then
        filename=$(basename "$template")
        dest="$CLAUDE_DIR/wiki/people/$filename"
        if [[ ! -f "$dest" ]]; then
            if [[ "$DRY_RUN" == false ]]; then
                cp "$template" "$dest"
            fi
            echo "  + wiki/people/$filename"
        fi
    fi
done
echo ""

# --- Step 6: Personalization ---
echo -e "${GREEN}[6/6]${NC} Personalization..."
echo ""
echo "  To complete setup, open Claude Code and paste:"
echo ""
echo -e "  ${CYAN}Read ~/context-engineering/QUICKSTART-PROMPT.md and follow the instructions.${NC}"
echo ""
echo "  Claude will ask you 5 questions and build your personalized CLAUDE.md."
echo ""

# --- Summary ---
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo ""
echo "  Installed:"
echo "    - 4 rules files (communication, security, architecture, code-quality)"
echo "    - 6 hook scripts (session-init, guardrail, domain-verification, output-quality-gate, graph-auto-index, schema-check)"
echo "    - 21 skills (research-prep, strategy, draft, follow-up, and more)"
echo "    - Wiki structure with templates"
echo ""
echo "  Next steps:"
echo "    1. Open Claude Code in your project directory"
echo "    2. Paste: Read ~/context-engineering/QUICKSTART-PROMPT.md and follow the instructions."
echo "    3. Answer Claude's 5 questions"
echo "    4. Start using /research-prep before your next meeting"
echo ""
echo "  Optional: Set up overnight intelligence"
echo "    cd ~/context-engineering/crons && ./manage.sh install"
echo ""
echo "  Questions? -> github.com/jtehrani84/context-engineering/issues"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
