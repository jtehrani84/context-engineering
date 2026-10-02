Weekly knowledge base maintenance. Surfaces stale memories, processes inbox, archives old items. Takes 5 minutes.

Run this when knowledge base needs maintenance, or weekly as a habit.

### Step 0: Use the pre-computed analysis if it is fresh

If you installed the weekly prep job (`crons/manage.sh install` adds `com.context.curate-prep`, Sunday 11:00 PM), it writes `~/.claude/crons/curate-prep/CURATE-PENDING.md`: the orphan list, the stale-candidate table, the MEMORY.md line budget, and the wiki index check, already done.

**First, check for it.** If the file exists and is under 7 days old, read it and use its analysis in place of the cold scans in Steps 1, 4, and 5. Then go straight to the review steps (Step 3 inbox, Step 7 decisions). The prep job is read-only. It never deletes or edits anything, so every destructive call is still yours, made in this run. If the file begins `CURATE-PENDING: FAILED`, the job errored. Say so, then do the full cold scan below.

If the file is missing or older than 7 days, do the full cold scan as normal. Use direct tools (Read, Grep, Bash) for this workflow. Summarizing tools drop the exact dates and counts curate depends on.

## Curate Workflow

### Step 1: Memory Staleness Scan

Read all `.md` files in `~/.claude/projects/[YOUR-PROJECT-PATH]/memory/` (skip MEMORY.md).

For each file, check:
- **Frontmatter `last_verified` date** (under `metadata:`) — flag if missing or older than 30 days
- **Frontmatter `type`** (under `metadata:`; older files may have it at the top level) — session logs (`type: project` with "Session" in name) older than 14 days are candidates for archiving
- **File modification time** — files untouched for 60+ days are likely stale

Categorize by decay rate:
- **Fast decay** (session logs, deployment status, build status): stale after 14 days
- **Medium decay** (project state, ongoing work): stale after 30 days
- **Slow decay** (feedback, decisions, user preferences): stale after 90 days
- **Permanent** (reference, credentials, architecture patterns): flag only if explicitly outdated

Present findings as a table:
```
| File | Type | Age | Decay | Recommendation |
|------|------|-----|-------|----------------|
| session-04-05-... | project/session | 10d | fast | archive |
| feedback-... | feedback | 45d | slow | keep |
```

### Step 2: Tier 2→3 Promotion Scan

Check recent session files (`session-*` memories from the last 30 days) for facts or patterns that recur across 3+ sessions but have no dedicated memory file.

For each session file:
1. Extract key facts, decisions, and patterns mentioned
2. Cross-reference against other session files and existing memory files
3. Flag any fact that appears in 3+ sessions without a dedicated `feedback`, `user`, or `project` memory

Present candidates as a table:
```
| Recurring Fact | Sessions Found In | Existing Memory? | Recommendation |
|---------------|-------------------|-----------------|----------------|
| "always run X before Y" | 04-15, 04-17, 04-21 | No | promote → feedback |
| "project Z deadline June" | 04-14, 04-17 | No | skip (only 2) |
```

For each candidate meeting the 3-session threshold, ask: **promote** (create a dedicated memory file) / **skip** (not worth persisting).

Process promotions immediately — create the memory file, add to MEMORY.md index.

*Promotion criteria: only promote session observations to durable memory when they represent lasting truths, not ephemeral states.*

### Step 3: Inbox Processing

Read `~/[YOUR-PROJECT]/wiki/inbox.md`. For each item:
1. Present the item with a one-line summary
2. Ask: **create page** / **update existing page** / **discard**
3. Process the decision immediately
4. Remove processed items from inbox.md

If inbox.md is empty or doesn't exist, skip this step.

### Step 4: MEMORY.md Health

Read `~/.claude/projects/[YOUR-PROJECT-PATH]/memory/MEMORY.md`:
1. Count lines — warn if over 180 (limit is 200)
2. Identify entries that could be consolidated (multiple entries for same topic)
3. Identify entries for completed/archived projects that could be compressed
4. Suggest specific line reductions with before/after

### Step 5: Wiki Health (Quick)

Run a lightweight version of /wiki-lint:
1. Count total wiki pages vs. `wiki/index.md` entries — flag mismatches
2. Check for files in `wiki/` not listed in index
3. Check for index entries pointing to missing files
4. Report wiki page count and growth since last curate

### Step 6: Routing Coverage

Check `session-init.py` WIKI_ROUTING against actual directories:
1. List directories in `~/[YOUR-PROJECT]/` that have NO routing entry
2. List keywords from recent commits (last 10) not covered by keyword routing
3. Suggest routing additions

### Step 7: Process Decisions

For each item flagged in Steps 1-6, prompt the user:
- **keep** — mark as verified (update `last_verified` in frontmatter)
- **update** — edit the content, then mark as verified
- **archive** — move detailed content to the topic file, remove from MEMORY.md index (file stays, just de-indexed)
- **delete** — remove the file and its MEMORY.md entry

Process all decisions immediately. Don't batch.

### Step 8: Summary Report

Print a concise summary:
```
## Curate Report — YYYY-MM-DD

Memory: X files scanned, Y stale, Z archived
Inbox: X items processed, Y pages created
MEMORY.md: X/200 lines (Y% utilized)
Wiki: X pages, Y new since last curate
Routing: X gaps found

Next curate: [date + 7 days]
```

Update `last_verified` frontmatter on all kept/updated memory files:
```yaml
last_verified: 2026-04-15
```

### Step 9: Memory Backup

Back up the entire memory directory to a timestamped archive:
```bash
tar -czf ~/[YOUR-PROJECT]/memory-backup-YYYY-MM-DD.tar.gz \
  -C ~/.claude/projects/[YOUR-PROJECT-PATH] memory/
```
Keep only the last 3 backups (delete older ones). The backup file is gitignored (matches `*.tar.gz`).

### Step 10: Write Curate Timestamp

Write the current ISO timestamp to the curate tracking file so session-init.py can nudge next week:
```python
echo "YYYY-MM-DDTHH:MM:SS" > ~/.claude/projects/[YOUR-PROJECT-PATH]/memory/.last-curate
```

## Rules
- Never delete a memory file without user confirmation
- Always update MEMORY.md index after any file changes
- Keep MEMORY.md under 200 lines — suggest consolidations proactively
- Fast-decay items (session logs) should be archived aggressively
- Slow-decay items (feedback, decisions) should almost always be kept
- When archiving, the topic file stays on disk — only the MEMORY.md index entry is removed
- Always run the memory backup step — this is the only backup mechanism for memory files
- Write the curate timestamp at the end so the scheduling nudge resets
