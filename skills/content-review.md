# /content-review

Universal 6-dimension content reviewer. Provides structured scoring and feedback on any written content.

## Trigger
When the user says: "content review", "review this", "is this good?", "give me feedback on [X]", "score this content"

## Workflow

### 1. Get the content
- If a file path is provided: read it
- If pasted inline: review what's provided
- If neither: review the last substantial output from this session

### 2. Score on 6 dimensions (1-10 each)

**Accuracy (factual correctness)**
- Are claims verifiable and specific?
- Are names, dates, numbers correct?
- Any hallucinated references or made-up statistics?
- Score 10 = every claim can be sourced

**Voice (human, professional, not AI)**
- Scan against banned word list
- Does it sound like a person wrote it?
- Is the tone appropriate for the audience?
- Score 10 = you'd believe a human wrote this cold

**Specificity (concrete vs vague)**
- Numbers over adjectives?
- Named examples vs generic claims?
- Specific dates, amounts, outcomes vs hand-waving?
- Score 10 = every claim has a specific referent

**Focus (audience-centric)**
- Who is this for? Does it lead with their context?
- Is the ratio right (their world vs your pitch)?
- Would the reader find this useful on first read?
- Score 10 = reader says "they get my situation"

**Actionability (clear next step)**
- Does it end with something concrete to do?
- Are owners and timelines specified?
- Could someone act on this without asking follow-up questions?
- Score 10 = reader knows exactly what to do next

**Credibility (expertise signal)**
- Does this demonstrate knowledge or just summarize?
- Would you send this to a senior executive?
- Does it show judgment, not just information?
- Score 10 = a domain expert would nod reading this

### 3. Produce the report

```
## Content Review

**Content:** [file/description]
**Word count:** [X]
**Audience:** [who this is for]

| Dimension | Score | Note |
|-----------|-------|------|
| Accuracy | X/10 | [one-line note] |
| Voice | X/10 | [one-line note] |
| Specificity | X/10 | [one-line note] |
| Focus | X/10 | [one-line note] |
| Actionability | X/10 | [one-line note] |
| Credibility | X/10 | [one-line note] |

**Overall: X/10**

### Strengths
- [What works well — be specific]
- [What works well]

### Issues (fix these)
- [Specific problem + suggested fix]
- [Specific problem + suggested fix]

### Optional Improvements
- [Nice-to-have enhancements]
```

## Rules
- Be honest. A 7 is average professional content. 8+ is good. 9+ is excellent.
- Don't inflate scores to be nice — that defeats the purpose
- Every issue must include a suggested fix (not just "this is weak")
- If the content is genuinely good, say why specifically
- Maximum 3 issues and 3 improvements (focus on highest-impact)
