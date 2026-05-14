# What You Get — Complete Inventory

Everything in this kit, what it does, why it's here, and how it helps you.

---

## Rules (4 files) — Standards enforced every session

Rules load automatically on every Claude Code session. You never need to remind Claude of these — they fire silently in the background.

| File | What It Does | Why It's Here |
|------|-------------|---------------|
| `communication.md` | Enforces your professional voice: no AI-slop (50+ banned words), email under 200 words, audience-appropriate framing | Every email, doc, and presentation sounds like YOU wrote it, not a chatbot |
| `security.md` | Access control, secrets handling, input validation, security review checklist | Claude never generates insecure code or exposes sensitive data |
| `architecture.md` | Decision framework, preferred patterns, anti-patterns, change design documentation | Architecture decisions are consistent and well-reasoned |
| `code-quality.md` | Testing behavior, error handling, separation of concerns, code review mindset | Production-quality code that passes peer review |

---

## Hooks (6 scripts) — Automated enforcement that can't be forgotten

Hooks run mechanically — before or after Claude takes an action. Unlike rules (which Claude reads and can forget in long conversations), hooks execute as code. They intercept mistakes at the moment of action.

| File | When It Fires | What It Does | Why It's Here |
|------|--------------|-------------|---------------|
| `session-init.py` | Session start | Routes relevant wiki pages, surfaces recent work, shows nudges | Every session starts with context — no "where was I?" |
| `guardrail.py` | Before Bash | Blocks unsafe commands before they execute | Prevents infrastructure damage at point of action |
| `domain-verification.py` | Before Edit/Write | Catches hallucinated domain-specific terms, suggests corrections | No more invented product names or wrong terminology in your output |
| `output-quality-gate.py` | After Write | Scans .md/.html files for 50+ banned AI-slop words, reports exact line numbers | Content quality is enforced mechanically, not by memory |
| `graph-auto-index.py` | After Write/Edit | Indexes entities into SQLite knowledge graph, computes relationship edges | Your knowledge graph grows automatically from your work |
| `schema-check.py` | Before Bash | Validates field/type names against your schema before running queries | Catches bad queries before they fail |

---

## Skills (21 commands) — Workflows compressed into single commands

Each skill replaces 15-60 minutes of manual work. Say the command, get the output.

### Professional Workflows (7)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/research-prep` | Full pre-meeting intelligence: topic + context + competitive landscape + agenda | 30 min -> 2 min |
| `/strategy` | Strategic analysis: options, tradeoffs, recommendation for any decision | 45 min -> 3 min |
| `/draft` | Professional content with anti-slop, audience-matched tone | 15 min -> 30 sec |
| `/follow-up` | Capture outcomes, action items, schedule next steps | 20 min -> 2 min |
| `/presentation-prep` | Talk/demo prep with audience analysis, flow, and delivery coaching | 30 min -> 3 min |
| `/action-plan` | Multi-step initiative plan with stakeholders and milestones | 60 min -> 5 min |
| `/design-doc` | Architecture or design document for any system | 2 hrs -> 15 min |

### Quality Assurance (3)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/validate` | Cross-model quality gate: 5 dimensions, SHIP/FIX/REWRITE verdict | Manual review -> automated |
| `/voice-check` | Anti-slop scanner: full 50+ word banned list, replacements, pass/fail | Catches what you'd miss |
| `/content-review` | 6-dimension universal reviewer with scoring rubric | Peer review -> instant |

### Intelligence & Growth (5)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/morning-brief` | Daily context: overnight intel, git status, memory changes, suggested actions | 15 min orientation -> instant |
| `/scan-intel` | Intelligence sweep: web + social -> categorized with ADOPT/EVALUATE/WATCH | 30 min research -> 3 min |
| `/ingest` | Process any new source (PDF, URL, doc) into wiki pages with entity extraction | Manual notes -> structured knowledge |
| `/week-plan` | Weekly planning: projects + priorities + blockers | 30 min planning -> 5 min |
| `/weekly-report` | Status report from git + memory + wiki activity | Manual tracking -> automated |

### System Maintenance (4)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/curate` | Memory maintenance: staleness scan, promotion, inbox processing, orphan detection | Knowledge base stays healthy |
| `/wiki-lint` | Wiki health check: orphans, dead links, stale pages, broken structure | Wiki stays trustworthy |
| `/system-health` | System diagnostics: hooks firing, rules loading, graph growing | Debug your setup |
| `/graph-query` | Query the knowledge graph: find relationships, connections, related files | "What do I know about X?" -> instant |

### Compound Loop (2)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/skillify` | Meta-skill: do work -> extract pattern -> new permanent command. Skills build skills. | Manual skill authoring -> automatic |
| `/context-load` | Cross-project context restore: load state from another project into current session | Context switching -> instant |

---

## Knowledge Graph (SQLite, auto-growing)

A local graph database that grows from your work. No external infrastructure — just Python + SQLite.

| Component | What It Does | How It Helps |
|-----------|-------------|-------------|
| `graph-auto-index.py` hook | Every Write/Edit indexes entities and computes relationships | Graph builds itself — zero maintenance |
| `graph-query` skill | Query relationships: "what relates to X?", "what mentions Y?" | Discover connections you didn't know existed |
| `wiki/entities/` | Company, product, concept pages indexed by the graph | Structured knowledge the graph can traverse |
| `wiki/people/` | Person pages with context and timelines | Relationship intelligence that compounds |

**How it compounds:** Write a memory about a project. The hook indexes the entities, people mentioned, and concepts discussed. Next time you prep for a meeting about that project, the graph surfaces related wiki pages, other mentions of those people, and memory files you'd forgotten about. The more you write, the smarter retrieval gets.

---

## Passive Intelligence (Crons — overnight growth)

Your knowledge base grows while you sleep. These run on schedule without any manual effort.

| Script | Schedule | What It Does | How It Helps |
|--------|----------|-------------|-------------|
| `web-scan.py` | Daily 4:30 AM | 5-query web intelligence (your topics, competitors, tools, trends) | Morning brief has fresh web intel |
| `hn-scan.py` | Daily 4:45 AM | 4-query Hacker News developer sentiment (free, no auth) | Know what practitioners are saying |
| `github-scan.py` | Daily 4:45 AM | Trending repos + release monitoring on tools you depend on | What people are actually adopting |
| `morning-digest.sh` | Daily 5:00 AM | Synthesizes all raw intel into wiki/inbox.md | One place to check each morning |
| `memory-decay-check.sh` | Weekly (Sunday) | Flags memory files unchanged >45 days | Catch stale knowledge before it misleads |
| `manage.sh` | Manual | Install/uninstall/status/test all crons | One command to manage the whole system |

---

## Wiki Structure (7 directories — ready to fill)

Pre-built directory structure so you never have to think about organization.

| Directory | What Goes Here | How It Grows |
|-----------|---------------|-------------|
| `wiki/concepts/` | Patterns, frameworks, methodologies | From /ingest, /scan-intel, and manual capture |
| `wiki/entities/` | Companies, products, concepts (graph-indexed) | From /research-prep, /action-plan, manual |
| `wiki/people/` | Person pages — colleagues and external contacts | From profile seeding, /follow-up |
| `wiki/projects/` | Project overviews and status | Manual — one page per active project |
| `wiki/tools/` | Tool documentation and setup guides | From /ingest when you learn a new tool |
| `wiki/events/` | Conference notes, event summaries | From /ingest after events |
| `wiki/insights/` | Research findings, analytical work | From /scan-intel ADOPT NOW items |
| `wiki/index.md` | Master catalog of all pages (Claude uses this to navigate) | Auto-updated when pages are added |
| `wiki/inbox.md` | Staging area for overnight intel and captures | Auto-populated by morning crons |

---

## Scripts (1)

| Script | What It Does | How It Helps |
|--------|-------------|-------------|
| `multi-model-call.py` | Universal multi-model API caller with aliases (haiku, sonnet, opus, gpt-4o, gemini) | Powers /validate for cross-model QA. Also callable from terminal for ad-hoc queries. |

---

## Configuration

| File | What It Does | How It Helps |
|------|-------------|-------------|
| `settings.json.example` | Complete Claude Code settings with hooks, permissions, env vars | Copy and customize — don't start from scratch |
| `QUICKSTART-PROMPT.md` | Paste into Claude Code for interactive guided setup | Claude builds your personalized config by asking you questions |

---

## Examples

| File | What It Shows | Why It Matters |
|------|-------------|---------------|
| `examples/compound-loop/README.md` | Full walkthrough: banned word -> memory -> rule -> hook -> permanent prevention | Proves the compound effect is real, not theoretical |
| `examples/compound-loop/feedback-example.md` | What a real memory file looks like | Template for how corrections get stored |
| `examples/compound-loop/guardrail-example.py` | Simplified hook that catches banned patterns | Shows how hooks work in practice |

---

## The Compound Effect (Why All This Matters Together)

No single component is transformative on its own. The value is in how they interact:

```
Day 1:  You correct Claude -> Memory file saved
Day 3:  Same mistake class -> Rule prevents it automatically  
Day 7:  Rule might be forgotten in long sessions -> Hook enforces mechanically
Day 14: Hook catches a pattern -> Skill extracts it via /skillify
Day 30: Overnight crons feed new intel -> Morning brief surfaces it
Day 60: Graph connects entities you didn't know were related -> Better prep
```

Each layer reinforces the others. Memory feeds rules. Rules feed hooks. Hooks feed skills. Skills feed the graph. The graph feeds session-init. Session-init feeds the next conversation. The loop never stops.

**This is why starting matters more than perfecting.** A mediocre setup that runs for 60 days beats a perfect setup that runs for 1 day. Compound growth is the product.
