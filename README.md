# Context Engineering Starter Kit

**Go from Day 0 to Day 5 — compound loops take over from there.**

This kit gives you the persistent context architecture that took 60 days of trial-and-error to build. Clone it, run setup, and the system starts compounding from session one. Every correction you make becomes permanent. Every mistake develops an immune response.

It is provider-agnostic. Nothing here assumes a particular company, CRM, cloud or model vendor. The two scripts that call a second model (`/review` and the second read in `/validate`) work with any OpenAI-compatible endpoint or the Anthropic API, configured through `LLM_BASE_URL` and `LLM_API_KEY`.

## What You Get

| Layer | What | Impact |
|-------|------|--------|
| **Identity** | `templates/CLAUDE.md` with a routing table, written for you by the quickstart prompt | Claude knows your role, projects, and constraints from session 1 |
| **Rules** | 13 governance files: voice, security, architecture, code quality, testing, the four proof-family rules, structural voice, agent security, model tiering, context compression | Standards load every session; the proof gates flag confidently-wrong output |
| **Hooks** | 10 scripts: 7 wired by setup, 3 opt-in | Context routes itself; dangerous commands get blocked; slop, hallucinated terms and unproven "shipped" claims get flagged |
| **Skills** | 28 workflows | Research prep, drafting, planning, content quality, audits, wiki and memory upkeep, meta-skills |
| **Voice engine** | `tools/aiscore.mjs`, a vendored MIT detector, your own overlay, and a calibration fuse | Flags AI-sounding prose in what Claude writes; calibrate it to your own writing |
| **Audits** | 4 multi-agent workflows behind `/claim-audit`, `/plan-audit`, `/execution-truth`, `/provenance-audit` | Re-check claims, plans and runtime behavior before they ship |
| **Guards** | `guards/`: egress guard, token broker, output reducer, path protection, leak scan, with tests | Working code for agents that read untrusted data and hold real tools |
| **Wiki + memory** | Starter wiki skeleton, memory conventions with perishable-finding fields | Decisions, people and reference pages, organized from day one |
| **Crons** | 7 scripts, 6 launchd schedules | Overnight web, Hacker News and GitHub scans, a morning digest, a weekly curate prep |
| **Examples** | Compound loop walkthrough | See exactly how one mistake becomes a permanent fix |

`WHAT-YOU-GET.md` has the full file-by-file inventory.

## Quick Start (30 minutes)

### Option A: One-command setup

```bash
git clone https://github.com/jtehrani84/context-engineering.git ~/context-engineering
cd ~/context-engineering
./setup.sh --dry-run   # optional: see what it would do
./setup.sh
```

The setup script:
1. Checks your CLIs (`git` and `python3` are required; `node` 18+ runs the voice engine, guards and audit workflows)
2. Copies rules, hooks, skills, the voice engine, the eval harness, the audit workflows and the model scripts into `~/.claude/` without overwriting anything you've edited
3. Wires the default hooks into `~/.claude/settings.json`, keeping everything else in that file as it was
4. Points you at `QUICKSTART-PROMPT.md`, which asks you 5 questions and writes your `CLAUDE.md`

It does not set up the wiki or the crons unless you ask: `./setup.sh --with-wiki` copies the wiki skeleton, and `cd crons && ./manage.sh install` schedules the overnight jobs.

### Option B: Let Claude drive

Run `./setup.sh`, then open Claude Code in the project you work in most and paste:

```
Read ~/context-engineering/QUICKSTART-PROMPT.md and follow the instructions.
```

Claude asks 5 questions and writes your `CLAUDE.md`. It doesn't recreate the files setup already installed.

### Upgrading

`git pull && ./setup.sh`. A rule, skill, hook, or tool you never edited is upgraded to the new version. One you edited is left alone, and setup prints its path so you can compare by hand. If you installed the May 2026 version and wired hooks by copying the old `settings.json.example`, setup rewrites those entries into the nested format Claude Code actually reads. `./setup.sh --check` reports what is installed, and `./setup.sh --uninstall` removes only files that still match a kit version.

## After Setup

### Week 1: Foundation
- Claude routes context automatically on session start
- Rules enforce your voice and security standards
- Run `/research-prep [topic]` before any meeting
- When Claude makes a mistake, say "remember this" — it saves a memory file
- Domain verification hook catches hallucinated terms from your field (list them in `~/.claude/domain-terms.json`)

### Week 2-3: Growth
- Memory files accumulate from corrections and decisions
- Wiki grows as Claude writes reference pages from your work
- Skills save 30+ minutes of instruction per use
- Morning digest lands in your wiki inbox if you enable the crons
- Use `/skillify` to extract new workflows from sessions

### Week 4+: Compound Effects
- Output quality gate and the voice engine catch the last slip-throughs
- Turn on the opt-in graph indexer so `/graph-query` can connect related knowledge
- `/validate` and `/review` give you a second model's read before you ship
- The system builds itself from here

## What Each Skill Does

| Skill | Purpose |
|-------|---------|
| `/research-prep` | Pre-meeting intelligence: topic snapshot, relationship context, priorities, your angle |
| `/strategy` | Strategic analysis for any decision: options, tradeoffs, recommendation |
| `/draft` | Professional email or message with anti-slop enforcement and audience-appropriate tone |
| `/follow-up` | After any meeting: capture outcomes, action items, draft follow-up |
| `/presentation-prep` | Prep for any talk or demo: audience analysis, flow, talking points |
| `/action-plan` | Multi-step initiative planning with stakeholders, milestones, and blockers |
| `/design-doc` | Architecture or design document for any system or project |
| `/validate` | Quality gate: scores in-session, then asks a model from another lab through your endpoint (and says so when none is configured) |
| `/review` | Adversarial review of a document by a model from a different lab than the one that drafted it |
| `/voice-check` | Anti-slop scan through the voice engine, with line numbers and replacements |
| `/voice-judge` | The gestalt read: can veto a clean voice score when the text still reads as generated |
| `/content-review` | 6-dimension reviewer: accuracy, voice, specificity, focus, actionability, credibility |
| `/claim-audit` | Re-verify every factual and causal claim in an external-facing artifact against its source |
| `/plan-audit` | Try to refute a "code-verified" plan's claims against the real code before anyone builds from it |
| `/execution-truth` | Runtime-prove what a system claims: live, silent-zero, stale, or ghost |
| `/provenance-audit` | Before calling anything fabricated, check the source where it would be true |
| `/morning-brief` | Daily context: overnight intel, yesterday's work, today's focus |
| `/scan-intel` | Intelligence sweep: web + HN + GitHub, categorized ADOPT / EVALUATE / WATCH |
| `/ingest` | Process any new source into wiki pages with entity extraction |
| `/week-plan` | Weekly planning: projects + intel + priorities + blockers |
| `/weekly-report` | Status report from git log, memory files, and session activity |
| `/curate` | Memory maintenance: staleness scan, inbox processing, orphan detection |
| `/wiki-lint` | Wiki health check: orphans, dead links, stale pages |
| `/skillify` | Meta-skill: extract any repeatable workflow into a new permanent command |
| `/context-load` | Cross-project context restore |
| `/graph-query` | Query the knowledge graph: find relationships and connected files |
| `/system-health` | System diagnostics: hooks firing, rules loading, graph growing |
| `/gas-deploy` | Google Apps Script push + deploy + verify (see `docs/apps-script-setup.md`) |

## Hooks (7 Wired by Setup, 3 Opt-In)

| Hook | Type | What It Does |
|------|------|-------------|
| `session-init.py` | SessionStart | Routes context based on working directory and git branch |
| `guardrail.py` | PreToolUse (Bash) | Blocks dangerous commands: force-push to main (`--force-with-lease` is allowed), `rm -rf` on home or root, secrets exposure |
| `domain-verification.py` | PreToolUse (Edit/Write) | Flags hallucinated domain terms before they reach output |
| `schema-check.py` | PreToolUse (Bash) | Checks column names in SQL commands against `~/.claude/schema.json`; silent without that file |
| `output-quality-gate.py` | PostToolUse (Write) | Scans written content for AI-slop words and reports violations |
| `voice-tell-gate.py` | PostToolUse (Write) | Runs the voice engine on written `.md`, `.html` and `.txt` files |
| `deploy-proof-gate.py` | PostToolUse (Bash) | After a deploy or publish command, reminds Claude to prove the change on the running system |
| `claim-faithfulness-gate.py` | PostToolUse, opt-in | On an external-facing doc with over-confident claim language, asks for a re-read against sources |
| `refutation-oracle-gate.py` | PostToolUse, opt-in | On an audit that calls something fabricated, asks for a check of the source where it would be true |
| `graph-auto-index.py` | PostToolUse, opt-in | Indexes entities into a local SQLite knowledge graph for `/graph-query` |

Turn on the two prose gates with `KIT_WIRE_PROOF_GATES=1 ./setup.sh`. They nudge by default; `KIT_PROOF_GATES=block` makes all three proof gates block instead. The graph indexer is wired by hand (see `settings.json.example`).

## Testing the Kit

```bash
bash scripts/test-all.sh
```

Runs every offline suite: a hook self-test that feeds synthetic payloads to every hook, the proof-gate tests, the workflow harness, a sandbox install-and-upgrade test (scratch `HOME`, never your real `~/.claude`), the cron tests, the model-script tests, the guards, the vendored detector, the eval harness, the compound-loop example, and a check that the tree below is current. Nothing needs an account, a model endpoint or the network.

## Models and the Second Read

Set `LLM_BASE_URL` and `LLM_API_KEY` (and optionally `LLM_MODEL`, `LLM_API_STYLE`, `LLM_MODEL_ALIASES`) in your shell or the `env` block of `~/.claude/settings.json`. `scripts/llm-call.py` sends one prompt; `scripts/llm-review.py` runs the adversarial review prompts in `scripts/review-prompts/`. No model ids are hard-coded: what your endpoint serves is the catalog. Pick a reviewer from a different lab than the model that drafted the work, because a model grading its own family's output tends to go easy on it. `rules/tiered-orchestration.md` covers which tier of model to use for which step.

Only send content to an endpoint your organization has approved for that kind of data.

## The Compound Loop

```
Mistake --> Correction --> Memory File --> Rule --> Hook --> Prevention
                                                             |
                                                  That error class is gone forever
```

See `examples/compound-loop/` for a complete walkthrough showing one real correction evolving from memory to rule to hook enforcement.

## Directory Structure

<!-- tree:begin (generated by scripts/gen-readme-tree.py, do not edit by hand) -->
```
~/.claude/   (what ./setup.sh installs)
|-- rules/
|   |-- agent-security-boundary.md                    # Agents that read outside data and hold tools: data is not instructions, default-deny egress
|   |-- architecture.md                               # Decision framework, patterns
|   |-- claims-faithful-to-source.md                  # Proof family: claims match their source
|   |-- code-quality.md                               # Code standards
|   |-- communication.md                              # Voice standards, anti-slop, banned words
|   |-- context-mode-policy.md                        # When to use a context-compression plugin and when to read directly
|   |-- findings-are-perishable.md                    # Proof family: re-check old findings
|   |-- proof-before-claim.md                         # Proof family: done needs a signal from the running system
|   |-- refutation-needs-the-right-oracle.md          # Proof family: check the right source before saying it's false
|   |-- security.md                                   # Access control, secrets, input validation, agent pointer
|   |-- structural-voice.md                           # Structure-level anti-AI rules
|   |-- testing-quality.md                            # Tests that catch bugs; proof-artifact and persistence proof
|   +-- tiered-orchestration.md                       # Match model, effort and tool to the task; verify anything cheap
|-- hooks/scripts/
|   |-- claim-faithfulness-gate.py                    # PostToolUse, opt-in: re-read claims against their sources
|   |-- deploy-proof-gate.py                          # PostToolUse: after a deploy, prove it on the running system
|   |-- domain-verification.py                        # PreToolUse: flag hallucinated terms from your field
|   |-- graph-auto-index.py                           # Knowledge-graph indexer; installed, not wired by default
|   |-- guardrail.py                                  # PreToolUse: block dangerous commands
|   |-- output-quality-gate.py                        # PostToolUse: scan for AI-slop in written files
|   |-- refutation-oracle-gate.py                     # PostToolUse, opt-in: check the right source before calling something fabricated
|   |-- schema-check.py                               # PreToolUse: check SQL columns against your schema
|   |-- session-init.py                               # SessionStart: context routing
|   +-- voice-tell-gate.py                            # PostToolUse: voice engine on written .md/.html/.txt
|-- commands/
|   |-- action-plan.md
|   |-- claim-audit.md
|   |-- content-review.md
|   |-- context-load.md
|   |-- curate.md
|   |-- design-doc.md
|   |-- draft.md
|   |-- execution-truth.md
|   |-- follow-up.md
|   |-- gas-deploy.md
|   |-- graph-query.md
|   |-- ingest.md
|   |-- morning-brief.md
|   |-- plan-audit.md
|   |-- presentation-prep.md
|   |-- provenance-audit.md
|   |-- research-prep.md
|   |-- review.md
|   |-- scan-intel.md
|   |-- skillify.md
|   |-- strategy.md
|   |-- system-health.md
|   |-- validate.md
|   |-- voice-check.md
|   |-- voice-judge.md
|   |-- week-plan.md
|   |-- weekly-report.md
|   +-- wiki-lint.md
|-- tools/  (22 files)                                # Voice engine (aiscore.mjs + vendored MIT detector + your overlay), RAG-quality and transcript-export tools
|-- harness-evolution/  (4 files)                     # Held-out eval harness + your voice corpus
|-- workflows/  (4 files)                             # Multi-agent audit workflows behind /claim-audit, /plan-audit, /execution-truth, /provenance-audit
|-- scripts/  (llm-call.py, llm-review.py, review-prompts/)  # llm-call.py + llm-review.py back /review and /validate (LLM_BASE_URL, LLM_API_KEY)
|-- CLAUDE.md, settings.json                          # yours: write CLAUDE.md with QUICKSTART-PROMPT.md, merge settings by hand
+-- projects/<project>/memory/                        # Claude Code creates this itself

In the repo, not installed by setup
|-- .github/                                          # Pages deploy workflow, issue templates  (5 files)
|-- crons/                                            # Optional overnight intelligence
|   |-- backup/
|   |   +-- backup-sessions.sh                        # Local mirror + dated snapshots of session transcripts (opt-in)
|   |-- curate-prep/
|   |   +-- curate-prep.py                            # Read-only weekly prep for /curate (writes CURATE-PENDING.md)
|   |-- gather/
|   |   |-- github-scan.py                            # GitHub releases + trending (no key)
|   |   |-- hn-scan.py                                # Hacker News scan (no key)
|   |   +-- web-scan.py                               # Exa web scan (needs EXA_API_KEY)
|   |-- plists/
|   |   |-- com.context.curate-prep.plist             # launchd schedule for curate-prep (Sundays 11:00 PM)
|   |   |-- com.context.gather.github.plist           # launchd schedule for the GitHub scan (4:50 AM)
|   |   |-- com.context.gather.hn.plist               # launchd schedule for the Hacker News scan (4:45 AM)
|   |   |-- com.context.gather.web.plist              # launchd schedule for the web scan (4:30 AM)
|   |   |-- com.context.session-backup.plist          # launchd schedule for the backup; only with install --with-backup
|   |   +-- com.context.synthesize.morning.plist      # launchd schedule for the morning digest (5:00 AM)
|   |-- synthesize/
|   |   |-- memory-decay-check.sh                     # Flags memory files unchanged for 45+ days (no plist)
|   |   +-- morning-digest.sh                         # Synthesizes gathered files into wiki/inbox.md
|   +-- manage.sh                                     # Install / uninstall / status / test (launchd)
|-- docs/                                             # Inventory page, recommended plugins, Apps Script guide  (3 files)
|-- examples/                                         # Worked examples  (4 files)
|-- guards/                                           # Working controls for agents (egress, broker, reducer, path protection, leak scan) with tests  (23 files)
|-- hooks/                                            # Hook sources (setup installs hooks/scripts/)
|   |-- tests/
|   |   +-- test_proof_gates.py                       # Tests for the three proof-family hooks
|   +-- selftest.py                                   # Feeds synthetic payloads to every hook and checks the output contract
|-- rules-optional/                                   # Opt-in design rules (Tailwind, Delta); setup never copies them  (3 files)
|-- scripts/                                          # Repo-only helpers: hook wiring, manifest and tree generators, install, cron and script tests  (9 files)
|-- site/                                             # The GitHub Pages site (the Part 6 article)  (2 files)
|-- templates/                                        # CLAUDE.md, memory, wiki log and report templates
|   |-- apps-script/
|   |   |-- email-merge.gs                            # Mail merge from a Sheet (dry run by default)
|   |   |-- sheet-data-puller.gs                      # A Sheet as a JSON endpoint
|   |   +-- slides-from-sheet.gs                      # One slide per Sheet row
|   |-- memory/
|   |   |-- MEMORY.md
|   |   |-- README.md                                 # Memory folder conventions: frontmatter, tiered index, perishable fields
|   |   |-- feedback-index.md
|   |   |-- feedback-verify-product-names.md
|   |   +-- reference-example-perishable.md
|   |-- reports/
|   |   |-- morning-brief.html
|   |   |-- session-report.html
|   |   +-- system-health.html
|   |-- wiki/
|   |   +-- log.md                                    # Append-only wiki change log
|   +-- CLAUDE.md                                     # Identity template with routing table
|-- tests/                                            # Tests for the crons, transcript export and graph indexer  (1 file)
|-- wiki/                                             # Starter wiki skeleton
|   |-- concepts/
|   |-- decisions/
|   |-- entities/
|   |   +-- README.md
|   |-- events/
|   |-- insights/
|   |-- people/
|   |   |-- README.md
|   |   |-- _template-colleague.md
|   |   +-- _template-external.md
|   |-- projects/
|   |-- tools/
|   |-- .gitignore
|   |-- README.md                                     # Wiki layout and the local-only page convention
|   |-- inbox.md
|   +-- index.md                                      # Wiki index (setup --with-wiki copies it)
|-- QUICKSTART-PROMPT.md                              # Paste into Claude Code to write your CLAUDE.md
|-- README.md
|-- VOICE-ONBOARDING.md                               # Calibrate the voice guard to you
|-- WHAT-YOU-GET.md                                   # Full inventory
|-- settings.json.example                             # Reference only; setup wires hooks for you. Merge by hand, never copy over yours
+-- setup.sh                                          # Installer (safe to re-run: upgrades what you never edited)
```
<!-- tree:end -->

## Configuration

`settings.json.example` is a reference, not a file to copy. Setup already merged the hooks into your `~/.claude/settings.json`. For anything else (the `permissions.ask` list for tools that send or post in your name, the model endpoint variables, a Notification hook), copy the individual blocks you want by hand. Copying the whole file over yours would erase whatever your install already wrote there, such as an auth key.

## Customization

### For your role
Edit `CLAUDE.md` — replace the placeholder sections with YOUR:
- Role and title
- Current projects
- Key constraints (org-specific, compliance, etc.)
- Routing table (what wiki pages to load for what tasks)

### For your domain
The domain verification hook reads `~/.claude/domain-terms.json`. Add your field's commonly hallucinated terms — product names, API endpoints, technical terminology that LLMs get wrong — as `{"wrong term": "correction"}` pairs. The schema check reads `~/.claude/schema.json` the same way.

### For your voice
The voice engine is generic until you calibrate it. `VOICE-ONBOARDING.md` walks you through collecting your own samples, filling `tools/voice-overlay.mjs`, and running `node ~/.claude/tools/voice-setup.mjs`.

### For your workflows
Skills are templates. Edit them to match YOUR processes, YOUR tools, YOUR output formats. An edited skill is never overwritten on upgrade.

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
No. Setup never overwrites a file you've edited, and it merges hooks into your `settings.json` instead of replacing it (it backs the file up first). Run `./setup.sh --dry-run` to see what it would do.

**How much does this cost?**
Nothing beyond your existing Claude Code subscription. The crons are optional (Exa has a free tier; the Hacker News and GitHub scans need no key). `/review` and the second read in `/validate` cost whatever your model endpoint charges.

**Can I share my setup with my team?**
Yes — that's how this kit was created. Once your system matures, you can export your rules and skills for others. Use `/skillify` to package workflows, and run `guards/scrub.mjs` with your own denylist before you publish anything.

**What's the difference between a rule and a hook?**
Rules are instructions Claude reads at session start. They're soft — they can be forgotten in very long conversations. Hooks are code that runs mechanically before or after tool calls. They can't be forgotten because they execute outside the model's context.

## Recommended Plugins

These extend the base kit. Install from the Claude Code plugin marketplace (`docs/recommended-plugins.md` has the exact commands):

| Plugin | What It Does |
|--------|-------------|
| **context-mode** | Compresses large tool output into a local search index so long sessions last longer (read `rules/context-mode-policy.md` for when not to use it) |
| **hookify** | Generate hooks from conversation patterns — "never do X again" becomes code |
| **session-report** | Session summary with token usage and work done |

## Recommended MCP Servers

Add these to `~/.claude/.mcp.json`, then put their send and post tools on the `permissions.ask` list:

| Server | What It Does | Setup |
|--------|-------------|-------|
| **GitHub** | PR creation, code search, issue management | `gh auth login`, then add the server |
| **Exa** | Real-time web intelligence (powers the web-scan cron) | Get an API key at exa.ai |
| **Context7** | Current documentation lookup for any framework | Free, no auth needed |

## Origin

This architecture was built over 60 days by John Tehrani starting from a blank Claude Code install. The full story: [From Memory to Operating System](https://jtehrani84.github.io/context-engineering/from-memory-to-operating-system.html)

## Questions?

- **Issues:** [github.com/jtehrani84/context-engineering/issues](https://github.com/jtehrani84/context-engineering/issues)
- **Author:** John Tehrani ([@jtehrani84](https://github.com/jtehrani84))
