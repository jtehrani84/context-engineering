<!-- built from docs/src/10-maintaining-the-docs.md for the public edition at tools commit b4534e3 -->
# Maintaining the Docs

These docs are built so that the generated tables, and every number in a phrase the facts file lists, fail a check when they drift from the code; other prose and commands are checked by review. This chapter explains the three mechanisms that do the checking (the facts file, the generated reference and `verify-docs`), how editions are cut from one source, and what to run before a commit.

The source and the docs tools live in the private repo that holds the engine. This chapter describes what they check, so a reviewer can see what each published number is tied to and how a wrong one would be caught.

## One Source, Three Editions

Every chapter is a markdown file in `docs/src/`. Each starts with frontmatter that lists the editions it appears in:

```
---
editions: [internal, public]
---
```

A passage inside a file can be limited further with an edition block:

```
<!-- edition: internal -->
Text only the internal edition renders.
<!-- /edition -->
```

The rules the build enforces:

1. A file without frontmatter is a build error, so nothing is published by default.
2. A block can only narrow the file's editions. A block that names an edition missing from the frontmatter is a build error.
3. Blocks do not nest.
4. Files whose names start with `_` are working files and appear only in the editions their frontmatter lists.

There are three editions: an internal one for the private engine repo, one for an internal starter kit, and the public one you are reading, which ships in the public starter kit with the review packet. The two editions outside the private repo leave out all personal voice data, and the public one also leaves out every vendor-internal term.

`node docs/tools/build-editions.mjs` filters the source per edition, fills in the facts and writes `docs/dist/<edition>/`. `node docs/tools/render-site.mjs` renders each build to a static site in `docs/dist/<edition>/site/`: one page per chapter, a sidebar, search, light and dark themes, print styles, and no external loads. Both run the edition's leak check before they write anything (see [Leak Checks](#leak-checks)).

## Where Every Number Comes From

Prose holds no hand-typed counts. A number in these docs comes from one of three places:

- **The facts file**, `docs/facts.json`, written by running the tools and tests.
- **The generated reference**, [Reference](05-reference.md), written from the code.
- **A cited evidence file**, named in the text with its commit or date.

### The Facts File

`node docs/tools/facts.mjs` runs the local test suites, gate-eval and the human false-positive budget, reads counts from the code, and writes `docs/facts.json`. Each fact records a key, a value, a status (`measured`, `recorded`, `not-run`, `skipped` or `failed`), the command or file it came from, the tools commit, the date, and the editions that may show it. A fact with no editions list is internal only.

Source text cites a fact as `{{fact:key}}`, and the build fills in the value. For example, this edition was built from facts measured at tools commit b4534e3, with the detector pinned at 58a95fc. Modifiers change the output: `|raw` (no thousands separator), `|sha`, `|date`, `|source` and `|status`. A placeholder inside inline code or a fenced block is left as written.

The build fails on:

- an unknown key
- a fact the edition may not show
- a fact whose status is not `measured` or `recorded`, unless the placeholder uses `|status`
- a facts file that records a failed suite, as `verify-docs` does (with `--allow-stale` the build goes ahead and is marked stale)

So a suite that didn't run, or that failed, can't print a number. It can only print its status, and a failed suite also stops the build.

`facts.mjs` runs locally and makes no external call. Suites that call external judges are recorded as `not-run`. `--quick` skips the slow suites and records their facts as `skipped`, which a build refuses to print. `--skip <suite,...>` skips named suites.

### When the Facts Are Stale

`facts.json` records a sha256 of every input it describes: the tracked code outside `docs/` (`onboarding/` and the repo's copy of the send hook, `hook/voice-tell-gate.py`, included), the detector, and the docs tools themselves. When gate-eval runs, it also records hashes of the private sets gate-eval reads from outside the repo, so an edit to one of them stales the facts too. The file is stale when any input hashes differently today, when an input appeared or disappeared, or when a tracked input differs between the commit the facts were measured at and the working tree. Stale facts fail `verify-docs` and the build.

`build-editions.mjs --allow-stale` builds anyway, for drafting. `BUILD.json` and every site page then say the build is stale, and `verify-docs` still fails. A stale build is never the one you publish.

### The Generated Reference

[Reference](05-reference.md) has no hand-written tables. `node docs/tools/gen-reference.mjs` writes it from the code: the check catalog with effective severities, CLI flags, exit codes, environment variables, hook tiers and matchers, and the files and tests. `node docs/tools/gen-reference.mjs --check` exits 1 when the file on disk no longer matches what the code produces. Don't edit `05-reference.md` by hand; change the code or the generator and regenerate.

### Hand-Written Numbers

A fact can carry `claims`: regular expressions for the phrases its number appears in, each with one capture group around the number, for example `(\d+) detector categories`. `verify-docs` strips code, comments and placeholders from each prose line, and when a line matches a claim and the captured number differs from the fact's value, it fails and names the line, the number written and the fact.

The heuristic only knows the phrases listed in `facts.mjs`, so a number in an unlisted phrase passes. Use a placeholder for any number a fact already holds. To state a different number on purpose, such as a past value in the decision log, write it in words or end the line with `<!-- verify-docs: allow-number -->`. The build removes that marker, so it never reaches an edition.

## The verify-docs Check

`node docs/tools/verify-docs.mjs` is the check that fails when prose and a fresh run disagree. It runs these checks in order and exits 1 on any finding:

| Check | Fails when |
|---|---|
| `facts` | `docs/facts.json` is invalid or records a failed suite |
| `stale` | the facts no longer describe the current code |
| `fresh` | with `--fresh` only: `facts.mjs` runs again, and a measured value differs from the committed one |
| `sources` | a file has bad frontmatter or edition markers, or a placeholder names an unknown fact, a fact its edition may not show, or a fact with no usable value |
| `numbers` | a hand-written number disagrees with its fact |
| `reference` | `05-reference.md` differs from what `gen-reference.mjs` produces now |
| `vendor` | a vendored kit file differs from `docs/tools/vendor/SOURCES.json`, or from kit clones given with the `--kit-*` flags |
| `leaks` | an edition, assembled in memory, fails its leak check, or a fact value of 1,000 or more that the edition may not show appears in its text |
| `dist` | unless `--source-only`: a build or site in `docs/dist/` is out of date, leaks or has a broken link |

Other flags: `--edition <name>` limits the run to one or more editions, `--denylist <file>` adds a private denylist, and `--json` prints the findings as JSON. Every check runs locally. None of them calls a model, a judge or a web tool. A finding about personal text names a label, never the text it matched.

## Leak Checks

Each edition build and each rendered site is scanned before anything is written. A hit fails that edition and leaves the previous output in place. Findings name a label, never the text they matched.

All editions are scanned for secrets: API keys and private keys. Every edition except internal is also scanned for personal voice data: overlay issue ids, the names of private sample and profile files, the personal overlay file name, the approved lines read from the overlay, the signature line, and any run of 12 consecutive words copied from a private source. The public edition is also scanned for vendor-internal terms and patterns.

The personal check fails closed. When the approved lines can't be read from the overlay, or a private source is not on this machine, every build except internal fails with a finding that names which. `DOCS_ALLOW_MISSING_PRIVATE=1` builds without them, for test fixtures and machines that don't hold the private sources. `verify-docs` fails whenever that variable is set and the personal check had a gap, so a build made this way can't pass the release check.

## Before a Commit

Run these from the repo root, in this order, after any change to the code, the hook or the docs source:

```bash
node docs/tools/facts.mjs              # re-measure; writes docs/facts.json
node docs/tools/gen-reference.mjs      # regenerate docs/src/05-reference.md from the code
node docs/tools/build-editions.mjs     # cut every edition into docs/dist/<edition>/, with leak checks
node docs/tools/render-site.mjs        # render each edition's static site, with link and leak checks
node docs/tools/verify-docs.mjs        # must exit 0
```

`facts.mjs` runs the slow suites (the hook suite, the docs-tools suite, the onboarding suite, gate-eval and the false-positive budget), so start it in the background and watch its log. The budget runs only when the public corpora are on disk; set `VOICE_CORPORA` to their folder if they aren't in the default cache, or its facts stay `recorded` from the stored baseline:

```bash
nohup node docs/tools/facts.mjs > /tmp/facts-run.log 2>&1 &
tail -f /tmp/facts-run.log
```

What to run depends on what changed:

| You changed | Run at least |
|---|---|
| prose in `docs/src/` only | `build-editions.mjs`, `render-site.mjs`, `verify-docs.mjs` |
| engine code, the hook or the detector | all five, starting with `facts.mjs` (the old facts are stale) |
| a check, flag, exit code or env var | all five; `gen-reference.mjs` picks up the change |
| the docs tools | `node --test docs/tools/test/*.test.mjs`, then all five |
| the onboarding tools | `node --test onboarding/test/*.test.mjs`, then all five (`onboarding/` is a facts input, so the old facts are stale) |

Pass the test files, not the folder: on Node 22, `node --test onboarding/test/` fails at once with "Cannot find module". The docs tools' own suite passed 69 of 69 tests at b4534e3, and the onboarding suite passed 74 of 74. Every fixture in both is synthetic and built in a temporary directory.

The onboarding suite includes one test that copies the shipped send hook (`VOICE_HOOK`, else `hook/voice-tell-gate.py` in the repo) into a throwaway install and runs the doctor's wiring and fail-closed checks on it. It only reads the original. To check the copy Claude Code actually runs, set `VOICE_HOOK=~/.claude/hooks/scripts/voice-tell-gate.py`. When it fails, that hook and the engine in this checkout disagree: update one so they match, rather than editing the test.

`verify-docs.mjs --fresh` re-runs every suite and compares each measured value with the committed one. Run it before a release, and whenever you suspect a fact was edited by hand.

## Adding a Chapter or a Fact

To add a chapter, create `docs/src/NN-name.md` with frontmatter that lists its editions, use Title Case headings, and cite every number with a placeholder or an evidence file. Then run the build, render and verify steps above. A chapter that should not reach an edition must leave it out of the frontmatter. Don't rely on the leak check to catch it.

To add a fact, add an entry to the fact list in `docs/tools/facts.mjs` with its key, the command or file it comes from, the editions that may show it, and any `claims` phrases. Run `facts.mjs`, then use the key in the source. Give a fact the narrowest editions list that works: a fact with no list is internal only, and `verify-docs` fails when an internal-only value of 1,000 or more shows up in a wider edition.

## Committing a Rendered Site

`docs/dist/` is build output, ignored by the root `.gitignore` (`/docs/dist/*`). To commit a rendered edition, add an exception line there, for example `!/docs/dist/public/`, and commit the build output together with the facts file it was built from. Commit only a build that `verify-docs` passed, never one made with `--allow-stale`. This build was made from facts measured at b4534e3.
