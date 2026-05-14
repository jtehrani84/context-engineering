# Quickstart Prompt

Paste this into Claude Code to have it build your personalized setup interactively:

---

```
I want to set up persistent context architecture for Claude Code. Here's what I need you to do:

1. First, ask me 5 questions:
   - What's my name, role, and what do I do professionally?
   - What are my top 2-3 current projects?
   - What's my biggest recurring mistake or frustration with Claude?
   - What type of content do I produce most? (emails, code, analysis, docs, presentations)
   - What domain-specific terms does Claude get wrong in my field?

2. Then build my setup:
   - Create ~/.claude/rules/ with 4 files: communication.md, security.md, architecture.md, code-quality.md
   - Create a CLAUDE.md in my current project directory with my identity, projects, and routing table
   - Create ~/.claude/hooks/scripts/session-init.py (context routing hook)
   - Create ~/.claude/hooks/scripts/guardrail.py (blocks my stated biggest mistake)
   - Create ~/.claude/hooks/scripts/domain-verification.py (with my domain terms)
   - Create 5 skill files as custom commands: /research-prep, /strategy, /draft, /follow-up, /presentation-prep
   - Create a wiki/ directory with index.md in my project

3. Wire the hooks into my settings:
   - Add SessionStart hook pointing to session-init.py
   - Add PreToolUse hook pointing to guardrail.py and domain-verification.py
   - Add PostToolUse hook pointing to output-quality-gate.py
   - Show me the settings.json changes needed

4. Test it:
   - Run the session-init hook to verify it works
   - Show me how to use one of the skills
   - Save a test memory file to verify persistence

Use the templates from ~/context-engineering/ as your starting point if that directory exists. Otherwise, use your best judgment based on my answers.

Start with the 5 questions.
```

---

## After Running

Once Claude builds your setup, verify:
- [ ] `~/.claude/rules/` has 4 files
- [ ] Your project has a `CLAUDE.md`
- [ ] `~/.claude/hooks/scripts/` has at least 3 Python files
- [ ] You can run `/research-prep` or `/draft` successfully
- [ ] A memory file gets saved when you say "remember this"

## Growing From Here

- **Week 1:** Use the skills daily. Correct Claude when it makes mistakes — say "remember this" each time.
- **Week 2:** Add wiki pages for patterns you explain more than once. Add a second guardrail for your second-biggest mistake.
- **Week 3:** Set up one MCP server (GitHub is easiest) to give Claude action capabilities.
- **Week 4:** Consider adding the overnight intelligence crons (see `crons/` directory).
