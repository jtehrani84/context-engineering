# /scan-intel

Intelligence sweep. Scans web sources for developments relevant to your work and categorizes findings by urgency.

## Trigger
When the user says: "scan intel", "what's new in [field]?", "intelligence sweep", "check for updates"

## Workflow

### 1. Run searches

Use available tools (Exa MCP, web search, or manual queries) to scan for:

**Configure these queries for YOUR domain:**
1. "[Your primary topic] new features updates announcements"
2. "[Your tools/frameworks] releases changes"
3. "[Your industry] trends developments"
4. "[Competing tools/approaches] launches updates"
5. "[Your community] best practices patterns"

Set time window to last 7 days.

### 2. For each finding, capture:
- **Source** — URL or reference
- **Title/Summary** — what was found
- **Why it matters** — specifically for your work
- **Action item** (if any):
  - New skill to create
  - Configuration change needed
  - Pattern to adopt
  - Tool to evaluate

### 3. Categorize findings:
- **ADOPT NOW** — Immediately useful, implement today
- **EVALUATE** — Interesting, needs investigation
- **WATCH** — Good to know, not actionable yet

### 4. Output format

Save results to `intel-digests/YYYY-MM-DD.md`:

```
# Intelligence Digest: [date]

## ADOPT NOW
- [Finding]: [why + action item] (Source: [URL])

## EVALUATE
- [Finding]: [why interesting] (Source: [URL])

## WATCH
- [Finding]: [brief note] (Source: [URL])

## Summary
[2-3 sentences: what's the overall signal today?]
```

### 5. Auto-process ADOPT NOW items

For each ADOPT NOW finding:
- Add to `wiki/inbox.md` with source and suggested action
- If it has a deadline, save a memory file: `deadline-[topic].md`
- If it changes how you should use a tool, note it in the relevant wiki page

## Rules
- Maximum 15 items total. Quality over quantity.
- Be honest about signal vs noise — most days are quiet
- ADOPT NOW requires an immediate, concrete action (not just "interesting")
- Never fabricate sources. If you can't verify it, mark as "[UNVERIFIED]"
- Skip promotional content, obvious marketing, and hype
- The test: would a busy professional act on this today?
