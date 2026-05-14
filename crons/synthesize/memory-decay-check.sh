#!/bin/bash
#
# Memory Decay Check — Weekly staleness detection
#
# Finds memory files unchanged for >45 days and reports them.
# These may be outdated and could mislead future sessions.
#
# Schedule: Weekly (Sunday at 6:00 AM)
#
# Usage:
#   ./memory-decay-check.sh              # Check default locations
#   ./memory-decay-check.sh /path/to/memory  # Check specific directory

set -euo pipefail

MEMORY_DIR="${1:-${HOME}/.claude}"
THRESHOLD_DAYS=45
WIKI_INBOX="${HOME}/.claude/wiki/inbox.md"

echo "[$(date '+%H:%M:%S')] Memory decay check (threshold: ${THRESHOLD_DAYS} days)..."

# Find stale memory files
STALE_FILES=$(find "${MEMORY_DIR}" -path "*/memory/*.md" -type f -mtime "+${THRESHOLD_DAYS}" 2>/dev/null | grep -v "MEMORY.md" | sort)

if [ -z "${STALE_FILES}" ]; then
    echo "[$(date '+%H:%M:%S')] No stale memory files found. All healthy."
    exit 0
fi

STALE_COUNT=$(echo "${STALE_FILES}" | wc -l | tr -d ' ')
echo "[$(date '+%H:%M:%S')] Found ${STALE_COUNT} memory file(s) older than ${THRESHOLD_DAYS} days."

# Build report
REPORT="## Memory Decay Alert: $(date +%Y-%m-%d)

${STALE_COUNT} memory file(s) unchanged for ${THRESHOLD_DAYS}+ days. Review during next /curate:

"

while IFS= read -r file; do
    BASENAME=$(basename "$file")
    MODIFIED=$(stat -f "%Sm" -t "%Y-%m-%d" "$file" 2>/dev/null || stat -c "%y" "$file" 2>/dev/null | cut -d' ' -f1)
    REPORT="${REPORT}- \`${BASENAME}\` — last modified: ${MODIFIED}
"
done <<< "${STALE_FILES}"

REPORT="${REPORT}
[ACTION] Run /curate to review and update or archive these files.
"

# Append to wiki inbox
mkdir -p "$(dirname "${WIKI_INBOX}")"
echo "${REPORT}" >> "${WIKI_INBOX}"

echo "[$(date '+%H:%M:%S')] Report appended to ${WIKI_INBOX}"
echo "[$(date '+%H:%M:%S')] Done."
