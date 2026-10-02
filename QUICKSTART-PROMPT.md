# Quickstart Prompt

Run `./setup.sh` first. It installs the rules, hooks, skills, voice engine and review scripts into `~/.claude/` and wires the hooks into your `settings.json`. This prompt does the part the script can't: it learns who you are and writes your `CLAUDE.md`.

Paste this into Claude Code, from inside the project you work in most:

---

```
I just ran ~/context-engineering/setup.sh. Help me personalize the setup. Do not recreate anything the script already installed.

1. First, ask me 5 questions, one message, numbered:
   - What's my name, role, and what do I do professionally?
   - What are my top 2-3 current projects?
   - What's my biggest recurring mistake or frustration with Claude?
   - What type of content do I produce most? (emails, code, analysis, docs, presentations)
   - What domain-specific terms does Claude get wrong in my field?

2. Check what setup installed. Run:
   ls ~/.claude/rules ~/.claude/hooks/scripts ~/.claude/commands
   and compare against ~/context-engineering/rules, hooks/scripts and skills.
   If something is missing, tell me to re-run ./setup.sh. Don't create those files yourself.
   If one of mine differs from the kit's copy, leave mine alone and tell me.

3. Write my CLAUDE.md in the current project directory, starting from ~/context-engineering/templates/CLAUDE.md.
   Fill in my identity, projects, environment, constraints and preferences from my answers.
   Point to the installed rules by file name. Don't paste their contents into CLAUDE.md.
   If a CLAUDE.md already exists, show me a diff and ask before changing it.

4. Put the domain terms I gave you into ~/.claude/domain-terms.json as {"wrong term": "correction"} pairs,
   so the domain-verification hook can flag them. Show me the file before you save it.

5. Turn my biggest frustration into one guardrail, and show me the change before you save it:
   - If a command pattern can catch it, add one entry to the pattern list in ~/.claude/hooks/scripts/guardrail.py.
   - Otherwise add it as a short rule in a new file under ~/.claude/rules/.

6. Settings. Read ~/context-engineering/settings.json.example and show me the permissions.ask list.
   Ask which of those tools I actually have installed. If I say yes, back up ~/.claude/settings.json, then merge
   only those entries into it by hand. Never copy the example file over my settings.json: it would erase my auth settings.

7. Test it:
   - Run the session-init hook: echo '{"cwd":"'"$PWD"'"}' | python3 ~/.claude/hooks/scripts/session-init.py
   - Show me how to run one skill, for example /draft.
   - Then I'll tell you to remember something. Save it, and show me the file Claude Code wrote under
     ~/.claude/projects/ (the folder name is this project's path with slashes turned into dashes).
     Point out the name, description and type lines at the top.

Don't build a wiki. If I want one, I'll run ./setup.sh --with-wiki.

Start with the 5 questions.
```

---

## After Running

Check each of these:
- [ ] `ls ~/.claude/rules` matches `ls ~/context-engineering/rules`
- [ ] `ls ~/.claude/hooks/scripts` matches `ls ~/context-engineering/hooks/scripts`
- [ ] Your project has a `CLAUDE.md` that names you, your projects and your constraints
- [ ] `~/.claude/settings.json` still has everything it had before, plus the `ask` entries you chose
- [ ] You can run `/research-prep` or `/draft` successfully
- [ ] After "remember this", a new file shows up in your project's memory folder, and `MEMORY.md` gained one line. See `templates/memory/README.md` for how that folder is meant to be organized.

## Growing From Here

- **Week 1:** Use the skills daily. Correct Claude when it makes mistakes and say "remember this" each time.
- **Week 2:** Add wiki pages for patterns you explain more than once (`./setup.sh --with-wiki` gives you the skeleton). Add a second guardrail for your second-biggest mistake.
- **Week 3:** Set up one MCP server (GitHub is easiest) to give Claude action capabilities. Add its send tools to the `ask` list before you use it.
- **Week 4:** Consider adding the overnight intelligence crons (see `crons/`).
