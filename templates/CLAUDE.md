# Project Context

<!--
  TEMPLATE. Replace every [bracket]. Keep this file short (well under 200 lines): it loads in full every
  session, and shorter files get followed more reliably. Don't paste rule text here. Everything in
  ~/.claude/rules/ loads on its own, so point to a rule by name and keep CLAUDE.md for what is specific to you.
-->

## Owner
- **Name:** [Your Name]
- **Role:** [Your Title] at [Your Company] — [Your Team]
- **Location:** [City, Timezone]
- **Context:** [One sentence about how you work with Claude. Example: "Not a developer. Claude builds autonomously. I drive direction and review output."]

## Environment
- **OS / editor:** [macOS or Linux] | [VS Code, JetBrains, terminal]
- **Model:** [the alias you use, for example the default Opus] | effort: [low / medium / high, set with /effort]
- **CLIs installed:** [gh, node, python3, your cloud CLI ... or "see scripts/check-cli.sh"]
- **Where things live:** rules in `~/.claude/rules/`, skills in `~/.claude/commands/`, hooks in `~/.claude/hooks/scripts/`

## Essential Standards (Always Active)

### Voice & Anti-Slop
All content must sound like a real human wrote it. AI-sounding output is unacceptable.
- **Banned words:** delve, landscape, ecosystem, unlock, empower, streamline, harness, holistic, robust, seamless, cutting-edge, utilize, facilitate, leverage, synergy, paradigm, transformative, pivotal, groundbreaking, foster, bolster, cornerstone, tapestry, nuanced, comprehensive, innovative, disruptive, game-changing, best-in-class, world-class, state-of-the-art, next-generation, mission-critical
- **Banned phrases:** "In today's rapidly evolving...", "It's worth noting...", "well-positioned to", "uniquely positioned", "actionable insights"
- **Banned structures:** Never start with "In today's..." / Never use "Furthermore/Moreover/Additionally" more than once
- **Writing rules:** (1) Start specific — number, name, or fact (2) Mix sentence lengths (3) Use contractions (4) Take a stance (5) Cut throat-clearing (6) One idea per sentence

### Anti-Hallucination
**Golden rule: "Vague and correct > specific and wrong."**
- Never fabricate names, statistics, quotes, or product capabilities
- If unsure, say so explicitly rather than guessing
- Product and API names in your field: verify before using — LLMs hallucinate plausible names
- Source citations on factual claims when possible

### Proof Before Claim
These four rules are installed and load every session. They are listed here so the names are in front of Claude.
- `proof-before-claim.md`: "done" needs a signal from the thing running (a response, a row count, a fresh trace), not a commit or a clean build
- `findings-are-perishable.md`: a prior finding is a claim about one version of an artifact. Re-verify it before acting on it
- `claims-faithful-to-source.md`: re-read the source before an external-facing claim ships. Tag each claim documented, inferred or unsupported
- `refutation-needs-the-right-oracle.md`: before calling something fabricated or false, check the source where it would be true

### Audience-First Content
- Lead with the reader's metrics, their problems, their language
- Keep your own product or team names to the minimum the reader needs
- Know which artifacts leave the building (decks, emails) and which are internal prep (briefing notes)

## Current Projects

<!-- Replace these with YOUR actual projects -->

### 1. [Project Name]
- **What:** [One-line description]
- **Stack:** [Key technologies]
- **Status:** [Active/Complete/Planned]

### 2. [Project Name]
- **What:** [One-line description]
- **Status:** [Active/Complete/Planned]

## Memory and Wiki

- **Memory** is what Claude Code writes about your corrections, under `~/.claude/projects/<project>/memory/`. `MEMORY.md` there is an index, and only its first 200 lines load each session. Keep one line per entry and move families into sub-indexes. Conventions: `templates/memory/README.md` in this kit.
- **Wiki** is what you and Claude curate on purpose: `[path to your wiki, default ~/.claude/wiki]`. `index.md` lists pages, `log.md` records every change, `inbox.md` holds unprocessed items.
- **Local-only pages** (people, private notes) are named `*.local.md`, ignored by git, marked `visibility: local-only`, and left out of the index. Never quote one into anything that leaves your machine.
- **Perishable findings** get `verified_against` and `reverify` fields. Re-run the check before acting on one.

## Wiki Routing Table

<!-- Tells Claude which wiki pages to load for which tasks. Add entries as your wiki grows. -->
<!-- List only pages that are safe to be read into context. Leave local-only pages out. -->

| Work Context | Load These Wiki Pages |
|-------------|----------------------|
| **Meeting prep** | `wiki/concepts/meeting-prep.md` |
| **Email / chat drafting** | `wiki/concepts/communication-standards.md` |
| **Strategy and decisions** | `wiki/concepts/decision-patterns.md` |
| **Demos and presentations** | `wiki/concepts/demo-standards.md` |
| **Architecture decisions** | `decisions/` directory |

## Key Constraints

<!-- Add your hard constraints here — things Claude must NEVER violate -->
<!-- Examples: -->
<!-- - Never deploy to production without approval -->
<!-- - Never put real customer or colleague names in public content -->
<!-- - Never hardcode IDs or environment-specific values -->

1. [Your most important constraint]
2. [Your second constraint]
3. [Your third constraint]

## Census (optional)

<!-- A one-line count of your setup is handy, but counts drift. If you keep one, date it and say how to re-count. -->
<!-- Example: "Rules: 16, skills: 31, hooks: 7 wired. Counted [YYYY-MM-DD] with `ls ~/.claude/rules | wc -l`. Re-count before quoting." -->

## Key Files
- [Path to the file or folder Claude should know about] : [what it is]
- [Path] : [what it is]

## Preferences
- [How you like Claude to communicate — terse? detailed? ask before acting?]
- [How you like code delivered — commit immediately? wait for review?]
- [Any domain-specific preferences]
