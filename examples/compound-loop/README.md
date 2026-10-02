# The Compound Loop — A Real Example

This walks through one concrete mistake becoming permanently prevented. Every correction follows this lifecycle:

```
Mistake --> Correction --> Memory --> Rule --> Hook --> Prevention
```

The system develops immunity to its own failure modes.

---

## Day 1: The Mistake

You ask Claude to draft a customer email:

> "Write a follow-up email to the VP of Engineering at Acme Corp about last week's analytics conversation."

Claude writes:

```
Hi Sarah,

I hope this finds you well. I wanted to circle back on our conversation
about how our platform can help Acme leverage its data ecosystem to unlock
new insights and empower your engineering team with seamless, robust
analytics capabilities.

Our cutting-edge platform can streamline your data operations...
```

This is unusable. "Leverage", "ecosystem", "unlock", "empower", "seamless", "robust", "cutting-edge", "streamline" -- eight banned words in one paragraph. No human professional talks like this.

---

## Day 1: The Correction

You tell Claude:

> "Never use those words. They sound like AI wrote it. Here's my rule: no leverage, ecosystem, unlock, empower, seamless, robust, cutting-edge, streamline, utilize, harness, holistic, delve, or any word that makes you sound like a marketing bot."

Claude saves a memory file. See `feedback-anti-slop-example.md` in this directory for the exact content. The frontmatter follows what Claude Code writes itself; `templates/memory/README.md` explains each field.

---

## Day 3: Memory Becomes a Rule

After collecting 3-4 similar corrections, you (or Claude) codifies the pattern into a permanent rule file at `~/.claude/rules/communication.md`:

```markdown
# Communication & Voice Standards

## Banned Words (AI Slop)
The following words are banned from ALL generated content.
They make output sound like AI wrote it. Use plain English instead.

Banned: delve, leverage, ecosystem, unlock, empower, streamline, harness,
holistic, robust, seamless, cutting-edge, utilize, facilitate, solutioning,
ideation, learnings, synergy, paradigm, transformative, pivotal,
groundbreaking, spearhead, foster, bolster, fortify, underpin, cornerstone,
linchpin, bedrock, tapestry, multifaceted, nuanced, comprehensive,
innovative, disruptive, game-changing, best-in-class, world-class,
state-of-the-art, next-generation, mission-critical

## Replacement Guide
- "leverage" --> "use" or "build on"
- "ecosystem" --> "tools" or "community" or the specific thing
- "unlock" --> "enable" or "get"
- "empower" --> "let" or "give [person] the ability to"
- "seamless" --> "smooth" or "simple" or just cut the word
- "robust" --> "reliable" or "thorough" or the specific quality
- "cutting-edge" --> "new" or "latest" or just cut the adjective
- "streamline" --> "simplify" or "speed up"
```

Rules are auto-loaded into every session. Claude now avoids these words by default.

---

## Day 7: Rule Becomes a Hook

But rules are soft enforcement. Sometimes context windows get long, rules get buried, and Claude slips. So you add a hook that checks AFTER content is written.

See `guardrail-example.py` in this directory. This script:

1. Fires after any Write operation on `.md` or `.html` files
2. Scans the written content for banned words
3. If any are found, prints the exact words and line numbers as `hookSpecificOutput.additionalContext`, the field Claude Code puts next to the tool result
4. Claude sees the warning and rewrites

---

## The Result

```
Week 1:  Claude uses "leverage" 4x per session
Week 2:  Memory prevents most occurrences (soft enforcement)
Week 3:  Rule catches the rest (loaded every session)
Week 4+: Hook catches the 1% that slips through

Error rate: 4x/session --> ~0/session
Human effort: one correction on Day 1, zero effort after Day 7
```

The entire error class is eliminated. You never explain this again.

---

## How This Generalizes

| Initial Mistake | Memory File | Rule | Hook |
|----------------|-------------|------|------|
| Uses banned words | feedback-anti-slop-words.md | communication.md banned list | output-quality-gate.py |
| Hallucinated product name | feedback-product-names.md | domain-terms section in rules | domain-verification.py |
| --set-env-vars wipes all vars | feedback-deploy-envvars.md | infrastructure-constraints.md | guardrail.py blocks the flag |
| Commits .env file | feedback-no-secrets.md | security.md | guardrail.py blocks the write |
| Assumes environment config exists | feedback-verify-first.md | architecture.md "check first" rule | (no hook needed -- rule suffices) |

Every mistake you correct feeds the same loop. After 30 days, you have 50+ immunities running silently.

---

## Key Insight

The compound effect is not linear. Each layer reinforces the others:

- **Memory** = "I was told this once"
- **Rule** = "This is always true"
- **Hook** = "This is enforced mechanically"

Most AI tools only have the memory layer. The rule and hook layers are what make the system production-grade.
