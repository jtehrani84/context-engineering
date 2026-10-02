# Memory Conventions

Claude Code keeps auto memory for you: notes it writes about your corrections and preferences, stored per git repository. This folder shows the shape that keeps that store usable once it holds hundreds of files. These are templates to read and borrow from. Setup does not copy them anywhere, and you should not drop them into a live memory folder as they are.

## Where memory lives

```
~/.claude/projects/<project-slug>/memory/
```

The slug is your project path with every `/` replaced by `-`, so `/Users/you/my-project` becomes `-Users-you-my-project`. Run `ls ~/.claude/projects/` to see yours. Memory files are personal. Keep them out of any repository you share, because they end up holding customer names, deal context and the mistakes you corrected.

## One index, one file per memory

`MEMORY.md` is an index, not a notebook. Claude Code loads only the first 200 lines or 25 KB of it, whichever comes first, at the start of every session, and everything past that is silently dropped. Each entry is one line that points at a topic file. The topic files load on demand, when Claude decides it needs one.

```
- [](feedback-verify-product-names.md) - Check a product name against the docs before using it. Reason in file.
```

## Frontmatter Claude Code actually writes

```yaml
---
name: feedback-verify-product-names
description: "One line that says when this memory applies. Claude reads this line to decide whether to open the file."
metadata:
  type: feedback        # user | feedback | project | reference
  last_verified: 2026-09-01
---
```

- `name` matches the file name without `.md`.
- `description` is the retrieval hook. Write it as "when X happens, do Y" and not as a title.
- `type` sits under `metadata:` in the files Claude Code writes today. A top-level `type:` also exists in older files. Pick one for your own files and stay with it.
- `last_verified` is yours to maintain, and `/curate` reads it. Claude Code may also stamp a `modified` field with the write time. Leave that one alone.

Body for a `feedback` or `project` memory: the rule or fact first, then a `**Why:**` line (the incident or reason, so you can judge edge cases later) and a `**How to apply:**` line (when it kicks in). The two examples in this folder follow that shape.

## File-name prefixes

Prefixes make the folder scannable with `ls` and let `/curate` group by decay rate.

| Prefix | Holds | Decay |
|---|---|---|
| `feedback-` | A correction or confirmed preference, with the reason | slow |
| `reference-` | Where something lives or how a tool behaves | permanent, unless marked perishable |
| `project-` | State of ongoing work | medium |
| `deadline-` | A dated obligation | fast, delete when it passes |
| `session-` | A session log | fast, archive quickly |

## Tiered index: when MEMORY.md outgrows one screen

Past about 150 lines, stop adding entries to `MEMORY.md`. Group a family of related memories under a sub-index file and leave one line for the family in the main index.

```
MEMORY.md                      <- 1 line per family, plus your 5 to 10 most-used singles
  feedback-index.md            <- sub-index: one line per feedback memory
  project-acme-index.md        <- sub-index: everything about one engagement
```

A sub-index is an ordinary memory file. Claude opens it only when the family is relevant, so the 200-line budget goes to routing and not to detail. See `MEMORY.md` and `feedback-index.md` in this folder for a filled-in example of each tier.

## Perishable findings: `verified_against` and `reverify`

Most memories are durable facts. Some are findings about a specific version of something ("the export script fails on large orgs", "the dashboard shows the wrong total"). A finding is only true of the artifact it audited. When that artifact changes, the memory can stay in the index saying something that is no longer true, and the next session acts on it.

Give every perishable memory two extra fields, so a later session can tell it is stale before acting:

```yaml
metadata:
  type: reference
  verified_against:
    artifact: "the thing the finding is about"
    stamp: 2026-09-01            # date, commit, or version you checked
  reverify:
    command: "one line that re-runs the check"
```

Before you act on a memory that has these fields, compare the `stamp` with the artifact today. If they differ, run the `reverify` command first. `reference-example-perishable.md` is a filled-in example. The reasoning is in `rules/findings-are-perishable.md`.

## Keeping it small

- Ask Claude to "remember this" when you correct it, and the entry lands as a `feedback-` file.
- Run `/curate` weekly. It flags stale files and over-long indexes.
- To retire a memory without deleting it, remove its line from the index. The file stays on disk and is no longer loaded or routed to.
- Never store secrets, tokens or customer personal data in memory. If you must note that a credential exists, record where it lives, never its value.
