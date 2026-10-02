# guards/

Working code for the controls Part 10 teaches. These are the portable guards from the local harness I built for Parts 1 to 9, with the tests that prove each one. Plain Node (18+) and Python 3, no dependencies, no network, no model calls.

```bash
./run-tests.sh        # every self-test; exits 0 only if all pass
```

## What's here

| File | What it does |
|---|---|
| `egress-guard.mjs` | Scans agent output for every URL the client would resolve (image src, markdown image, CSS `url()`, bare `//host`) and blocks any host that isn't on your exact allowlist. Canonicalizes with the WHATWG URL parser, strips the tab/newline characters browsers strip, and denies anything it can't parse. With a broker attached it also blocks a URL that carries a registered sensitive value in the host, path or query. |
| `broker.mjs` | Run-scoped token broker. Swaps sensitive values for opaque handles before text reaches the model; only a holder of the connector key restores them. `scanForLeak` is the backstop: it matches on a canonical form (Unicode-normalized, case-folded, zero-width stripped, 15-char ID variant), so an equivalent spelling of a registered value can't slip out. |
| `primitives.mjs` | Pure failure-class detectors that return `{ ok, reason }`: silent-empty, drift, ungrounded, execution (vacuous green), model-substitution, and two injection detectors (one reads the agent's response, one reads which actions a run authorized). |
| `mcp-classify.mjs` | Fail-closed classifier for MCP tool names: `external.mutate` or `network.read`. Mutate verbs win, unknown tools are treated as mutating, and MCP annotations are honored but can't launder a tool whose name says `delete`. |
| `verifier.mjs` | Three verifier tiers that don't collapse into each other: advisory (same-model review, never blocks), oracle (deterministic check, blocks, fail-closed), owner (a human, cleared only by a callback you bind to a signature check). |
| `canary.mjs` | Re-runs each guard against a known input and reports drift. Fires on the bad case and stays silent on the good one. `--seed-fail` proves the canary itself can go red. |
| `fuzz.mjs` | Seeded property fuzzing for the egress guard and the classifier, plus ablation (swap in a no-op guard and confirm the property breaks). Deterministic, so a failure reproduces. |
| `reducer.mjs` | Compresses a big log into a verified receipt (head, tail, exact error lines, source hash). A deterministic verifier checks it and returns the original on any failure. Reports the saving measured on your input, never a borrowed number. |
| `protect-paths.py` | PreToolUse hook that denies Write/Edit/MultiEdit/NotebookEdit into paths you list (gold sets, holdouts, lockfiles). Fail-closed. |
| `scrub.mjs` | Leak-scan gate for anything you're about to publish. Generic detectors plus your own private denylist. |
| `*.test.mjs`, `protect-paths.test.py` | The proof. Each guard is tested to fire on the bad input and stay silent on the good one. |

## Quick use

```js
import { openBroker } from './broker.mjs';
import { checkEgress } from './egress-guard.mjs';

const broker = openBroker('run-1', { key: process.env.CONNECTOR_KEY });
broker.register('Example Co dealsize 2400000', { dataClass: 'restricted' });

const safe = broker.tokenize(toolResult);          // what the model sees
const out  = checkEgress(modelOutput, { allowHosts: ['example.com'], broker });
if (!out.ok) throw new Error(out.blocked.map(b => b.reason).join('; '));
```

## protect-paths: configure, then wire

Nothing is protected until you add a path. Either set `PROTECT_PATHS` (colon-separated absolute paths) or list one path per line in `~/.claude/protected-paths.txt` (override with `PROTECT_PATHS_FILE`). Then add the hook to `settings.json`, merging into your existing `hooks.PreToolUse` list:

```json
{ "matcher": "Write|Edit|MultiEdit|NotebookEdit",
  "hooks": [{ "type": "command", "command": "python3 /path/to/guards/protect-paths.py" }] }
```

It denies with `hookSpecificOutput.permissionDecision: "deny"` and prints nothing on a pass-through, so your normal permission flow still applies.

## scrub: your denylist stays yours

The kit ships `denylist.example.json` empty on purpose. Copy it to `denylist.local.json` (gitignored), add your customer names, internal hostnames, project IDs and codenames (and, under `publicTerms`, the company and product names that must not reach a public audience), and run:

```bash
node scrub.mjs <dir-you-are-about-to-publish>            # exit 1 if anything is flagged
node scrub.mjs <dir> --tier anyone                       # also flag the publicTerms in your denylist
node scrub.mjs <dir> --denylist /path/to/private.json    # or set SCRUB_DENYLIST
```

Keep the real denylist out of every repo, including this one. The output says when the denylist is empty so a clean result from generic detectors alone isn't mistaken for a full scan.

## What these do not cover

- **The egress guard reads text.** It catches a URL in agent output. It does not sit on the network, so it can't stop a tool that makes its own request. Pair it with a network allowlist where you can.
- **The classifier is a name heuristic.** An unfamiliar mutating verb that sits next to a known read verb (say `frobnicate_get`) is classified as a read unless the tool supplies annotations. Supply annotations when you own the server.
- **The broker key lives in your process.** It keeps raw values away from the model, not away from code you run next to it. Match the registered values to the data classes you actually have.
- **protect-paths sees file-writing tools only.** A Bash redirect into a protected path isn't visible to it.
- **The owner tier is only as strong as the callback you pass as `ownerVerify`.** Bind it to a real signature or approval check that the agent can't reach.
- **Not shipped:** the run recorder, the signed trust root that pins these guards, the host adapters and the integrations. Those are tied to one setup and stay private. The guards work without them; what you lose is tamper-evidence on the guards themselves.

## Grounding

The egress and broker design follows a publicly reported 2026 chain against a commercial CRM agent (Zenity Labs): hidden instructions in a web form, data leaked through the subdomain of an image URL, and an allowlist defeated by a URL-parsing difference. `rules/agent-security-boundary.md` covers the case study and the design rules behind the controls.
