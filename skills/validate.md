# /validate

Cross-model quality gate. Scores the content in this session, then asks a model from a different lab for an independent read through your model endpoint (`LLM_BASE_URL`). If no endpoint is configured, it scores in-session only and says so.

## Trigger
When the user says: "validate this", "quality check", "is this ready to send?", "validate [file]", "second opinion on this"

Add "local only" to skip the second-lab call for this run.

## Workflow

### 1. Identify the content
If a file path is provided, read it. Otherwise, use the last substantive output from this session.

### 2. Score it in this session

Score each dimension 1-10:

**Factual Accuracy**
- Are all claims verifiable?
- Are product, API and technical names correct? (Check the official docs for anything you're unsure of)
- Are numbers, dates, and statistics sourced?
- Any fabricated quotes, case studies, or references?

**Voice Quality**
- Scan for banned AI-slop words (the full 50+ word list)
- Check for banned phrases and structures
- Does it sound like a real person wrote it?
- Would you say this out loud without cringing?

**Specificity**
- Numbers over adjectives? ("34M users" not "massive user base")
- Named examples over generic claims?
- Concrete next steps over vague suggestions?

**Audience Focus**
- Does it lead with what the reader cares about, not what we want to say?
- Is the ratio right (their world vs our pitch)?
- Are their metrics and priorities referenced, not ours?

**Actionability**
- Is there a clear next step?
- Does the reader know what to do after reading this?
- Is there a specific date, time, or owner for the action?

**Credibility**
- Would you send this to a senior executive?
- Would your VP forward this without editing?
- Does it demonstrate expertise or just awareness?

### 3. Get the second-lab read (when an endpoint is configured)

A model grading its own draft is too kind to its own house style, so the second read comes from a different lab than the model that wrote the content. Set `VALIDATE_REVIEWER` to that model's id (or an alias from `LLM_MODEL_ALIASES`), and `VALIDATE_REVIEWER_ALT` to a backup from a third lab. If the content was drafted by a non-Claude model, pick reviewers from labs other than that one.

**3a. Preflight.** Run this. It only checks that the script, an endpoint and a reviewer are configured. It does not call the model.

```bash
# second-lab-preflight
if [ -f "$HOME/.claude/scripts/llm-call.py" ] && [ -n "${LLM_BASE_URL:-}" ] && [ -n "${LLM_API_KEY:-}" ] && [ -n "${VALIDATE_REVIEWER:-}" ]; then
  echo "SECOND_LAB=available"
else
  echo "SECOND_LAB=unavailable"
fi
```

If it prints `SECOND_LAB=unavailable`, or the user said "local only", skip to step 4 and mark the report "Second read: NOT RUN (no endpoint or reviewer configured)" or "(local only)".

**3b. Data check.** The content leaves this machine for another vendor's model. If it names a customer, quotes deal values, account IDs, contact details, or anything marked internal or confidential, stop and ask the user to approve sending it, or to send a copy with those details replaced by placeholders. If they decline, skip to step 4 and mark the report "Second read: NOT RUN (content held back)". Never send credentials, customer records, or unreleased internal material.

**3c. Call the reviewer.** Write the reviewer brief below, then a line containing only `---`, then the content, to one temp file (`TMP=$(mktemp)`). Then run the command and allow up to 5 minutes, since thinking models can be slow:

```bash
python3 ~/.claude/scripts/llm-call.py --model "$VALIDATE_REVIEWER" --plain --timeout 300 --max-tokens 16000 \
  --prompt "Follow the instructions at the top of the file, then score the document after the --- line. Reply with the JSON object only." \
  --file "$TMP"
rm -f "$TMP"
```

Reviewer brief (the first part of the temp file):

```text
You are an independent reviewer. Score the document below on six dimensions, 1-10:
accuracy (claims that can be checked, invented quotes or references, unsupported numbers),
voice (does a real person sound like this, or like generated text),
specificity, audience_focus, actionability, credibility.
You have no source access, so for accuracy flag what is unverifiable or suspicious, not what is false.
Quote the exact text for every issue. Reply with JSON only:
{"scores":{"accuracy":0,"voice":0,"specificity":0,"audience_focus":0,"actionability":0,"credibility":0},
 "critical_issues":[{"quote":"...","problem":"..."}],"suggestions":["..."]}
```

**3d. If the call fails.** A nonzero exit, an empty answer, a timeout, or output that isn't the JSON above means no second read. Retry once with `--model "$VALIDATE_REVIEWER_ALT"` if it is set. If that fails too, skip to step 4 and mark the report "Second read: NOT RUN (endpoint error: [one-line reason])". Do not invent a second opinion, and do not present an error as a score.

**3e. Merge.** For each dimension, the final score is the lower of your score and the reviewer's. Flag any dimension where the two differ by 2 or more. The reviewer can't see your sources, so judge each critical issue yourself: keep it if you can point at the exact claim and nothing in your sources backs it, and mark it INVALID with the reason if a source you verified contradicts it. The verdict uses the final scores.

### 4. Produce the report

```
## Validation Report

**Content:** [file name or description]
**Word count:** [X]
**Second read:** [model and lab, e.g. "<model-id> (<lab>)" | NOT RUN ([reason])]

| Dimension | This session | Second lab | Final | Issue |
|-----------|--------------|------------|-------|-------|
| Accuracy | X/10 | X/10 or n/a | X/10 | [brief note if <8] |
| Voice | X/10 | X/10 or n/a | X/10 | [brief note if <8] |
| Specificity | X/10 | X/10 or n/a | X/10 | [brief note if <8] |
| Audience Focus | X/10 | X/10 or n/a | X/10 | [brief note if <8] |
| Actionability | X/10 | X/10 or n/a | X/10 | [brief note if <8] |
| Credibility | X/10 | X/10 or n/a | X/10 | [brief note if <8] |

**Overall: X/10**

[If the second read did not run, add this line: "Scored by this session's model only. Run /review for a second lab's read."]

### Critical Issues
- [List anything that must be fixed before shipping. Mark each one "both" or "second lab only" or "this session only". Reviewer findings you rejected go here as INVALID with the reason.]

### Suggestions
- [Optional improvements, not blockers]

### Verdict: [SHIP / FIX FIRST / REWRITE]
```

**Verdict thresholds:**
- SHIP: Overall 8+ and no dimension below 6
- FIX FIRST: Overall 6-7, or any dimension below 5
- REWRITE: Overall below 6, or Accuracy below 5

### 5. If FIX FIRST or REWRITE
Offer to fix the issues immediately. List the specific changes needed.

## Rules
- The report must say whether a second lab actually ran. "Cross-model" is only true when step 3 produced a score.
- Never apply the reviewer's findings without showing them first.
- Never rubber-stamp content. If it's genuinely good, say so with specifics about WHY.
- Flag hallucinated product names as Critical (not just a suggestion)
- A single banned word is a voice violation — flag it even if everything else is perfect
- "Would you send this to a senior executive?" is the ultimate bar
- If content is internal-only (memo, notes), relax Credibility to 6+ threshold
