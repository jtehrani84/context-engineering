#!/bin/bash
#
# Morning Digest Synthesizer
#
# Reads raw intelligence files from crons/raw/ (written by gather scripts)
# and synthesizes them into a structured wiki/inbox.md entry using Claude.
#
# Schedule: Daily at 5:00 AM (after gather scripts complete at 4:30-4:45)
#
# Prerequisites:
# - claude CLI installed and authenticated
# - Raw files exist in crons/raw/ from today
#
# Usage:
#   ./morning-digest.sh           # Process today's raw files
#   ./morning-digest.sh 2026-05-13  # Process a specific date

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_DIR="${SCRIPT_DIR}/../raw"
WIKI_INBOX="${HOME}/.claude/wiki/inbox.md"

# Use provided date or today
DATE="${1:-$(date +%Y-%m-%d)}"

echo "[$(date '+%H:%M:%S')] Starting morning digest for ${DATE}..."

# Find today's raw files
RAW_FILES=$(find "${RAW_DIR}" -name "*${DATE}*" -type f 2>/dev/null)

if [ -z "${RAW_FILES}" ]; then
    echo "[$(date '+%H:%M:%S')] No raw files found for ${DATE}. Skipping."
    exit 0
fi

# Count files found
FILE_COUNT=$(echo "${RAW_FILES}" | wc -l | tr -d ' ')
echo "[$(date '+%H:%M:%S')] Found ${FILE_COUNT} raw intelligence file(s)."

# Build the prompt with all raw file contents
PROMPT="You are synthesizing overnight intelligence into a morning brief.

Read the following raw intelligence files and produce a structured digest.

Rules:
- Extract only genuinely useful items (skip noise, duplicates, irrelevant)
- Categorize: Tools & Updates | Industry Trends | Community Discussion | Ecosystem
- Each item: one line with source attribution
- Flag anything requiring action with [ACTION] prefix
- Flag anything urgent (breaking change, deprecation) with [URGENT] prefix
- Maximum 15 items total. Quality over quantity.
- If nothing interesting was found, say so in one line.

Output format:
---
## Intelligence Digest: ${DATE}

### [Category]
- [Item summary] (Source: [where])

### Actions
- [ACTION items extracted, if any]
---

Raw files follow:

"

# Append each raw file's content
for f in ${RAW_FILES}; do
    FILENAME=$(basename "$f")
    PROMPT="${PROMPT}
--- ${FILENAME} ---
$(cat "$f")
"
done

# Ensure wiki inbox exists
mkdir -p "$(dirname "${WIKI_INBOX}")"
touch "${WIKI_INBOX}"

# Run Claude to synthesize
echo "[$(date '+%H:%M:%S')] Synthesizing with Claude..."
DIGEST=$(echo "${PROMPT}" | claude -p --output-format text 2>/dev/null)

if [ -z "${DIGEST}" ]; then
    echo "[$(date '+%H:%M:%S')] ERROR: Claude returned empty response."
    exit 1
fi

# Prepend to wiki inbox (newest first)
TEMP_FILE=$(mktemp)
echo "${DIGEST}" > "${TEMP_FILE}"
echo "" >> "${TEMP_FILE}"

if [ -s "${WIKI_INBOX}" ]; then
    cat "${WIKI_INBOX}" >> "${TEMP_FILE}"
fi

mv "${TEMP_FILE}" "${WIKI_INBOX}"

echo "[$(date '+%H:%M:%S')] Digest written to ${WIKI_INBOX}"
echo "[$(date '+%H:%M:%S')] Done."
