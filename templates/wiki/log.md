# Wiki Log

Append-only record of what changed in this wiki and when. `/ingest` and `/scan-intel` add an entry whenever they create or update a page, and you can add your own. Newest entries go at the bottom. Never rewrite an old entry: if it was wrong, add a new one that corrects it.

Entry format:

```
## [YYYY-MM-DD] {operation} | {short title}
- Source: {file path or URL, if any}
- Pages created: {list}
- Pages updated: {list}
- Key findings: {one or two sentences}
```

Operations in use: `ingest`, `curate`, `lint`, `archive`, `correction`.

---

## [YYYY-MM-DD] setup | Wiki skeleton created
- Pages created: index.md, log.md, inbox.md
- Key findings: none yet. Delete this entry once you have real ones.
