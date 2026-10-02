# Context-Compression Tool Policy

Applies if you have a context-compression plugin installed (for example the `context-mode`
plugin, whose tools index large output into a local search database so that only matched
excerpts return to the conversation). Compression protects the context window, but it discards
exact values, structure, and patterns that span lines. Use it where that trade is acceptable.

## Decision rule

Ask: does this task need exact values, or broad patterns?

| I need... | Use | Why |
|---|---|---|
| Exact values (dates, IDs, YAML fields, line counts, specific strings) | Direct: Read, Grep, Bash | Compression destroys precision |
| Full file content for editing | Direct: Read, then Edit | Edit needs an exact match from Read output |
| Broad patterns across 20+ files | Compression tool | Loss is acceptable for discovery |
| Large output I only need to search | Compression tool | Keeps raw data out of the window |
| Both discovery and precision | Compression tool first, then direct tools to verify | Two passes |

## Never use compression for these

These need exact fidelity. Compression fails silently: no error, just wrong or missing data.

1. **Deep analysis.** Code review, security audit, architecture review, debugging. Compression strips cross-line patterns and subtle bugs.
2. **Frontmatter and metadata scanning.** YAML fields, dates, versions, config values. One tested scan of file frontmatter returned "(no output)".
3. **Maintenance workflows that depend on dates, types, and counts** (for example a memory or wiki cleanup pass).
4. **Preparing to edit a file.** A summary can't serve as an `old_string` for an edit.
5. **Diff and pull-request review.** Line-level fidelity is required.
6. **Content quality checks.** Style, banned-phrase, and anti-slop scans must see the exact text.
7. **Credential and config verification.** Keys, URLs, account IDs, environment variables. Approximate values are dangerous.
8. **Line counting and structural analysis.** Compression destroys structure.

## Large reference file gate

Estimate a file's size before you Read it. Reading a 900-line document whole to answer one
question can burn a large share of the context window in a single call.

| File size | Approach |
|---|---|
| Under 100 lines | Direct Read is fine |
| 100 to 300 lines | Prefer Grep for the specific thing; Read only if you need the structure |
| Over 300 lines | Use Grep or a compression tool. Don't Read the whole file to answer a question |

1. Can Grep answer it? Use Grep; the cost is only the matched lines.
2. Need to search across several sections? Index the file, then search the index.
3. Need to edit? Read only the section you need, with `offset` and `limit`.
4. Need the whole file to edit it? Read is the only option, so budget for it.

Keep your own list of files in your repo that run past 300 lines, so you know which to grep.

## Hook suggestions are suggestions

Pre-tool hooks from a compression plugin may suggest routing a command through it. Weigh each one
against this policy. If the task is in the never-use list, ignore the hint. If the output will be
under about 50 lines, run it directly. If you need exact values from the output, use direct tools
whatever its size.

## Compression tools don't write files

Use Write and Edit to create or change files. Compression tools (execute, index, fetch-and-index)
are for computation and read-only analysis.

## Quick reference

| Work | Tool choice |
|---|---|
| Code review, debugging, PR review, style checks | Direct only |
| Editing a file | Direct Read, then Edit |
| Broad codebase exploration, project orientation | Compression OK |
| Build logs, test output, 100+ line command output | Compression OK |
| Web research and documentation fetch | Compression OK |
| Looking up a long reference doc | Grep first; compression if multi-section |
