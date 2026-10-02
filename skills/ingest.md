Process a new source into the wiki. This is the core knowledge-building operation.

Takes a file path or URL as argument. If no argument, check for new files in `~/[YOUR-PROJECT]/intel-digests/` or `~/[YOUR-PROJECT]/raw-sources/` added in the last 24 hours.

## Ingest Workflow

### Step 1: Read the Source
Read the provided file, URL content (via curl), or pasted text completely.

### Step 2: Extract Key Information
Identify:
- **Entities** — People, companies, products, tools mentioned
- **Concepts** — Patterns, frameworks, architectures, methodologies
- **Facts** — Statistics, dates, versions, benchmarks
- **Connections** — How this relates to existing wiki pages
- **Contradictions** — Does this challenge anything in the wiki?
- **Action items** — Things to build, configure, investigate, or change

### Step 3: Discuss with User
Before writing, present:
- 3-5 key takeaways from the source
- Which existing wiki pages this connects to
- Any contradictions or updates to existing knowledge
- Suggested new pages to create (if any)

### Step 4: Update the Wiki
After user confirms (or proceed if running unattended):

1. **Create summary page** in the appropriate directory:
   - Article/post → `wiki/insights/{topic-slug}.md`
   - Tool/product → `wiki/tools/{name}.md`
   - Person/company → `wiki/entities/{name}.md`
   - Pattern/methodology → `wiki/concepts/{name}.md`
   - Project-related → `wiki/projects/{name}.md`

2. **Update existing pages** that this source connects to. Add new information, update facts, note contradictions.

3. **Update `wiki/index.md`** — Add entry for any new page with link + one-line description.

4. **Append to `wiki/log.md`**:
   ```
   ## [YYYY-MM-DD] ingest | {Source Title}
   - Source: {file path or URL}
   - Pages created: {list}
   - Pages updated: {list}
   - Key findings: {1-2 sentences}
   ```

### Step 5: Report
Print:
- Pages created (with links)
- Pages updated (with what changed)
- Total wiki pages now
- Suggested follow-up actions

## Page Format
Every wiki page should have:
- **Title** (H1)
- **Status/metadata** line (date, source, status)
- **Content** (structured with headers, tables, lists as appropriate)
- **Links** section at bottom connecting to related wiki pages

Use `[Page Name](relative-path.md)` for all cross-references so they work as links.

## Rules
- Never modify files in `raw-sources/` or `intel-digests/` — those are immutable inputs
- Always cross-reference: new pages should link to existing ones, existing ones should link back
- Flag contradictions explicitly — don't silently overwrite
- One source can touch 10-15 wiki pages — that's expected and correct
