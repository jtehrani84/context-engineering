# Optional Rules

`setup.sh` installs everything in `rules/` and leaves this folder alone. Rules here are opinionated design systems. Anything in `~/.claude/rules/` is loaded into every session, so a design rule you rarely need costs context on every unrelated task. Copy one in only when your work calls for it.

| Rule | Use it when | Skip it when |
|---|---|---|
| `tailwind-ui.md` | You build standalone HTML demos or web pages with Tailwind | Your UI framework ships its own design system; follow that instead |
| `delta-ui.md` | You build dense, dark internal dashboards or monitoring views | The audience is a customer or executive who wants a lighter look |

```bash
cp rules-optional/tailwind-ui.md ~/.claude/rules/
```

To stop using one, delete the copy in `~/.claude/rules/`. Nothing else depends on them.

How they fit with the rest of the kit:

- `structural-voice.md` bans runs of identical cards on argued pages, such as a thesis or POV. These design rules cover demos and dashboards, where a row of metric blocks is data. If the two collide on an argued page, `structural-voice.md` wins.
- The two rules disagree on purpose. `delta-ui.md` is dark and dense, `tailwind-ui.md` is lighter and more spacious. Loading both at once gives Claude conflicting instructions. Load the one that matches the page.
- Want your own company's brand look? Write a third rule in the same shape (colors, type, spacing, a short anti-pattern list) and keep logos and brand art out of it.
