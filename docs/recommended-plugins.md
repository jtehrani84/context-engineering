# Recommended Plugins

The kit gives you rules, hooks, skills, and a voice engine. Plugins add things the kit deliberately does not copy into your `~/.claude/`, usually because someone else maintains them and keeps them current. Install from inside Claude Code with `/plugin install <name>@<marketplace>`.

A plugin is third-party code that can run hooks and commands on your machine. Read what it ships before you enable it, the same way you would a dependency. Marketplace entries pin a specific commit, and a later update moves the pin.

## General-purpose

| Plugin | What it gives you | Install |
|---|---|---|
| `context-mode` | Compresses large tool output into a local search index so long sessions last longer | `/plugin marketplace add mksglu/claude-context-mode`, then `/plugin install context-mode@context-mode` |
| `hookify` | Turns "never do X again" from a conversation into a hook | `/plugin install hookify@claude-plugins-official` |
| `session-report` | An HTML report of a session's token use, cache hits, and expensive prompts | `/plugin install session-report@claude-plugins-official` |

These three are also listed in the README. `context-mode` summarizes output, which drops exact values. Do not use it for work that needs exact dates, IDs, or line counts (code review, diffs, config checks). `rules/context-mode-policy.md` spells out when it helps and when it hurts.

If `claude-plugins-official` is not listed in `/plugin`, add it first: `/plugin marketplace add anthropics/claude-plugins-official`.

## For Your Own Platform

Most platforms and frameworks now have a maintained plugin or skill pack (deploy, test, and trace workflows for one product). Prefer one of those over copying its skills into this kit: they change quickly, and a copy goes stale the week after you install it. Check the license before you redistribute anything from one.

If a platform plugin runs its own guardrail or validator hooks, the kit's `guardrail.py` and `domain-verification.py` run alongside them and do different jobs (destructive-command stops and domain-term checks), so having both is fine. If you see the same warning twice, that is the overlap.

## Check What You Have

`/plugin` lists installed plugins and their marketplaces. Plugin skills are namespaced (`/plugin-name:skill-name`), so they do not collide with the kit's own commands.
