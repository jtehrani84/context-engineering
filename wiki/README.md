# Wiki

A persistent, plain-markdown knowledge base. Claude writes pages here as you work, you curate them, and tools load the ones a task needs instead of everything at once.

Copy this skeleton to `~/.claude/wiki` with `./setup.sh --with-wiki`, or by hand:

```bash
mkdir -p ~/.claude/wiki && cp -Rn wiki/. ~/.claude/wiki/ \
  && cp -n templates/wiki/log.md ~/.claude/wiki/
```

The `-n` keeps anything you already have. The morning digest cron writes to `~/.claude/wiki/inbox.md`, which is why that location is the default. If you would rather keep the wiki inside a project, copy it to `<project>/wiki` instead and point the routing table in `hooks/scripts/session-init.py` at it.

## Layout

| Path | Holds |
|---|---|
| `index.md` | One line per page. Claude updates it when it adds a page. |
| `log.md` | Append-only ledger of every change, with dates. |
| `inbox.md` | Unprocessed items. `/curate` empties it. |
| `projects/` `concepts/` `entities/` `tools/` `events/` `insights/` `decisions/` | The pages themselves. |
| `people/` | Stakeholder profiles, built from `_template-colleague.md` and `_template-external.md`. |

## Local-only pages

Some pages must never leave your machine: stakeholder profiles, private project notes, anything with customer or colleague names, numbers or personal detail. Mark them so no tool can publish or re-ingest them by accident. Four steps, and all four matter:

1. **Name it so the ignore rule catches it.** Give the file a `.local.md` ending, for example `acme-renewal.local.md`. Everything under `people/` is covered already.
2. **Ignore it.** `wiki/.gitignore` in this skeleton excludes `*.local.md` and the `people/` profiles. If you turn the wiki into a git repository, that file comes with it. If your wiki sits inside a bigger repository, add the same two patterns to that repository's `.gitignore`.
3. **Mark it.** Put `visibility: local-only` in the page's frontmatter. The marker tells a future session, and you, to treat the page as private even when it is read out of context.
4. **Leave it out of the index.** Don't link it from `index.md` or from the routing table, since both are read into context and copied around. Open it by path when you need it. Note the page's existence in `log.md` with no detail if you want a trail.

Honest limits: the ignore rule only guards git. It does nothing about a tool that reads the whole folder. The graph indexer (`hooks/scripts/graph-auto-index.py`, installed but not wired unless you wire it) indexes every wiki page written while it is enabled, local-only pages included, into a database on your own machine. That stays local, but don't copy that database or the wiki folder into a shared location. Separately, nothing stops Claude from quoting a local-only page into a draft that leaves your machine, so the content rules in `rules/` still apply.
