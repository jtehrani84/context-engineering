# /ingest

Process any new source into structured wiki pages. Turns raw information (PDFs, URLs, docs, conversations) into searchable knowledge.

## Trigger
When the user says: "ingest this", "process [source]", "add to wiki", "save this knowledge", "learn from [source]"

## Workflow

### 1. Identify the source
- File path (PDF, markdown, text)
- URL (article, documentation, blog post)
- Pasted content (meeting notes, email, conversation)
- Multiple sources at once

### 2. Extract and structure
For each source:
- **Key facts** — names, dates, numbers, decisions
- **Entities** — people, companies, products, concepts mentioned
- **Relationships** — how entities connect to each other
- **Insights** — non-obvious conclusions or implications
- **Action items** — anything requiring follow-up

### 3. Determine wiki placement
- People mentioned -> `wiki/people/[name].md` (create or update)
- Companies/products -> `wiki/entities/[name].md`
- Patterns/frameworks -> `wiki/concepts/[topic].md`
- Tools/technology -> `wiki/tools/[tool].md`
- Events/conferences -> `wiki/events/[event].md`
- Research/analysis -> `wiki/insights/[topic].md`

### 4. Write the wiki pages

For each new page:
```
# [Entity/Concept Name]

## Overview
[2-3 sentences: what this is and why it matters]

## Key Facts
- [Fact 1]
- [Fact 2]
- [Fact 3]

## Relationships
- Connected to: [other wiki pages]
- Mentioned in: [source files]

## Source
- Ingested from: [source reference]
- Date: [today]
```

### 5. Update index
Add new pages to `wiki/index.md` under the appropriate section.

### 6. Confirm
Report:
- Pages created: [list]
- Pages updated: [list]
- Entities extracted: [count]
- Items queued in inbox: [count]

## Rules
- Never duplicate existing pages — check wiki/ first and update instead
- Keep pages focused: one entity or concept per page
- Always include the source reference for traceability
- If information conflicts with existing wiki content, flag it — don't silently overwrite
- Maximum 200 words per wiki page (these are reference, not narrative)
- Link between pages when relationships exist
