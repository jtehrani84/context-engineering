# What You Get — Complete Inventory

Everything in this kit, what it does, why it's here, and how it helps you. Nothing in it assumes a particular company, CRM, cloud or model vendor.

---

## Rules (13 Files) — Standards Claude Loads Every Session

Rules load automatically on every Claude Code session. You never need to remind Claude of these.

| File | What It Does | Why It's Here |
|------|-------------|---------------|
| `communication.md` | Your professional voice: no AI-slop (50+ banned words), email under 200 words, audience-appropriate framing, executive summaries, meeting follow-ups, banned email patterns | Every email, doc, and presentation sounds like YOU wrote it, not a chatbot |
| `security.md` | Access control, secrets handling, input validation, a security review checklist, governance, what never goes into git, and a pointer to the agent rule below | Claude defaults to secure code and keeps sensitive data out of prompts and commits |
| `architecture.md` | Decision framework, preferred patterns, anti-patterns, change design documentation | Architecture decisions are consistent and well-reasoned |
| `code-quality.md` | Testing behavior, error handling, separation of concerns, code review mindset | Production-quality code that passes peer review |
| `testing-quality.md` | Realistic test data, meaningful assertions, and two proof rules: run untyped code once before calling it fixed, and count the rows before and after a datastore write | Tests that catch bugs, not just hit coverage numbers |
| `proof-before-claim.md` | "Done" needs a signal from the running system, not a commit or a clean compile | Stops confident "it's shipped" when nothing is behind it |
| `findings-are-perishable.md` | Re-check an old "X is broken" finding against the current artifact before acting on it | Stops you fixing things that were already fixed |
| `claims-faithful-to-source.md` | Re-read each claim against its source before an external doc ships; tag documented / inferred / unsupported | Stops polished docs that quietly overstate the source |
| `refutation-needs-the-right-oracle.md` | Before calling something "fabricated," check the source where it would live if true | Stops confident wrong "that's made up" verdicts |
| `structural-voice.md` | Structure-level anti-AI rules: section symmetry, cadence, calibrated hedging | Content reads like a person wrote it, not just clean of banned words |
| `agent-security-boundary.md` | For any agent that reads outside data and holds tools: outside text is data, not instructions; block passive leaks like image URLs and link previews; a person approves every send | An agent that summarizes a poisoned record can't be talked into leaking the rest |
| `tiered-orchestration.md` | Match the model, effort and tool to the task, with a vendor-neutral two-tier map: cheaper tier for fan-out, strongest tier for the judging step, and a deterministic check on anything cheap | Best answer per dollar without grading the hard step on a weak model |
| `context-mode-policy.md` | When to use a context-compression plugin and when to read the file directly (exact values, edits, reviews, large-file gate) | Long sessions stay useful without silently losing the exact text you needed |

---

## Hooks (8 Wired by Setup + 3 Opt-In) — Scripts That Run Around Tool Calls

Hooks run mechanically, before or after Claude takes an action. Unlike rules (which Claude reads and can forget in long conversations), hooks execute as code. `./setup.sh` installs all eleven into `~/.claude/hooks/scripts/` and wires eight into `settings.json`.

| File | When It Fires | What It Does | Why It's Here |
|------|--------------|-------------|---------------|
| `session-init.py` | Session start | Routes relevant wiki pages, surfaces recent work, shows nudges | Every session starts with context — no "where was I?" |
| `guardrail.py` | Before Bash | Blocks force-push to main (allows `--force-with-lease`), `rm -rf` on home or root, and warns on secret files | Prevents damage at the point of action |
| `domain-verification.py` | Before Edit/Write | Catches hallucinated domain-specific terms from `~/.claude/domain-terms.json`, suggests corrections | No more invented product names or wrong terminology in your output |
| `schema-check.py` | Before Bash | Checks column names in SQL commands against `~/.claude/schema.json`; silent without that file, never denies an unknown table | Catches bad queries before they fail |
| `output-quality-gate.py` | After Write | Scans .md/.html files for 50+ banned AI-slop words, reports exact line numbers | Content quality is enforced mechanically, not by memory |
| `voice-tell-gate.py` | After Write/Edit/MultiEdit, before send tools | Runs the voice engine (`~/.claude/tools/aiscore.mjs`, `text-normalize.mjs`) on written `.md`, `.mdx`, `.html`, `.htm`, `.txt`, `.rtf` and `.docx` files (a file under `drafts/` at any length) and nudges; on a chat, email, document, comment or pull-request send it blocks a hard tell. If the engine can't run, it denies the send and warns on the file write | The voice engine runs on everything Claude writes, and a send that can't be checked doesn't go out |
| `voice-draft-gate.py` | When a reply ends (Stop) | Checks a draft Claude showed in a ` ```draft ` fence (or the piece after a `Written for:` line) with the send hook's scorer; a hard tell sends Claude back to fix the draft in the same reply, at most twice; if it can't run, the reply ends with a "draft not checked" note, never a trapped session | The message you copy out of the chat gets the same check as one Claude sends |
| `deploy-proof-gate.py` | After Bash | After a deploy or publish command, reminds Claude to prove the change on the running system | "Deployed" stops meaning "the command exited 0" |
| `claim-faithfulness-gate.py` | After Write/Edit, **opt-in** | On an external-facing doc with over-confident claim language, asks for a re-read against sources | The proof rule gets a nudge at the moment a doc is written |
| `refutation-oracle-gate.py` | After Write/Edit, **opt-in** | On an audit that calls something fabricated, asks for a check of the source where it would be true | Wrong "that's made up" verdicts get caught before they stand |
| `graph-auto-index.py` | After Write/Edit, **opt-in** | Indexes entities into a SQLite knowledge graph, computes relationship edges, and drops rows for files you delete | Your knowledge graph grows from your work once you turn it on |

`KIT_WIRE_PROOF_GATES=1 ./setup.sh` wires the two prose gates. All three proof gates nudge by default; `KIT_PROOF_GATES=block` makes them block. Wire the graph indexer by hand from `settings.json.example`. `python3 hooks/selftest.py` feeds synthetic payloads to every hook and checks the output contract.

---

## Skills (28 Commands) — Workflows Compressed into Single Commands

Each skill replaces 15-60 minutes of manual work. Say the command, get the output. Setup installs them into `~/.claude/commands/`.

### Professional Workflows (8)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/research-prep` | Full pre-meeting intelligence: topic + context + competitors + agenda | 30 min -> 2 min |
| `/strategy` | Strategic analysis: options, tradeoffs, recommendation for any decision | 45 min -> 3 min |
| `/draft` | Professional content with anti-slop, audience-matched tone | 15 min -> 30 sec |
| `/follow-up` | Capture outcomes, action items, schedule next steps | 20 min -> 2 min |
| `/presentation-prep` | Talk/demo prep with audience analysis, flow, and delivery coaching | 30 min -> 3 min |
| `/action-plan` | Multi-step initiative plan with stakeholders and milestones | 60 min -> 5 min |
| `/design-doc` | Architecture or design document for any system | 2 hrs -> 15 min |
| `/gas-deploy` | Google Apps Script push + deploy + verify, so `clasp push` without `clasp deploy` stops biting you | One forgotten step, gone |

### Quality and Proof (9)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/validate` | Scores the content in-session (SHIP / FIX FIRST / REWRITE), then asks a model from another lab through your endpoint. With no endpoint configured, it says the second read didn't happen | Manual review -> automated |
| `/review` | Adversarial review by a model from a different lab than the drafter, through `scripts/llm-review.py` | A second opinion that isn't grading its own house style |
| `/voice-check` | Anti-slop scanner: the full banned list, replacements, pass/fail (for a 0-100 score, run `node ~/.claude/tools/aiscore.mjs <file>`) | Catches what you'd miss |
| `/voice-judge` | The gestalt read for register tells no regex reaches; it can veto a clean voice score | Catches prose that's clean but still reads as generated |
| `/voice-setup` | Walks you from a fresh install to `voice-doctor` GREEN: config, hook wiring, your samples, a drafted overlay you review, held-out calibration | The voice engine learns your tells without your samples leaving the machine |
| `/content-review` | 6-dimension universal reviewer with scoring rubric | Peer review -> instant |
| `/claim-audit` | Extract every claim in an external-facing artifact and re-verify each against its source | Overstated or inverted claims get caught before they ship |
| `/plan-audit` | Try to refute a "code-verified" plan's claims against the real code | Nobody builds from a wrong file:line claim |
| `/execution-truth` | Runtime-prove every write, endpoint and optional step a system claims: live, silent-zero, stale, or ghost | "Did a row actually land?" gets a real answer |
| `/provenance-audit` | Route each disputed claim to the source where it would be true before any "fabricated" verdict stands | Wrong RED verdicts stop at the door |

### Intelligence & Growth (5)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/morning-brief` | Daily context: overnight intel, git status, memory changes, suggested actions | 15 min orientation -> instant |
| `/scan-intel` | Intelligence sweep: web + HN + GitHub -> categorized with ADOPT/EVALUATE/WATCH | 30 min research -> 3 min |
| `/ingest` | Process any new source (PDF, URL, doc) into wiki pages with entity extraction | Manual notes -> structured knowledge |
| `/week-plan` | Weekly planning: projects + priorities + blockers | 30 min planning -> 5 min |
| `/weekly-report` | Status report from git + memory + wiki activity | Manual tracking -> automated |

### System Maintenance (4)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/curate` | Memory maintenance: staleness scan, promotion, inbox processing, orphan detection | Knowledge base stays healthy |
| `/wiki-lint` | Wiki health check: orphans, dead links, stale pages, broken structure | Wiki stays trustworthy |
| `/system-health` | System diagnostics: hooks firing, rules loading, graph growing (fills `templates/reports/system-health.html`) | Debug your setup |
| `/graph-query` | Query the knowledge graph: find relationships, connections, related files | "What do I know about X?" -> instant |

### Compound Loop (2)

| Skill | What It Does | Time Saved |
|-------|-------------|-----------|
| `/skillify` | Meta-skill: do work -> extract pattern -> new permanent command. Skills build skills. | Manual skill authoring -> automatic |
| `/context-load` | Cross-project context restore: load state from another project into current session | Context switching -> instant |

---

## Voice Engine, Eval Harness and Model Scripts (tools/, harness-evolution/, scripts/)

| Component | What It Does | How It Helps |
|-----------|-------------|-------------|
| `tools/aiscore.mjs` + vendored detector | 0–100 AI score from the vendored MIT detector (pinned at 58a95fc), an evidence-only adjusted score, and your personal overlay (shipped blank). The structural and cadence checks are described in `rules/structural-voice.md`; they run only if your overlay defines them | The engine `voice-tell-gate.py` runs on; also callable as `node ~/.claude/tools/aiscore.mjs <file>` |
| `tools/text-normalize.mjs`, `tools/prose-gate.mjs` | The normalizer (invisible characters, look-alike letters, markup) and the ship gate: the deterministic layer plus an optional judge panel that never uses the drafter's lab; `--det-only` makes no network call | A tell can't hide behind odd characters, and a judge doesn't grade its own lab |
| `tools/onboarding/`, `tools/calibration/`, `tools/hook/`, `tools/hook-tests/` | The `/voice-setup` tools (`voice-doctor.mjs`, `profile-build.mjs`, `calibrate-user.mjs`), the false-positive budget on four public corpora (the gate's verdicts and the send hook's word list), the send hook's and the draft gate's source and tests, and `onboarding/templates/company-names.example.txt` for the names your "As <Company>" check should know | Each claim about the guard has a command that checks it |
| `docs/voice/` | The voice system docs: architecture, threat model, runbooks, the reference generated from the code, calibration evidence, and a review packet for outside reviewers; rendered at `docs/voice/site/` | One place to read how it works and how to check it |
| `harness-evolution/` | Held-out eval harness plus a generic seed corpus you replace with your own writing | Prove a guard change is a real improvement, not a lucky sample |
| `tools/rag-quality/` + `tools/llm.mjs` | ECHO error attribution over Claude Code workflow traces (runs as-is), one query-rewrite tool that runs once `llm.mjs` points at your endpoint, and three method skeletons you aim at your own corpus | Find which agent or step broke a multi-agent run |
| `scripts/llm-call.py`, `scripts/llm-review.py` + `scripts/review-prompts/` | Call any model behind an OpenAI-compatible endpoint or the Anthropic API (`LLM_BASE_URL`, `LLM_API_KEY`); run the cross-lab review behind `/review` with its adversarial or editorial prompt. No model ids are hard-coded, and an error never looks like an answer | One configuration for every second-model read |
| `tools/transcript-export/transcript_to_md.py` | Converts a session `.jsonl` into readable Markdown, masks credential-shaped strings by default, and can slice one day in your time zone | Review or share a session without pasting raw JSON |
| `workflows/` | The four proof-family audit workflows behind `/claim-audit`, `/plan-audit`, `/execution-truth`, and `/provenance-audit` | Installed to `~/.claude/workflows/` so the skills can run them |
| `scripts/check-cli.sh` | Detects installed CLIs and recommends what to add | Setup runs it first and stops if a required CLI is missing |

---

## Agent Guards (guards/, Not Installed by Setup)

Working code for the controls `rules/agent-security-boundary.md` describes, with their tests (`bash guards/run-tests.sh`). They're a library you wire into your own agent; setup doesn't install them.

| Component | What It Does | How It Helps |
|-----------|-------------|-------------|
| `egress-guard.mjs` | Scans agent output for URLs, matches hosts on their canonical form against an allowlist, and denies anything it can't parse | A data-carrying image link or link preview can't slip out |
| `broker.mjs` | Swaps sensitive values for run-scoped tokens before they reach a model or leave the run, with a leak check on the canonical form | Record IDs and names don't travel in prompts or output |
| `reducer.mjs` | Shrinks a long log, then checks the result against the original and returns the original if any check fails | A cheap summarizer can't quietly drop the line you needed |
| `protect-paths.py` | A PreToolUse hook that denies writes under the paths you list (`PROTECT_PATHS` or `~/.claude/protected-paths.txt`); protects nothing until you configure it | The guards' own files can't be edited by the agent they guard |
| `scrub.mjs` | Leak scan for IP addresses, record IDs, key shapes, emails, dollar figures and home paths, plus your own private denylist of names and hosts (kept out of git) | Run it before you publish anything |
| `primitives.mjs`, `verifier.mjs`, `canary.mjs`, `fuzz.mjs`, `mcp-classify.mjs` | Injection and drift detectors, tiered verification, canaries that prove a guard can still fail, seeded fuzzing, and a fail-closed MCP tool classifier | The pieces the guards above are built from, each with tests |

---

## Knowledge Graph (SQLite, Opt-In)

A local graph database that grows from your work. No external infrastructure — just Python + SQLite.

| Component | What It Does | How It Helps |
|-----------|-------------|-------------|
| `graph-auto-index.py` hook (opt-in) | Every Write/Edit indexes entities and computes relationships | Setup installs it; wire it as a PostToolUse hook on `Write\|Edit` (see `settings.json.example`) and the graph builds itself |
| `graph-query` skill | Query relationships: "what relates to X?", "what mentions Y?" | Discover connections you didn't know existed |
| `wiki/entities/` | Company, product, concept pages indexed by the graph | Structured knowledge the graph can traverse |
| `wiki/people/` | Person pages with context and timelines | Relationship intelligence that compounds |

**How it compounds:** Write a memory about a project. The hook indexes the entities, people mentioned, and concepts discussed. Next time you prep for a meeting about that project, `/graph-query` surfaces related wiki pages, other mentions of those people, and memory files you'd forgotten about, as long as the indexer was on when you wrote them.

---

## Passive Intelligence (Crons, Overnight Growth)

Your knowledge base can grow overnight. `cd crons && ./manage.sh install` schedules every job that ships with a launchd plist (macOS). Put your Exa key in the web-scan plist first; `manage.sh` warns you if it's still the placeholder. The session backup has a plist too, but it turns on only with `manage.sh install --with-backup`, because it keeps a second copy of every session transcript. The digest needs the `claude` CLI on launchd's PATH, which the plist sets for the usual install locations.

| Script | Schedule | What It Does | How It Helps |
|--------|----------|-------------|-------------|
| `web-scan.py` | Daily 4:30 AM | 5-query web intelligence through Exa (your topics, competitors, tools, trends) | Morning brief has fresh web intel |
| `hn-scan.py` | Daily 4:45 AM | 4-query Hacker News practitioner sentiment (free, no auth) | Know what practitioners are saying |
| `github-scan.py` | Daily 4:50 AM | Trending repos + release monitoring on the repos you list | What people are actually adopting |
| `morning-digest.sh` | Daily 5:00 AM | Synthesizes the day's gathered files into `~/.claude/wiki/inbox.md` with `claude -p` | One place to check each morning |
| `curate-prep.py` | Weekly, Sunday 11:00 PM | Read-only scan of your memory and wiki (staleness, orphans, index size) written to `CURATE-PENDING.md`; never moves or deletes a file | Your next `/curate` starts from a finished scan |
| `memory-decay-check.sh` | By hand (no plist) | Flags memory files unchanged >45 days | Catch stale knowledge before it misleads |
| `backup-sessions.sh` | 12:30 PM and 10:30 PM, **opt-in** | Local mirror plus dated snapshots of `~/.claude/projects`, owner-only permissions, a free-space guard. No network | A deleted session or memory folder can be restored |
| `manage.sh` | Manual | Install / uninstall / status / test / logs for the launchd agents | One command to manage the whole system |

---

## Wiki Skeleton (7 Directories, Copy It to Use It)

A wiki skeleton ships in `wiki/` and `templates/wiki/`. `./setup.sh --with-wiki` copies it to `~/.claude/wiki/` without overwriting pages you already have; a plain `./setup.sh` doesn't. The morning digest writes to `~/.claude/wiki/inbox.md`.

| Directory | What Goes Here | How It Grows |
|-----------|---------------|-------------|
| `wiki/concepts/` | Patterns, frameworks, methodologies | From /ingest, /scan-intel, and manual capture |
| `wiki/entities/` | Companies, products, concepts (graph-indexed) | From /research-prep, /action-plan, manual |
| `wiki/people/` | Person pages — colleagues and external contacts | From profile seeding, /follow-up |
| `wiki/projects/` | Project overviews and status | Manual — one page per active project |
| `wiki/tools/` | Tool documentation and setup guides | From /ingest when you learn a new tool |
| `wiki/events/` | Conference notes, event summaries | From /ingest after events |
| `wiki/insights/` | Research findings, analytical work | From /scan-intel ADOPT NOW items |
| `wiki/decisions/` | Decision records: what you chose, what you rejected, why | One page per decision worth remembering |
| `wiki/index.md` | Master catalog of all pages (Claude uses this to navigate) | /ingest adds each new page; /wiki-lint checks it against the files |
| `wiki/inbox.md` | Staging area for overnight intel and captures | The morning digest prepends each day's intel |
| `templates/wiki/log.md` | Append-only change log | One line per page added or changed |

---

## Configuration and Templates

| File | What It Does | How It Helps |
|------|-------------|-------------|
| `settings.json.example` | Annotated Claude Code settings: hooks in the nested format, a `permissions.ask` list for tools that send or post in your name, model endpoint variables, a Notification hook. The `//` comments make it invalid JSON as written | Reference for merging blocks by hand; never copy it over your `settings.json` |
| `templates/CLAUDE.md` | Identity template with routing table, role definition, essential standards, the proof rules, and memory and wiki conventions | Your orchestration manifest — Claude knows who you are from session 1 |
| `templates/memory/` | Memory conventions plus made-up examples: the frontmatter Claude Code writes, a tiered `MEMORY.md` index with a sub-index, and a perishable finding stamped with `verified_against` and `reverify` | Keeps the index useful as memories pile up |
| `templates/reports/` | HTML report templates for the morning brief, a session report, and system health | `/system-health` fills in its template |
| `templates/apps-script/` + `docs/apps-script-setup.md` | Three starter Apps Script files (email merge, sheet data puller, slides from sheet) and the setup guide | Pairs with `/gas-deploy` |
| `rules-optional/` | Two opt-in design rules (Tailwind, a dense dark dashboard style) that setup never copies | Load one when you build a page in that style |
| `docs/recommended-plugins.md` | Plugins worth installing and what each one wires | Get maintained skills and hooks without copying them into the kit |
| `QUICKSTART-PROMPT.md` | Paste into Claude Code after `./setup.sh`; it asks 5 questions and writes your CLAUDE.md without recreating the installed rules, hooks or skills | Your CLAUDE.md is built around your role and projects |
| `VOICE-ONBOARDING.md` | Eight-step calibration of the voice guard to your own writing, and the drafts-first habit the draft gate relies on | Lifts the "generic-only" label once the guard knows your voice |
| `docs/what-you-get.html` | This inventory as a web page | Hand-off material for your team |

---

## Examples

| File | What It Shows | Why It Matters |
|------|-------------|---------------|
| `examples/compound-loop/README.md` | Full walkthrough: banned word -> memory -> rule -> hook -> permanent prevention | Proves the compound effect is real, not theoretical |
| `examples/compound-loop/feedback-anti-slop-example.md` | What a real memory file looks like, with the frontmatter Claude Code writes | Template for how corrections get stored |
| `examples/compound-loop/guardrail-example.py` | Simplified hook that catches banned patterns, with its own test (`test_guardrail_example.py`) | Shows how hooks work in practice |

---

## The Compound Effect (Why All This Matters Together)

No single component does much on its own. The value is in how they interact:

```
Day 1:  You correct Claude -> Memory file saved
Day 3:  Same mistake class -> Rule tells Claude to avoid it
Day 7:  Rule might be forgotten in long sessions -> Hook checks mechanically
Day 14: Hook catches a pattern -> Skill extracts it via /skillify
Day 30: Overnight crons (once you run manage.sh install) feed new intel -> Morning brief surfaces it
Day 60: Graph (once you turn it on) connects entities you didn't know were related -> Better prep
```

Each layer reinforces the others. Memory feeds rules. Rules feed hooks. Hooks feed skills. Skills feed the graph. The graph feeds session-init. Session-init feeds the next conversation. The loop never stops.

**This is why starting matters more than perfecting.** A mediocre setup that runs for 60 days beats a perfect setup that runs for 1 day. Compound growth is the product.
