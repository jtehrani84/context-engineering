export const meta = {
  name: 'execution-truth-sweep',
  description: 'Runtime-prove every write, endpoint, and optional step a system claims: live vs silent-zero vs stale vs ghost. Execution truth, not code review.',
  whenToUse: 'You suspect (or want to rule out) silently dead features: objects written by code that lands 0 rows, advertised endpoints that 404, optional steps that report green and write nothing. REQUIRED args: {root, datastore, apiBase}. Optional: {srcDir, statusPath}.',
  phases: [
    { title: 'Probe', detail: 'derive the write set and endpoint set, then runtime-prove each (COUNT, curl, describe)' },
    { title: 'Verify', detail: 'adversarially re-run every silent-zero, dead, stale, or ghost verdict' },
    { title: 'Synthesize', detail: 'truth table, ranked ghosts, and the execution-proof checklist' },
  ],
}

// Rule: rules/testing-quality.md ("Persistence proof") and rules/proof-before-claim.md.
//
// REQUIRED args (an object; there are deliberately no defaults, so the sweep can never run
// against a system you did not name):
//   root       path to the repository under sweep
//   datastore  how to reach the datastore the system writes to: a connection-string name, a CLI
//              profile, or an admin endpoint (e.g. "psql service=app_prod", "admin API /rows")
//   apiBase    base URL of the system's live API (https://...)
// Optional:
//   srcDir      server source directory (default: root)
//   statusPath  the capability/status endpoint that lists advertised routes (default: find it)
const root = args && typeof args === 'object' ? args.root : undefined
const datastore = args && typeof args === 'object' ? args.datastore : undefined
const apiBase = args && typeof args === 'object' ? args.apiBase : undefined
const missing = [['root', root], ['datastore', datastore], ['apiBase', apiBase]].filter(([, v]) => !v || typeof v !== 'string').map(([k]) => k)
if (missing.length) {
  log(`execution-truth-sweep: missing required arg(s): ${missing.join(', ')}. Pass args={root, datastore, apiBase[, srcDir, statusPath]}.`)
  return { error: `missing required args: ${missing.join(', ')}`, usage: '{ root, datastore, apiBase, srcDir?, statusPath? }' }
}
if (!/^https?:\/\//i.test(apiBase)) {
  log(`execution-truth-sweep: apiBase must start with http:// or https:// (got "${apiBase}").`)
  return { error: 'apiBase must be an http(s) URL' }
}
const srcDir = (args.srcDir && String(args.srcDir)) || root
const statusPath = (args.statusPath && String(args.statusPath)) || '(locate the status or capabilities endpoint in the routes)'

const ENV = `
SYSTEM UNDER SWEEP:
- Codebase root: ${root}   (server source: ${srcDir})
- Datastore the system writes to: ${datastore}  (use its schema-describe command + SELECT COUNT)
- Live API base: ${apiBase}   | capability/status endpoint: ${statusPath}

THE JOB: for every object the system claims to write, every endpoint it advertises, every "optional" step, PROVE at runtime whether it actually produces output or is silently dead. Do NOT review code for correctness; CODE LOOKING RIGHT IS NOT THE BAR. A feature can be audited, advertised, and 100% dead (0 rows) for weeks because nobody ran COUNT(). Assume more ghosts exist. Find them with execution.

RULES:
- DIRECT TOOLING ONLY: Read, Grep, Glob, Bash (the datastore's own CLI and curl). Do not use tools that compress or summarize output; exact counts and field names matter.
- DATA PROTECTION: datastore and record data stays local. No external tools, no web posting, no pasting record data off-box.
- EXECUTION OVER CODE: the first move for every claim is the runtime check (COUNT, curl status, post-run row delta), not reading the handler.
- METADATA LIES: a field or table can exist in a schema-describe result, in a migration file, or in deployed code and STILL reject SELECT or a write. Only a successful write or SELECT proves a field is real.
- SAFE ENDPOINT PROBES ONLY: test a POST endpoint with GOOD auth, an EMPTY {} body, and a 12s timeout. 404 or 501 = ghost; 400 or 422 = mounted and live; 410 = deliberately gone. NEVER send a real customer ID, company, or record: that triggers a real run with real writes. Liveness is the status code from an invalid or empty body, nothing more.
- The live API may need auth you do not have or sit on an internal network. If a check is unreachable, mark it UNVERIFIABLE and say what is needed. Do not guess.

VERDICTS: live | silent-zero (writer exists, 0 rows) | stale (only old rows) | partial (<50% populated or thin) | dead (green-but-empty step) | ghost (advertised or declared, no producer or 404) | n/a.
Every finding MUST carry the literal command and the literal result as evidence. A verdict with no runtime evidence is rejected.
`

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'summary', 'findings'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['target', 'category', 'claimed', 'actual', 'verdict', 'evidence', 'severity', 'rootCause'],
      properties: {
        target: { type: 'string' },
        category: { type: 'string', enum: ['written-object', 'endpoint', 'optional-step', 'rag', 'field-population', 'audit-gap'] },
        claimed: { type: 'string' },
        actual: { type: 'string' },
        verdict: { type: 'string', enum: ['live', 'silent-zero', 'stale', 'partial', 'dead', 'ghost', 'n/a'] },
        evidence: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
        rootCause: { type: 'string' },
      },
    } },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['target', 'originalVerdict', 'confirmedVerdict', 'agree', 'evidence', 'note'],
  properties: {
    target: { type: 'string' }, originalVerdict: { type: 'string' },
    confirmedVerdict: { type: 'string', enum: ['live', 'silent-zero', 'stale', 'partial', 'dead', 'ghost', 'n/a'] },
    agree: { type: 'boolean' }, evidence: { type: 'string' }, note: { type: 'string' },
  },
}

phase('Probe')
const dims = [
  ['written-objects', `DIMENSION: WRITTEN-OBJECTS CENSUS. Derive the COMPLETE write set; do not assume it. Grep ${srcDir} for every create, update, upsert, and insert call against a table or object (ORM, SQL, REST, bulk, or SDK writes), including dynamic table names held in variables, plus any scripts that write directly. For EVERY table run against ${datastore}: SELECT COUNT(*) c, MAX(<updated_at>) m, MIN(<created_at>) mn FROM <TABLE>. For any 0-row or stale-only object, trace WHY (which writer, swallowed error?). An object whose writer exists in code but has 0 rows is silent-zero; one that is declared or permissioned but has no writer is a ghost. One finding per object.`],
  ['endpoints', `DIMENSION: ADVERTISED vs MOUNTED ENDPOINTS. Request the status or capabilities endpoint (${statusPath}) with auth and list every advertised endpoint. Cross-check against the mounted routes in the source (router registrations; note commented-out mounts). For EACH advertised endpoint, send a SAFE empty-{} probe and record the status: 400 or 422 = live, 404 = ghost, 410 = gone. A path in the status listing that 404s is a ghost advertisement; a mounted route that is not advertised is an unaudited bypass. One finding per advertised endpoint.`],
  ['optional-steps', `DIMENSION: OPTIONAL AND FAIL-SILENT STEPS. Find the pipeline's optional, best-effort, or warn-not-throw steps. For EACH, identify the verifiable artifact it should produce (a row in which object or field? a vector? a file? a populated field?), then PROVE at runtime whether that artifact exists (COUNT, a field-populated check on recent records, an admin endpoint). A step that "ran green" but wrote nothing is dead. One finding per optional step.`],
  ['vector-store', `DIMENSION: RAG AND VECTOR STORES. If a vector or embedding store exists, get per-collection counts from its admin or health endpoint (it may be network-internal; then UNVERIFIABLE, and say so). Verify each embedding collection is actually populated and matches its claimed count. A collection with no count route is its own finding (unobservable).`],
  ['field-population', `DIMENSION: FIELD-POPULATION CENSUS. For the key written objects, census each declared column: SELECT COUNT(*) total, COUNT(<field>) filled FROM <TABLE>. Two traps: some large-text column types reject WHERE != null or aggregates (do a full SELECT and count client-side), and column DEFAULTS read as populated (GROUP BY and exclude the default, or you get a phantom 100%). Flag every declared field under 10% meaningfully populated. One finding group per object.`],
  ['audit-gap', `DIMENSION: THE AUDIT-METHOD GAP. If a prior audit exists (findings CSV or doc), characterize which layers it exercised: did any finding cite a row COUNT, a curl status, or an artifact-exists assertion, or was it pure code review? Quantify. Then propose the execution-proof checklist (COUNT every write, probe every advertised endpoint, assert artifact-exists per optional step, census every field) that would have caught the ghosts.`],
]
const dimResults = (await parallel(dims.map(([key, body]) => () =>
  agent(`${ENV}\n\n${body}\nReturn FINDINGS_SCHEMA.`, { label: `probe:${key}`, phase: 'Probe', schema: FINDINGS_SCHEMA })
))).filter(Boolean)

const allFindings = dimResults.flatMap(d => (d.findings || []).map(f => ({ ...f, dimension: d.dimension })))
// Barrier: select the critical verdicts across ALL dimensions before the expensive adversarial re-check.
const critical = allFindings.filter(f => ['silent-zero', 'dead', 'stale', 'ghost'].includes(f.verdict))
log(`Probe done: ${allFindings.length} findings; ${critical.length} critical verdicts to adversarially verify.`)

phase('Verify')
const verified = (await parallel(critical.map(f => () =>
  agent(`${ENV}

ADVERSARIAL RE-VERIFICATION. Another agent claimed this finding. REFUTE it by re-running the runtime proof INDEPENDENTLY (construct your own command; do not trust theirs). Default to disagreement if you cannot reproduce. A silent-zero, dead, ghost, or stale verdict is only confirmed if YOUR command reproduces 0 rows, a 404, or the stale date.
FINDING: target="${f.target}" category="${f.category}" verdict="${f.verdict}" claimed="${f.claimed}" actual="${f.actual}"
their evidence: ${f.evidence}
Return VERDICT_SCHEMA.`,
    { label: `verify:${f.target}`.slice(0, 46), phase: 'Verify', schema: VERDICT_SCHEMA })
    .then(v => (v ? { ...v, finding: f } : v))
))).filter(Boolean)
const disputed = verified.filter(v => !v.agree)
log(`Verify done: ${verified.length} re-checked, ${disputed.length} disputed or corrected.`)

phase('Synthesize')
const synth = await agent(`${ENV}

Assemble the EXECUTION-TRUTH SWEEP deliverable. Trust the re-verification's corrected value where it disagreed.
ALL FINDINGS: ${JSON.stringify(allFindings, null, 1)}
VERIFICATIONS: ${JSON.stringify(verified.map(v => ({ target: v.target, originalVerdict: v.originalVerdict, confirmedVerdict: v.confirmedVerdict, agree: v.agree, evidence: v.evidence, note: v.note })), null, 1)}

Markdown body:
1. One-paragraph bottom line: what is live versus the named silent-zero, stale, and ghost set; was the first ghost found the only one or the first of several?
2. THE TRUTH TABLE: feature, object, or endpoint | claimed | ACTUAL (runtime count, status, or %) | VERDICT | evidence. Cover every written object, advertised endpoint, optional step, vector store, and worst field offenders. Apply corrections.
3. RANKED GHOST LIST: every silent-zero, stale, dead, and ghost, numbered, severity-ranked, with root cause.
4. THE AUDIT-METHOD FIX: the copy-pasteable execution-proof checklist (COUNT every write, probe every advertised endpoint, assert artifact-exists per optional step, census every field while excluding picklist defaults and handling long-text fields).
Voice: plain and direct, runtime evidence first, numbers first, no filler. Output ONLY the markdown body.`,
  { label: 'synthesize', phase: 'Synthesize',
    schema: { type: 'object', additionalProperties: false, required: ['markdown', 'ghostCount', 'oneLineSummary'],
      properties: { markdown: { type: 'string' }, ghostCount: { type: 'number' }, oneLineSummary: { type: 'string' } } } })

return { synth, allFindings, verified, disputed }
