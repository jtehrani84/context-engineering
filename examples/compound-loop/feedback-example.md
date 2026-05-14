# Example Memory File: feedback-no-leverage.md

This is what a real memory file looks like when Claude saves a correction.

---

```markdown
# Voice: Don't use "leverage"

## What Happened
Used "leverage" in a stakeholder update draft. User corrected: sounds like AI wrote it.

## The Rule
Never use "leverage" in professional content. Replacements:
- leverage -> use, build on, apply
- leveraging -> using, building on
- "leverage our platform" -> "use our platform" or "build on our platform"

## Why
The word is a dead giveaway that AI generated the text. Real professionals say "use."
It's also vague — "leverage" obscures what's actually happening.

## Context
- Applies to: all written content (emails, docs, presentations, updates)
- Exception: code comments about Git (git leverage is fine in technical context)
- Exception: quoting someone else's words

## Related
- See also: full banned word list in rules/communication.md
- Part of: anti-slop standards
```

---

## What Makes This Effective

1. **Specific**: Names the exact word and provides exact replacements
2. **Contextual**: Explains WHY, not just WHAT
3. **Scoped**: Notes where it applies and where exceptions exist
4. **Connected**: Links to related rules and standards

## How It Gets Used

- **Session start**: session-init.py may surface this if working on written content
- **Mid-session**: Claude checks memory before writing long content
- **Over time**: This pattern gets promoted to a rule, then a hook
