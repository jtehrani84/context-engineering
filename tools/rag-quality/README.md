# RAG-Quality & Attribution Toolkit

Practitioner implementations of three published agentic-quality methods:
**ECHO** (multi-agent error attribution, arXiv:2510.04886), **VERA** (retrieval evaluation,
arXiv:2409.03759), and **Meta-Knowledge for RAG** (index-time corpus preparation, arXiv:2408.09017). They're the "measure and attribute"
leg of the harness — most practitioners never wire these up.

Honest split: one tool is turnkey, one needs the LLM shim, three are method-skeletons you point at
your own corpus. Nothing here ships with a corpus or a project ID.

## Runnable as-is

**`echo-attribute.mjs`** — ECHO error attribution over Claude Code **workflow traces**. Point it at a
run directory (`journal.jsonl` + `agent-*.jsonl`) and it attributes *which agent/step* caused a failure,
distinguishing a real failure from an incomplete run, with a `--bundle` mode that emits a judge-bundle
for a consensus stage. Deterministic; no LLM or corpus needed.
```
node echo-attribute.mjs <run_dir>              # attribute one run (report)
node echo-attribute.mjs <run_dir> --json       # machine-readable
node echo-attribute.mjs --scan <projects_dir>  # rank all runs by failure signal (find the bad ones)
```
Any team running multi-agent Claude Code workflows can use this today.

## Runnable once you wire `../llm.mjs`

**`mk-rewrite.mjs`** — query decomposition (Meta-Knowledge / VERA): turns one blended query into
several targeted sub-queries so retrieval finds chunks a single query misses. Pure transform; prints
the sub-queries. Configure `tools/llm.mjs` (one place) and it runs.

## Method-skeletons (add your corpus + the LLM shim)

These carry the method and the code shape, but read a corpus, so they're not turnkey — repoint the
corpus path and wire `../llm.mjs`, then they run against your knowledge base:

- **`mk-synth-qa.mjs`** — index-time synthetic Q&A generation with a verbatim self-consistency check, so
  retrieval matches how people actually ask, not just the source phrasing.
- **`mk-rerank.mjs`** — LLM re-rank of retrieved chunks, judged by a *different* model as an independent
  oracle (a stand-in for VERA's cross-encoder — labeled as such, not the same mechanism).
- **`echo-verify-corpus.mjs`** — VERA-style bootstrap bound + ECHO ranking on how self-verifiable your
  corpus is (what fraction of claims are checkable against a source).

## Attribution & honest scope

- ECHO, VERA, and Meta-Knowledge are published methods (see the arXiv ids above; read the papers for
  the authors' exact claims). These are practitioner implementations — faithful to the mechanisms, not the papers' exact models or scale.
- Every tool needs an LLM except `echo-attribute`. That call goes through `../llm.mjs` — set it once.
- `mk-rerank` is an LLM re-ranker, **not** the paper's pre-trained cross-encoder: same goal, different
  mechanism. Say so if you present it.
