# The Compound Loop — A Complete Walkthrough

This example shows how a single correction evolves into permanent enforcement over time. This is the core mechanism that makes context engineering compound.

## The Scenario

You're a product manager writing weekly updates. Claude keeps using the word "leverage" in your content.

## Day 1: The Correction

You ask Claude to draft a stakeholder update. It writes:

> "We're leveraging the new analytics dashboard to drive insights across the organization."

You say: **"Don't use the word 'leverage'. It sounds like AI wrote it. Use 'use' or 'build on' instead."**

Claude corrects the sentence and saves a memory file:

```
~/.claude/projects/your-project/memory/feedback-no-leverage.md
```

See `feedback-example.md` for what this file looks like.

## Day 3: The Rule

You notice Claude used "leverage" again in a long conversation (memory got buried in context). You add it to `~/.claude/rules/communication.md`:

```markdown
### Banned Words
- leverage -> use, build on, apply
```

Now it's loaded at session start. But rules can still be forgotten in 100K+ token conversations.

## Day 7: The Hook

After catching "leverage" one more time (in a particularly long session), you create a hook. This is code that runs AFTER every Write operation and mechanically scans the output:

```python
# ~/.claude/hooks/scripts/output-quality-gate.py
BANNED_WORDS = ["leverage", ...]
```

See `guardrail-example.py` for a simplified version.

Now it's impossible to forget. The hook fires on every file write, checks for banned words, and reports violations with line numbers. Claude immediately rewrites.

## Day 14: The Skill

You realize the voice-checking pattern is useful enough to invoke manually. You run `/skillify` and create:

```
/voice-check — scans any content for the full 50+ word banned list
```

Now you can proactively check content before sending it.

## Day 30: The Graph

The memory file about "leverage" is indexed by the knowledge graph. When Claude preps for a stakeholder meeting (via `/research-prep`), the graph surfaces your voice preferences alongside the meeting context. The system doesn't just prevent mistakes — it proactively applies your preferences.

## The Full Loop

```
Mistake ("leverage" in output)
    |
    v
Correction ("don't use that word")
    |
    v
Memory File (saved for next session)
    |
    v
Rule (loaded at every session start)
    |
    v
Hook (mechanical enforcement, can't be forgotten)
    |
    v
Skill (proactive checking on demand)
    |
    v
Graph (contextual awareness across all work)
    |
    v
The mistake class is EXTINCT
```

## Why This Matters

A single correction on Day 1 becomes a permanent part of your system's immune response. After 60 days, you've made hundreds of corrections. Each one has followed some version of this path. The result: Claude produces work that sounds like you, thinks like you, and avoids your known pitfalls — without you having to remind it.

**This is compound growth.** A mediocre setup running for 60 days beats a perfect setup running for 1 day.
