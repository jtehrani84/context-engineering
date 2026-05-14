# Context Engineering Starter Kit

**Go from Day 0 to Day 5 — compound loops take over from there.**

This kit gives you the persistent context architecture that took 60 days of trial-and-error to build. Clone it, run setup, and the system starts compounding from session one. Every correction you make becomes permanent. Every mistake develops an immune response.

## What You Get

| Layer | What | Impact |
|-------|------|--------|
| **Identity** | Template CLAUDE.md with routing table | Claude knows your role, projects, and constraints from session 1 |
| **Rules** | 4 governance files (voice, security, architecture, code quality) | Standards enforced automatically — no re-explaining |
| **Hooks** | 6 scripts (session-init, guardrail, domain-verification, output-quality-gate, graph-auto-index, schema-check) | Context routes itself; mistakes get blocked or flagged |
| **Skills** | 21 professional workflows | From research prep to content quality to meta-skills |
| **Wiki** | Starter knowledge base with entity pages | Architecture decisions, people, reference docs — all organized |
| **Crons** | Intelligence automation pipeline | Overnight web + HN + GitHub scanning -> morning digest |
| **Examples** | Compound loop walkthrough | See exactly how one mistake becomes a permanent fix |

## Quick Start (30 minutes)

### Option A: One-command setup

```bash
git clone https://github.com/jtehrani84/context-engineering.git
cd context-engineering
./setup.sh
```

The setup script will:
1. Copy templates to your `~/.claude/` directory (won't overwrite existing files)
2. Ask your role, industry, and top constraint
3. Generate your personalized CLAUDE.md
4. Install hooks, rules, and skills
5. Set up the wiki structure
6. Optionally configure crons for overnight intelligence

### Option B: Let Claude build it

Open Claude Code and paste:

```
I want to set up persistent context architecture. Read the setup instructions at ~/context-engineering/QUICKSTART-PROMPT.md and build my personalized setup.
```

Claude will scaffold everything interactively.

## After Setup

### Week 1: Foundation
- Claude routes context automatically on session start
- Rules enforce your voice and security standards
- Run `/research-prep [topic]` before any meeting
- When Claude makes a mistake, say "remember this" — it saves a memory file
- Domain verification hook catches hallucinated terms from your field

### Week 2-3: Growth
- Memory files accumulate from corrections and decisions
- Wiki grows as Claude writes reference pages from your work
- Skills save 30+ minutes of instruction per use
- Morning brief arrives if you enable crons
- Use `/skillify` to extract new workflows from sessions

### Week 4+: Compound Effects
- Output quality gate catches the last 1% of slip-throughs
- Entity graph connects related knowledge automatically
- `/validate` provides cross-check before shipping content
- The system builds itself from here

## What Each Skill Does

| Skill | Purpose |
|-------|---------|
| `/research-prep` | Pre-meeting intelligence: topic snapshot, relationship context, priorities, your angle |
| `/strategy` | Strategic analysis for any decision: options, tradeoffs, recommendation |
| `/draft` | Professional email/message with anti-slop enforcement and audience-appropriate tone |
| `/follow-up` | After any meeting — capture outcomes, action items, draft follow-up |
| `/presentation-prep` | Prep for any talk or demo: audience analysis, flow, talking points |
| `/action-plan` | Multi-step initiative planning with stakeholders, milestones, and blockers |
| `/design-doc` | Architecture or design document for any system or project |
| `/validate` | Cross-model quality gate: 5 dimensions, SHIP/FIX/REWRITE verdict |
| `/voice-check` | Anti-slop scanner: 50+ banned words with line numbers and replacements |
| `/content-review` | 6-dimension reviewer: accuracy, voice, specificity, focus, actionability, credibility |
| `/morning-brief` | Daily context: overnight intel, yesterday's work, today's focus |
| `/scan-intel` | Intelligence sweep: web + HN + GitHub -> categorized with ADOPT/EVALUATE/WATCH |
| `/ingest` | Process any new source into wiki pages with entity extraction |
| `/week-plan` | Weekly planning: projects + intel + priorities + blockers |
| `/weekly-report` | Status report from git log, memory files, and session activity |
| `/curate` | Memory maintenance: staleness scan, inbox processing, orphan detection |
| `/wiki-lint` | Wiki health check: orphans, dead links, stale pages |
| `/skillify` | Meta-skill: extract any repeatable workflow into a new permanent command |
| `/context-load` | Cross-project context restore |
| `/graph-query` | Query the knowledge graph: find relationships and connected files |
| `/system-health` | System diagnostics: hooks firing, rules loading, graph growing |

## Hooks (6 Scripts)

| Hook | Type | What It Does |
|------|------|-------------|
| `session-init.py` | SessionStart | Routes context based on working directory and git branch |
| `guardrail.py` | PreToolUse (Bash) | Blocks dangerous commands: force-push, rm -rf, secrets exposure |
| `domain-verification.py` | PreToolUse (Edit/Write) | Flags hallucinated domain terms before they reach output |
| `output-quality-gate.py` | PostToolUse (Write) | Scans written content for AI-slop words and reports violations |
| `graph-auto-index.py` | PostToolUse (Write/Edit) | Indexes entities into SQLite knowledge graph |
| `schema-check.py` | PreToolUse (Bash) | Validates field/type names against your schema before execution |

## The Compound Loop

```
Mistake --> Correction --> Memory File --> Rule --> Hook --> Prevention
                                                             |
                                                  That error class is gone forever
```

See `examples/compound-loop/` for a complete walkthrough showing one real correction evolving from memory to rule to hook enforcement.

## Directory Structure

```
~/.claude/
|-- CLAUDE.md                        # Your identity + routing table (from template)
|-- settings.json                    # Hook config, permissions, env vars
|-- rules/                           # Always-loaded governance
|   |-- communication.md             # Voice standards, anti-slop, banned words
|   |-- security.md                  # Access control, secrets, security review
|   |-- architecture.md              # Decision framework, patterns
|   +-- code-quality.md             # Code standards, testing
|-- hooks/
|   +-- scripts/
|       |-- session-init.py          # Context routing on start
|       |-- guardrail.py             # PreToolUse: block dangerous commands
|       |-- domain-verification.py   # PreToolUse: catch hallucinated domain terms
|       |-- output-quality-gate.py   # PostToolUse: scan for AI-slop in written files
|       |-- graph-auto-index.py      # PostToolUse: knowledge graph indexer
|       +-- schema-check.py          # PreToolUse: validate schema/types
|-- commands/                        # Custom /commands (skills)
|   |-- research-prep.md
|   |-- strategy.md
|   |-- draft.md
|   +-- ... (21 total)
|-- projects/
|   +-- [your-project]/
|       +-- memory/                  # Auto-populated by Claude
|           |-- MEMORY.md            # Index (auto-loaded)
|           +-- *.md                 # Topic files
+-- wiki/
    |-- index.md                     # Wiki entry point
    +-- people/                      # Entity pages
        |-- _template-colleague.md
        |-- _template-external.md
        +-- [name].md

crons/                               # Optional: overnight intelligence
|-- manage.sh                        # Install/uninstall/status/test
|-- gather/
|   |-- web-scan.py                  # Web intelligence via Exa API
|   |-- hn-scan.py                   # Developer/industry sentiment via HN
|   +-- github-scan.py              # GitHub trending repos + releases
|-- synthesize/
|   +-- morning-digest.sh           # Claude synthesizes raw -> wiki/inbox.md
|-- plists/
|   +-- *.plist                      # macOS launchd schedules
+-- raw/                             # Raw gather output (date-stamped)
```

## Configuration

Copy `settings.json.example` to `~/.claude/settings.json` and customize:
- Hook paths and matcher patterns
- Permission allowlists (reduce permission prompts)
- Environment variables
- Model selection

## Customization

### For your role
Edit `CLAUDE.md` — replace the placeholder sections with YOUR:
- Role and title
- Current projects
- Key constraints (org-specific, compliance, etc.)
- Routing table (what wiki pages to load for what tasks)

### For your domain
The domain verification hook reads from a configurable JSON file. Add your field's commonly hallucinated terms — product names, API endpoints, technical terminology that LLMs get wrong.

### For your workflows
Skills are templates. Edit them to match YOUR processes, YOUR tools, YOUR output formats.

### Entity pages
Start with 3-5 key people (your manager, your top collaborator, your key stakeholder). The wiki grows from there. See `wiki/people/README.md`.

## How It Works

Every correction you make gets saved as a memory file. Repeated corrections become rules (auto-loaded every session). Critical rules become hooks (mechanically enforced). The system develops immunity to its own failure modes.

After 30 days, a typical setup has:
- 40-60 memory files (corrections, decisions, preferences)
- 8-12 rules (governance, voice, domain constraints)
- 4-6 hooks (hard enforcement of critical patterns)
- 10-15 skills (workflow automation)
- 20-30 entity pages (people knowledge)

That's ~100 persistent context items working silently in every session.

## FAQ

**Do I need to be a developer?**
No. Tell Claude what you want enforced, what workflow to automate, what mistake to prevent. Claude writes the hooks, skills, and rules. Your job is direction and domain expertise.

**Will this overwrite my existing Claude config?**
No. The setup script checks for existing files and skips them. You can also run it in dry-run mode first.

**How much does this cost?**
Nothing beyond your existing Claude Code subscription. No external services required. Crons are optional (Exa API has a free tier; HN Algolia is free).

**Can I share my setup with my team?**
Yes — that's how this kit was created. Once your system matures, you can export your rules and skills for others. Use `/skillify` to package workflows.

**What's the difference between a rule and a hook?**
Rules are instructions Claude reads at session start. They're soft — they can be forgotten in very long conversations. Hooks are code that runs mechanically before or after tool calls. They can't be forgotten because they execute outside the model's context.

## Recommended Plugins

These extend the base kit significantly. Install from Claude Code marketplace:

| Plugin | What It Does | Install |
|--------|-------------|---------|
| **context-mode** | 98% context compression, FTS5 search — extends long sessions massively | `/context-mode:ctx-upgrade` |
| **hookify** | Generate hooks from conversation patterns — "never do X again" becomes code | Marketplace |
| **session-report** | End-of-session summary with token usage and work done | Marketplace |

## Recommended MCP Servers

Add these to `~/.claude/settings.json` under `mcpServers`:

| Server | What It Does | Setup |
|--------|-------------|-------|
| **GitHub** | PR creation, code search, issue management | `gh auth login` then add to settings |
| **Exa** | Real-time web intelligence (powers /scan-intel crons) | Get API key at exa.ai |
| **Context7** | Current documentation lookup for any framework | Free, no auth needed |

## Origin

This architecture was built over 60 days by John Tehrani starting from a blank Claude Code install. The full story: [From Memory to Operating System](https://jtehrani84.github.io/claude-context-architecture/from-memory-to-operating-system.html)

## Questions?

- **Issues:** [github.com/jtehrani84/context-engineering/issues](https://github.com/jtehrani84/context-engineering/issues)
- **Author:** John Tehrani (jamtehrani@gmail.com)
