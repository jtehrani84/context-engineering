# /skillify

Extract a reusable workflow from the current session and save it as a new command.

## Trigger
When the user says: "skillify this", "make this a command", "save this workflow", "turn this into a skill"

## Workflow

### 1. Analyze the current conversation
Look at what just happened in this session. Identify:
- What was the repeatable pattern?
- What inputs did it need?
- What output did it produce?
- What rules or constraints were applied?

### 2. Ask 3 scoping questions

Before writing the skill file, ask:

1. **Name:** "What should I call this command? (e.g., /competitor-brief, /standup-notes)"
2. **Trigger:** "When should this fire? Describe in plain language. (e.g., 'when I say prep for competitor X')"
3. **Quality bar:** "What makes the output good vs bad? One sentence. (e.g., 'Must include 3 specific data points, not generic claims')"

### 3. Write the command file

Save to `~/.claude/commands/[name].md` with this structure:

```markdown
# /[name]

[One-line description of what this does]

## Trigger
When the user says: [trigger phrases from answer #2]

## Workflow
[Numbered steps extracted from what happened in session]

## Rules
- [Quality bar from answer #3]
- [Any constraints discovered during the session]
- [Anti-patterns to avoid]

## Output Format
[Structure of the expected output — headings, bullet format, length]
```

### 4. Confirm
Tell the user: "Saved /[name]. It will be available in your next session. Try it with: /[name] [example input]"

## Update Mode

If the user says "skillify update [name]":
1. Read the existing command file at `~/.claude/commands/[name].md`
2. Ask: "What should change? (new steps, different output, add a rule?)"
3. Apply the edit
4. Confirm what changed

## Rules
- Keep skills under 60 lines — if it's longer, the workflow is too complex (break it up)
- Every skill must have a clear trigger, workflow, and output format
- Include at least one anti-pattern or "don't do this" rule
- Test the skill name: would you remember it in 2 weeks?
- Don't duplicate existing skills — check ~/.claude/commands/ first
