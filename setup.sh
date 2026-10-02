#!/bin/bash
# Context Engineering Starter Kit — Setup Script
# Run this after cloning the repo to install the foundation.
#
# What it does:
#   1. Creates ~/.claude/ directory structure (won't overwrite existing)
#   2. Copies rules, hooks, skill templates, and the voice engine + eval harness (tools/: the scorer, the
#      normalizer, the gate, the send hook's source and tests, the calibration harness and the /voice-setup
#      onboarding tools; the docs are in docs/voice/)
#   3. Wires hooks into settings (merge-safe and re-runnable, so upgrades pick up new hooks).
#      No ~/.claude/settings.json yet? It creates a minimal one.
#   4. Points you at the personalization prompt that builds your CLAUDE.md
#
# Safe to re-run after `git pull`: a rule, skill, hook, or tool you never edited is upgraded to the new
# version; one you edited is left alone (the prior-version hash lists are install-prior-hashes.txt and
# hooks/prior-kit-hashes.txt, rebuilt by scripts/gen-install-prior-hashes.py).
#
# Optional environment:
#   KIT_WIRE_PROOF_GATES=1    also wire the two opt-in prose proof gates (claim-faithfulness-gate,
#                             refutation-oracle-gate).
#   WIKI_DEST                 where --with-wiki copies the wiki skeleton (default ~/.claude/wiki).
#
# Usage: ./setup.sh [--dry-run] [--with-wiki] [--check] [--uninstall]
#
#   --check       Health check: what is installed, and whether the model endpoint that /review and
#                 /validate use (LLM_BASE_URL, LLM_API_KEY) is configured. Makes no network calls.
#
#   --with-wiki   Also copy the wiki skeleton (wiki/ plus templates/wiki/log.md) to
#                 ~/.claude/wiki, or to $WIKI_DEST if you set it. Never overwrites a file you already have.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
DRY_RUN=false
WITH_WIKI=false

# Colors (defined early for --check and --uninstall)
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

sha256_of() { python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }

# Hashes of every version of the rules/, skills/, tools/, harness-evolution/, workflows/ and llm-script
# files this kit has shipped (path sha256).
PRIOR_TREE_HASHES="$SCRIPT_DIR/install-prior-hashes.txt"

# is_prior_kit_version <repo-relative key> <installed file>: true when the installed copy is
# byte-identical to a version this kit shipped earlier, i.e. you never edited it.
is_prior_kit_version() {
    [[ -f "$PRIOR_TREE_HASHES" ]] && grep -qx "$1 $(sha256_of "$2")" "$PRIOR_TREE_HASHES"
}

# Files an earlier kit release installed and this one no longer ships (repo-relative keys, installed under
# ~/.claude/<key>). An unedited copy is removed on install and on --uninstall; one you edited is kept and reported.
#   tools/voice-setup.mjs, tools/voice-overlay.skeleton.mjs: replaced on 2026-10-02 by tools/onboarding/
#   (voice-doctor.mjs, profile-build.mjs, calibrate-user.mjs) and its blank overlay template.
RETIRED=(tools/voice-setup.mjs tools/voice-overlay.skeleton.mjs)

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --with-wiki) WITH_WIKI=true ;;
    esac
done

if [[ "$DRY_RUN" == true ]]; then
    echo "=== DRY RUN MODE — no files will be written ==="
    echo ""
fi

# --- Health Check Mode ---
if [[ "${1:-}" == "--check" ]]; then
    echo -e "${CYAN}Context Engineering Starter Kit — Health Check${NC}"
    echo ""
    FAIL=0

    # 1. ~/.claude/ directory
    if [[ -d "$CLAUDE_DIR" ]]; then
        echo -e "  ${GREEN}✓${NC} ~/.claude/ directory exists"
    else
        echo -e "  ${RED}✗${NC} ~/.claude/ directory missing"
        FAIL=1
    fi

    # 2. settings.json exists and is configured
    if [[ -f "$CLAUDE_DIR/settings.json" ]]; then
        if grep -qiE "apiKey|Key|model|permissions" "$CLAUDE_DIR/settings.json" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} ~/.claude/settings.json exists and is configured"
        else
            echo -e "  ${YELLOW}⚠${NC} ~/.claude/settings.json exists but looks empty or unconfigured"
        fi
    else
        echo -e "  ${RED}✗${NC} ~/.claude/settings.json missing"
        FAIL=1
    fi

    # 3. Hook scripts exist and are executable
    for hook_file in "$SCRIPT_DIR/hooks/scripts/"*.py; do
        filename=$(basename "$hook_file")
        dest="$CLAUDE_DIR/hooks/scripts/$filename"
        if [[ -x "$dest" ]]; then
            echo -e "  ${GREEN}✓${NC} Hook: $filename installed and executable"
        elif [[ -f "$dest" ]]; then
            echo -e "  ${YELLOW}⚠${NC} Hook: $filename installed but not executable"
        else
            echo -e "  ${RED}✗${NC} Hook: $filename not installed"
            FAIL=1
        fi
    done

    # 4. Voice engine. voice-tell-gate calls aiscore.mjs and text-normalize.mjs and fails closed without them:
    #    a send it can't score is denied, so a missing file blocks your send tools.
    voice_missing=()
    for f in aiscore.mjs text-normalize.mjs prose-gate.mjs onboarding/voice-doctor.mjs; do
        [[ -f "$CLAUDE_DIR/tools/$f" ]] || voice_missing+=("$f")
    done
    if [[ ${#voice_missing[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} Voice engine installed (~/.claude/tools); full check: node ~/.claude/tools/onboarding/voice-doctor.mjs"
    else
        echo -e "  ${YELLOW}⚠${NC} Voice engine incomplete, missing: ${voice_missing[*]}. Re-run ./setup.sh: voice-tell-gate denies a send it can't score"
    fi

    # 5. python3
    if command -v python3 &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} python3 available ($(python3 --version 2>&1))"
    else
        echo -e "  ${RED}✗${NC} python3 not found"
        FAIL=1
    fi

    # 5. git
    if command -v git &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} git available"
    else
        echo -e "  ${RED}✗${NC} git not found"
        FAIL=1
    fi

    # 6. Model endpoint for /review, /validate and tools/llm.mjs (optional; no network call here)
    if [[ -n "${LLM_BASE_URL:-}" && -n "${LLM_API_KEY:-}" ]]; then
        echo -e "  ${GREEN}✓${NC} Model endpoint configured (LLM_BASE_URL is set, LLM_API_KEY is set)"
    else
        echo -e "  ${YELLOW}⚠${NC} Model endpoint not configured: LLM_BASE_URL and LLM_API_KEY are not both set."
        echo "      /review and the second-lab read in /validate need them. See scripts/llm-call.py."
    fi

    echo ""
    if [[ $FAIL -eq 0 ]]; then
        echo -e "${GREEN}All critical checks passed.${NC}"
        exit 0
    else
        echo -e "${RED}Some critical checks failed. Run ./setup.sh to install missing components.${NC}"
        exit 1
    fi
fi

# --- Uninstall Mode ---
if [[ "${1:-}" == "--uninstall" ]]; then
    echo -e "${CYAN}Context Engineering Starter Kit — Uninstall${NC}"
    echo ""

    # Build list of files this kit would have installed
    FILES_TO_REMOVE=()

    # Rules and skills: remove only a copy that matches this kit's current or an earlier version.
    # A rule or skill you edited (or that merely shares a name with one of yours) is kept.
    for rule_file in "$SCRIPT_DIR/rules/"*.md; do
        filename=$(basename "$rule_file")
        target="$CLAUDE_DIR/rules/$filename"
        [[ -f "$target" ]] || continue
        if cmp -s "$rule_file" "$target" || is_prior_kit_version "rules/$filename" "$target"; then
            FILES_TO_REMOVE+=("$target")
        else
            echo -e "  ${YELLOW}⚠ keeping rules/$filename (you edited it)${NC}"
        fi
    done

    # Hooks: remove only the kit's current or an earlier kit version, never a hook you edited.
    for hook_file in "$SCRIPT_DIR/hooks/scripts/"*.py; do
        filename=$(basename "$hook_file")
        target="$CLAUDE_DIR/hooks/scripts/$filename"
        [[ -f "$target" ]] || continue
        if cmp -s "$hook_file" "$target"; then
            FILES_TO_REMOVE+=("$target")
        elif [[ -f "$SCRIPT_DIR/hooks/prior-kit-hashes.txt" ]] && \
             grep -qx "$filename $(sha256_of "$target")" "$SCRIPT_DIR/hooks/prior-kit-hashes.txt"; then
            FILES_TO_REMOVE+=("$target")
        else
            echo -e "  ${YELLOW}⚠ keeping $filename (you edited it)${NC}"
        fi
    done

    for skill_file in "$SCRIPT_DIR/skills/"*.md; do
        filename=$(basename "$skill_file")
        target="$CLAUDE_DIR/commands/$filename"
        [[ -f "$target" ]] || continue
        if cmp -s "$skill_file" "$target" || is_prior_kit_version "skills/$filename" "$target"; then
            FILES_TO_REMOVE+=("$target")
        else
            echo -e "  ${YELLOW}⚠ keeping commands/$filename (you edited it)${NC}"
        fi
    done

    # Voice engine + eval harness: only remove a file that is byte-identical to the kit's copy,
    # so a tool you wrote yourself that happens to share a name is never deleted.
    for tree in tools harness-evolution workflows scripts/llm-call.py scripts/llm-review.py scripts/review-prompts; do
        [[ -e "$SCRIPT_DIR/$tree" ]] || continue
        while IFS= read -r -d '' src; do
            rel="${src#"$SCRIPT_DIR"/}"
            target="$CLAUDE_DIR/$rel"
            if [[ -f "$target" ]] && cmp -s "$src" "$target"; then
                FILES_TO_REMOVE+=("$target")
            elif [[ -f "$target" ]] && is_prior_kit_version "$rel" "$target"; then
                FILES_TO_REMOVE+=("$target")
            fi
        done < <(find "$SCRIPT_DIR/$tree" -type f -print0)
    done

    # Files an earlier release installed and this one no longer ships: remove an unedited copy.
    for rel in "${RETIRED[@]}"; do
        target="$CLAUDE_DIR/$rel"
        if [[ -f "$target" ]] && is_prior_kit_version "$rel" "$target"; then
            FILES_TO_REMOVE+=("$target")
        fi
    done

    if [[ ${#FILES_TO_REMOVE[@]} -eq 0 ]]; then
        echo "  No starter kit files found in ~/.claude/. Nothing to remove."
        exit 0
    fi

    echo "  Files to remove:"
    for f in "${FILES_TO_REMOVE[@]}"; do
        echo "    $f"
    done
    echo ""
    echo "  Note: your wiki (~/.claude/wiki) and your voice folder (~/.claude/voice: samples, config, calibration"
    echo "  reports) are not touched. In ~/.claude/settings.json only the hook entries that run a kit hook removed"
    echo "  here are taken out (backed up first); the rest stays. An overlay you installed with /voice-setup"
    echo "  (~/.claude/tools/voice-overlay.mjs) differs from the kit's blank copy, so it is kept."
    echo ""

    read -p "  Remove these ${#FILES_TO_REMOVE[@]} files? (Y/n) " confirm
    if [[ "${confirm:-Y}" =~ ^[Yy]$ ]]; then
        for f in "${FILES_TO_REMOVE[@]}"; do
            rm "$f"
            echo -e "  ${GREEN}✓${NC} Removed: $f"
        done
        # A hook entry left pointing at a deleted script makes python3 exit 2, and Claude Code reads exit 2
        # from a PreToolUse hook as "block this tool call", so unwire the hooks whose files were just removed.
        if [[ -f "$CLAUDE_DIR/settings.json" ]]; then
            python3 "$SCRIPT_DIR/scripts/wire-hooks.py" "$CLAUDE_DIR/settings.json" --unwire-missing || true
        fi
        echo ""
        echo -e "${GREEN}Uninstall complete. ${#FILES_TO_REMOVE[@]} files removed.${NC}"
    else
        echo "  Cancelled. No files were removed."
    fi
    exit 0
fi

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Context Engineering Starter Kit — Setup     ║${NC}"
echo -e "${CYAN}║  From Day 0 to Day 5 in 30 minutes          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# --- Step 0: CLI environment check ---
echo -e "${GREEN}[0/7]${NC} Checking CLI environment..."
echo ""

if ! bash "$SCRIPT_DIR/scripts/check-cli.sh"; then
    echo ""
    echo -e "${RED}Required CLIs are missing. Install them and re-run setup.${NC}"
    echo ""
    exit 1
fi

echo ""

# --- Step 1: Create directory structure ---
echo -e "${GREEN}[1/7]${NC} Creating directory structure..."

DIRS=(
    "$CLAUDE_DIR/rules"
    "$CLAUDE_DIR/hooks/scripts"
    "$CLAUDE_DIR/commands"
    "$CLAUDE_DIR/tools"
    "$CLAUDE_DIR/harness-evolution"
    "$CLAUDE_DIR/workflows"
    "$CLAUDE_DIR/scripts"
)

for dir in "${DIRS[@]}"; do
    if [[ "$DRY_RUN" == false ]]; then
        mkdir -p "$dir"
    fi
    echo "  ✓ $dir"
done
echo ""

# --- Step 2: Copy rules ---
echo -e "${GREEN}[2/7]${NC} Installing rules..."

# install_or_upgrade <repo-relative key> <source file> <destination file> <label>
# New file: installed. Identical: left. An unedited copy of an earlier kit version: upgraded in place.
# Anything else is yours and is kept (the source path is printed so you can diff and merge by hand).
install_or_upgrade() {
    local key="$1" src="$2" dest="$3" label="$4"
    if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
        echo "  ✓ $label already current"
    elif [[ -f "$dest" ]] && is_prior_kit_version "$key" "$dest"; then
        if [[ "$DRY_RUN" == false ]]; then cp "$src" "$dest"; fi
        echo "  ✓ $label upgraded (was an unedited earlier kit version)"
    elif [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}⚠ $label exists and differs from every kit version (kept yours; compare with $src)${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then cp "$src" "$dest"; fi
        echo "  ✓ $label installed"
    fi
}

for rule_file in "$SCRIPT_DIR/rules/"*.md; do
    filename=$(basename "$rule_file")
    install_or_upgrade "rules/$filename" "$rule_file" "$CLAUDE_DIR/rules/$filename" "$filename"
done
echo ""

# --- Step 3: Copy hooks ---
echo -e "${GREEN}[3/7]${NC} Installing hooks..."

# An installed hook that is byte-identical to a hook version this kit shipped earlier is
# upgraded in place (you never edited it). Anything else is yours and is left alone.
PRIOR_HASHES="$SCRIPT_DIR/hooks/prior-kit-hashes.txt"

for hook_file in "$SCRIPT_DIR/hooks/scripts/"*.py; do
    filename=$(basename "$hook_file")
    dest="$CLAUDE_DIR/hooks/scripts/$filename"
    if [[ -f "$dest" ]] && cmp -s "$hook_file" "$dest"; then
        echo "  ✓ $filename already current"
    elif [[ -f "$dest" ]] && [[ -f "$PRIOR_HASHES" ]] && grep -qx "$filename $(sha256_of "$dest")" "$PRIOR_HASHES"; then
        if [[ "$DRY_RUN" == false ]]; then
            cp "$hook_file" "$dest"
            chmod +x "$dest"
        fi
        echo "  ✓ $filename upgraded (was an unedited earlier kit version)"
    elif [[ -f "$dest" ]]; then
        echo -e "  ${YELLOW}⚠ $filename exists and differs from every kit version (kept yours; compare with $hook_file)${NC}"
    else
        if [[ "$DRY_RUN" == false ]]; then
            cp "$hook_file" "$dest"
            chmod +x "$dest"
        fi
        echo "  ✓ $filename installed"
    fi
done
echo ""

# --- Step 4: Copy skills ---
echo -e "${GREEN}[4/7]${NC} Installing skills..."

# Same rule as rules: new installs, unedited earlier versions upgrade, your edits stay.
for skill_file in "$SCRIPT_DIR/skills/"*.md; do
    filename=$(basename "$skill_file")
    install_or_upgrade "skills/$filename" "$skill_file" "$CLAUDE_DIR/commands/$filename" "$filename"
done
echo ""

# --- Step 5: Voice engine + eval harness (the voice-tell-gate hook calls ~/.claude/tools/aiscore.mjs) ---
echo -e "${GREEN}[5/7]${NC} Installing the voice engine, eval harness, audit workflows, and model scripts..."

# tools/ = voice engine; harness-evolution/ = eval harness; workflows/ = the proof-family audit workflows
# (/claim-audit, /plan-audit, /execution-truth, /provenance-audit run them); the llm scripts + prompts back /review
# and /validate.
# An installed file that matches an earlier kit version (install-prior-hashes.txt) is upgraded in
# place; one you edited is kept. (Dry runs report counts but write nothing.)
for tree in tools harness-evolution workflows scripts/llm-call.py scripts/llm-review.py scripts/review-prompts; do
    [[ -e "$SCRIPT_DIR/$tree" ]] || continue
    installed=0; upgraded=0; current=0; kept=0
    while IFS= read -r -d '' src; do
        rel="${src#"$SCRIPT_DIR"/}"
        dest="$CLAUDE_DIR/$rel"
        if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
            current=$((current + 1))
        elif [[ -f "$dest" ]] && is_prior_kit_version "$rel" "$dest"; then
            # an unedited copy of an earlier kit version: safe to upgrade in place
            if [[ "$DRY_RUN" == false ]]; then cp "$src" "$dest"; fi
            upgraded=$((upgraded + 1))
        elif [[ -f "$dest" ]]; then
            kept=$((kept + 1))
        else
            if [[ "$DRY_RUN" == false ]]; then
                mkdir -p "$(dirname "$dest")"
                cp "$src" "$dest"
            fi
            installed=$((installed + 1))
        fi
    done < <(find "$SCRIPT_DIR/$tree" -type f -print0)
    echo "  ✓ $tree: $installed installed, $upgraded upgraded, $current already current, $kept kept yours (edited)"
done
for rel in "${RETIRED[@]}"; do
    dest="$CLAUDE_DIR/$rel"
    [[ -f "$dest" ]] || continue
    if is_prior_kit_version "$rel" "$dest"; then
        if [[ "$DRY_RUN" == false ]]; then rm "$dest"; fi
        echo "  ✓ removed $rel (an earlier kit release shipped it; tools/onboarding/ replaces it)"
    else
        echo -e "  ${YELLOW}⚠ kept $rel: this release no longer ships it and you edited it; nothing reads it now${NC}"
    fi
done
# An overlay you edited before 2026-10-02 is kept, but it has the old interface: aiscore and the send hook read it,
# while prose-gate.mjs needs VERDICT_STRUCT_TYPES, which only the new template defines.
OVERLAY="$CLAUDE_DIR/tools/voice-overlay.mjs"
if [[ -f "$OVERLAY" ]] && ! grep -q "VERDICT_STRUCT_TYPES" "$OVERLAY"; then
    echo -e "  ${YELLOW}⚠ ~/.claude/tools/voice-overlay.mjs is your edited overlay in the old format. aiscore and the send hook${NC}"
    echo -e "  ${YELLOW}  still read it; prose-gate.mjs won't load until it defines VERDICT_STRUCT_TYPES. Run /voice-setup to${NC}"
    echo -e "  ${YELLOW}  build a reviewed overlay from the new template (your word and phrase lists carry over by hand).${NC}"
fi
echo ""

# --- Step 6: Wire hooks into settings.json (merge-safe, idempotent, safe to re-run on upgrade) ---
echo -e "${GREEN}[6/7]${NC} Wiring hooks into settings.json..."

SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [[ ! -f "$SETTINGS_FILE" ]]; then
    if [[ "$DRY_RUN" == false ]]; then
        echo '{}' > "$SETTINGS_FILE"
        echo "  ✓ No settings.json found, so a minimal one was created (add your model and env settings later)"
    else
        echo "  [dry-run] Would create a minimal settings.json"
    fi
fi
if [[ -f "$SETTINGS_FILE" ]]; then
    # scripts/wire-hooks.py adds any hook that isn't wired yet, rewrites an old flat-format entry into the
    # format Claude Code reads, and moves a hook to its new matcher when you still have the matcher an
    # earlier kit version shipped. A matcher you changed yourself is kept. Everything else in your
    # settings.json (auth key, model, permissions, other hooks) is left as is.
    if [[ "$DRY_RUN" == false ]]; then
        if python3 "$SCRIPT_DIR/scripts/wire-hooks.py" "$SETTINGS_FILE"; then
            echo "  ✓ Hooks wired into settings.json (auth key preserved)"
            if [[ -z "${KIT_WIRE_PROOF_GATES:-}" ]]; then
                echo "  Optional: claim-faithfulness-gate and refutation-oracle-gate are installed but not wired."
                echo "            Turn them on with: KIT_WIRE_PROOF_GATES=1 ./setup.sh"
            fi
        else
            echo -e "  ${YELLOW}⚠ Could not auto-wire hooks. Wire them manually from settings.json.example${NC}"
        fi
    else
        python3 "$SCRIPT_DIR/scripts/wire-hooks.py" "$SETTINGS_FILE" --dry-run || true
    fi
fi
echo ""

# --- Optional: wiki skeleton (only with --with-wiki) ---
if [[ "$WITH_WIKI" == true ]]; then
    echo -e "${GREEN}[opt]${NC} Installing the wiki skeleton..."

    WIKI_DEST="${WIKI_DEST:-$CLAUDE_DIR/wiki}"
    wiki_installed=0; wiki_kept=0

    # Copies one file unless something already exists at the destination. Your pages are never overwritten.
    install_wiki_file() {
        local src="$1" dest="$2"
        if [[ -e "$dest" ]]; then
            wiki_kept=$((wiki_kept + 1))
        else
            if [[ "$DRY_RUN" == false ]]; then
                mkdir -p "$(dirname "$dest")"
                cp "$src" "$dest"
            fi
            wiki_installed=$((wiki_installed + 1))
        fi
    }

    while IFS= read -r -d '' src; do
        install_wiki_file "$src" "$WIKI_DEST/${src#"$SCRIPT_DIR"/wiki/}"
    done < <(find "$SCRIPT_DIR/wiki" -type f -print0)
    install_wiki_file "$SCRIPT_DIR/templates/wiki/log.md" "$WIKI_DEST/log.md"

    echo "  ✓ $WIKI_DEST: $wiki_installed installed, $wiki_kept already there (kept yours)"
    echo "  Read $WIKI_DEST/README.md for the layout and the local-only page convention."
    echo ""
fi

# --- Step 7: Personalization ---
echo -e "${GREEN}[7/7]${NC} Personalization..."
echo ""
echo "  To complete setup, open Claude Code and paste:"
echo ""
echo -e "  ${CYAN}Read ~/context-engineering/QUICKSTART-PROMPT.md and follow the instructions.${NC}"
echo ""
echo "  Claude will ask you 5 questions and write your personalized CLAUDE.md. The rules, hooks and skills"
echo "  are already installed by this script, so it won't recreate them."
echo ""

# --- Summary ---
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo ""
echo "  Installed:"
echo "    • Rules, hook scripts, and skills copied to ~/.claude/"
echo "    • Voice engine + eval harness copied to ~/.claude/tools and ~/.claude/harness-evolution"
echo "    • Audit workflows copied to ~/.claude/workflows (used by /claim-audit, /plan-audit, /execution-truth, /provenance-audit)"
echo "    • Hooks wired into settings.json (auth key preserved), including voice-tell-gate on file writes (nudges)"
echo "      and on send tools (blocks a send with a hard tell, and any send it can't score)"
if [[ "$WITH_WIKI" == true ]]; then
    echo "    • Wiki skeleton copied to ${WIKI_DEST:-$CLAUDE_DIR/wiki}"
fi
echo ""
echo "  Next steps:"
echo "    1. Open Claude Code in your project directory"
echo "    2. Paste: Read ~/context-engineering/QUICKSTART-PROMPT.md and follow the instructions."
echo "    3. Answer Claude's 5 questions"
echo "    4. Start using /research-prep before your next meeting"
echo "    5. Calibrate the voice guard to YOU: type /voice-setup in Claude Code (see VOICE-ONBOARDING.md and docs/voice/)"
echo "    6. Want /review and the second read in /validate? Set LLM_BASE_URL and LLM_API_KEY (see scripts/llm-call.py)"
if [[ "$WITH_WIKI" == false ]]; then
    echo "    7. Want the wiki skeleton (index, log, inbox, people templates)? Re-run: ./setup.sh --with-wiki"
fi
echo ""
echo "  Optional: overnight intelligence crons (macOS launchd): cd crons && ./manage.sh install"
echo ""
echo "  Questions? → github.com/jtehrani84/context-engineering/issues"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
