Load key state from another project into the current session. Gives cross-project awareness without switching directories.

Takes project name or path as argument. Examples:
- `/context-load "my-project"` — load project state
- `/context-load "~/other-repo"` — load from explicit path

## Step 1: Resolve Project Directory

Search for matching directory in your common project locations (home dir, ~/projects/, ~/repos/). If an explicit path is given, use it directly.

## Step 2: Load Context (run ALL in parallel)

### 1. Project CLAUDE.md (first 100 lines for key context)
Read `[PROJECT_DIR]/CLAUDE.md` if it exists.

### 2. Recent Git Activity
```bash
cd [PROJECT_DIR] && git log --oneline -10 2>/dev/null
```

### 3. Current Branch & Status
```bash
cd [PROJECT_DIR] && git branch --show-current && git status --short 2>/dev/null
```

### 4. Deployment Status (if applicable)
Check for health endpoints, deployment configs, or CI status if the project has them.

### 5. Key Files & Structure
```bash
cd [PROJECT_DIR] && ls -la 2>/dev/null
```

### 6. Related Memory Files
Search `~/.claude/projects/[YOUR-PROJECT-PATH]/memory/` for files mentioning the project name.

## Step 3: Output Summary

```
====================================
  CONTEXT LOADED — [Project Name]
====================================

STATUS: [active development / complete / exploring]
BRANCH: [current branch]
LAST COMMIT: [hash] — [message] — [date]
UNCOMMITTED: [yes/no, count of changes]

KEY FACTS:
  - [Most important thing to know about current state]
  - [Second most important]
  - [Third]

DEPLOYMENT:
  [Status if applicable, or "N/A — not deployed"]

RECENT ACTIVITY (last 10 commits):
  [commit list]

ACTIVE ISSUES / NEXT STEPS:
  [From CLAUDE.md or memory files]

RELATED MEMORY FILES:
  [List of relevant memory files with one-line summaries]
====================================
```

This context is now available in the current session. Reference it when working on cross-project tasks.
