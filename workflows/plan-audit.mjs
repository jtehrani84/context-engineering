export const meta = {
  name: 'plan-audit',
  description: 'Adversarially verify a "code-verified" plan: extract its claims, try to refute each against real code, re-check high-stakes verdicts, judge by build-impact',
  whenToUse: 'A plan asserts facts about existing code at file:line granularity, those facts drive fix decisions, and someone will build/deploy directly from it. Pass the plan path as args (string) or {planPath, codebaseRoot} (object).',
  phases: [
    { title: 'Extract', detail: 'parse the plan into discrete, checkable claims' },
    { title: 'Verify', detail: 'fan out — each shard tries to REFUTE its claims against code + runtime' },
    { title: 'Recheck', detail: 'independently re-run every REFUTED/IMPRECISE/broken-deploy verdict' },
    { title: 'Judge', detail: 'verdict line, must-fix-first, corrections-to-corrections, cosmetic drift, gaps' },
  ],
}

// Sibling: execution-truth-sweep (proves "did a row land?"); this proves "is the plan telling the truth about the code?"
// ---- args: a plan path string, or {planPath, codebaseRoot, inputDoc} ----
const planPath = typeof args === 'string' ? args : (args && args.planPath)
const codebaseRoot = (args && args.codebaseRoot) || '(infer from the plan; ask if ambiguous)'
const inputDoc = (args && args.inputDoc) || '(the plan may reference a source/findings doc it corrects — find and read it)'
if (!planPath) { log('ERROR: no plan path. Pass args="<path>" or args={planPath,codebaseRoot}.'); return { error: 'no planPath' } }

const ENV = `
PLAN UNDER AUDIT: ${planPath}
CODEBASE ROOT: ${codebaseRoot}
SOURCE/INPUT DOC (if the plan corrects a prior doc): ${inputDoc}

YOUR JOB: ADVERSARIALLY VERIFY. The plan calls itself "code-verified" — that is a CLAIM, not proof. For each claim, try to REFUTE it by reading the ACTUAL code at the cited file:line and/or running runtime checks (a schema-describe plus SELECT COUNT for a datastore; the relevant CLI or curl otherwise). A line number off, a function that does something different, a reader the plan missed, a "compiles clean" that doesn't — all matter, because someone deploys from these claims.

RULES:
- DIRECT TOOLING ONLY: Read, Grep, Glob, Bash. Do not use tools that compress or summarize output; exact line numbers and counts matter.
- DATA PROTECTION: record and customer data stays local. Never send record content to any external or web tool. Metadata (describe, COUNT) is fine locally.
- Cite evidence: every verdict carries the literal file:line you read (with the code snippet) OR the literal command + result.
- Live/VPC/auth-gated checks you cannot run from this box => UNVERIFIABLE (say what's needed), never a guessed verdict.

VERDICTS: VERIFIED (matches exactly) · IMPRECISE (directionally right, detail wrong — state the correction) · REFUTED (materially wrong — state what's true) · UNVERIFIABLE (needs a live run — say what).
BUILD-IMPACT (the consequence IF the builder trusts the claim and it's wrong): cosmetic · wasted-effort · wrong-fix · broken-deploy · safety. This is the axis the judge sorts by — a plan being mostly-right is not the bar.
`

const CLAIM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['claimId', 'planClaim', 'whereInPlan', 'howToCheck', 'stakes'],
      properties: {
        claimId: { type: 'string', description: 'stable kebab id, e.g. "cache-ttl", "step-2-import", "readme-install-path"' },
        planClaim: { type: 'string', description: 'the assertion, quoted/paraphrased' },
        whereInPlan: { type: 'string', description: 'section/line of the plan' },
        howToCheck: { type: 'string', description: 'the exact file:line to read or command to run to refute it' },
        stakes: { type: 'string', enum: ['cosmetic', 'wasted-effort', 'wrong-fix', 'broken-deploy', 'safety'], description: 'build-impact IF this claim is wrong' },
      },
    } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'summary', 'claims'],
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string' },
    claims: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['claimId', 'planClaim', 'verdict', 'evidence', 'correctionIfWrong', 'buildImpact'],
      properties: {
        claimId: { type: 'string' },
        planClaim: { type: 'string' },
        verdict: { type: 'string', enum: ['VERIFIED', 'IMPRECISE', 'REFUTED', 'UNVERIFIABLE'] },
        evidence: { type: 'string', description: 'literal file:line + snippet OR command + result' },
        correctionIfWrong: { type: 'string' },
        buildImpact: { type: 'string', enum: ['none', 'cosmetic', 'wasted-effort', 'wrong-fix', 'broken-deploy', 'safety'] },
      },
    } },
  },
}

const RECHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claimId', 'firstVerdict', 'confirmedVerdict', 'agree', 'evidence', 'note'],
  properties: {
    claimId: { type: 'string' },
    firstVerdict: { type: 'string' },
    confirmedVerdict: { type: 'string', enum: ['VERIFIED', 'IMPRECISE', 'REFUTED', 'UNVERIFIABLE'] },
    agree: { type: 'boolean' },
    evidence: { type: 'string' },
    note: { type: 'string' },
  },
}

phase('Extract')
const extracted = await agent(`${ENV}

Read the plan in full. Extract EVERY discrete, checkable claim it makes about existing code/metadata/runtime — anything asserted at file:line granularity, any "X currently does Y", any fix that branches on a code fact, any ownership claim ("no human step needed", "no org access required"), any completeness claim ("addresses all N findings"), and any NEW assertion the plan makes that its source doc didn't.
Also: if the plan CORRECTS a prior doc, capture each correction as a high-stakes claim (these flip fixes — they are the crux).
Group into ~6-9 coherent shards by subsystem so they can be checked in parallel. Assign each claim a stakes level (build-impact if wrong). Return CLAIM_SCHEMA.`,
  { label: 'extract-claims', phase: 'Extract', schema: CLAIM_SCHEMA })

const claims = (extracted && extracted.claims) || []
if (!claims.length) { log('No claims extracted — plan may have no code-level assertions. Stopping.'); return { error: 'no claims', extracted } }

// shard into ~7 groups for parallel refutation
const SHARDS = 7
const buckets = Array.from({ length: SHARDS }, () => [])
claims.forEach((c, i) => buckets[i % SHARDS].push(c))
const shards = buckets.filter(b => b.length)
log(`Extracted ${claims.length} claims → ${shards.length} refutation shards.`)

phase('Verify')
const dimResults = (await parallel(shards.map((bucket, i) => () =>
  agent(`${ENV}

ADVERSARIALLY VERIFY this shard of claims. For EACH, open the cited file:line / run the cited check and try to REFUTE it. Return VERDICT_SCHEMA (dimension = "shard ${i + 1}").
CLAIMS:
${JSON.stringify(bucket, null, 1)}`,
    { label: `verify:shard${i + 1}`, phase: 'Verify', schema: VERDICT_SCHEMA })
))).filter(Boolean)

const allClaims = dimResults.flatMap(d => (d.claims || []).map(c => ({ ...c, dimension: d.dimension })))
// barrier justified: need the full verdict set to select high-stakes + disputed for re-check
const toRecheck = allClaims.filter(c =>
  c.verdict === 'REFUTED' || c.verdict === 'IMPRECISE' ||
  (c.verdict === 'VERIFIED' && ['wrong-fix', 'broken-deploy', 'safety'].includes(c.buildImpact)))
log(`Verify done: ${allClaims.length} verdicts (${allClaims.filter(c=>c.verdict==='REFUTED').length} REFUTED, ${allClaims.filter(c=>c.verdict==='IMPRECISE').length} IMPRECISE). Re-checking ${toRecheck.length} high-stakes/disputed.`)

phase('Recheck')
const rechecked = (await parallel(toRecheck.map(c => () =>
  agent(`${ENV}

INDEPENDENT RE-CHECK. A first-pass auditor reached a verdict on this claim. Re-run the proof YOURSELF from scratch — open the file:line, run the command. Do not trust their evidence. Confirm or correct.
CLAIM [${c.claimId}]: ${c.planClaim}
FIRST VERDICT: ${c.verdict} (buildImpact ${c.buildImpact})
FIRST EVIDENCE: ${c.evidence}
${c.correctionIfWrong ? 'PROPOSED CORRECTION: ' + c.correctionIfWrong : ''}
Return RECHECK_SCHEMA.`,
    { label: `recheck:${c.claimId}`.slice(0, 46), phase: 'Recheck', schema: RECHECK_SCHEMA })
))).filter(Boolean)
const flipped = rechecked.filter(r => !r.agree)
log(`Recheck done: ${rechecked.length} re-run, ${flipped.length} flipped. NOTE: if any broken-deploy claim lost its re-check (agent emit-failure), the main loop must hand-verify before sign-off.`)

phase('Judge')
const judge = await agent(`${ENV}

Write the COMPLETE markdown body of the plan audit. You have every verdict + the independent re-checks (trust the re-check's corrected verdict where it disagreed).
ALL CLAIMS: ${JSON.stringify(allClaims, null, 1)}
RE-CHECKS: ${JSON.stringify(rechecked, null, 1)}

Structure:
1. Verdict line — SAFE-AS-WRITTEN / SAFE-WITH-CORRECTIONS / NOT-SAFE, with counts (V/I/R/U).
2. Must-fix before building — every REFUTED + every IMPRECISE whose buildImpact is wrong-fix/broken-deploy/safety. Numbered, severity-ranked, each with the one-line correction.
3. Corrections-to-the-corrections — if the plan corrected a prior doc, a verdict on EACH correction (did it correct it right?). This is the crux.
4. Verified-solid — the load-bearing claims that held (tight list).
5. Cosmetic / line drift — collected so the author fixes refs in one pass.
6. Gaps — UNVERIFIABLE claims (what a live run needs) + any load-bearing NEW claim no one checked + any source-doc item the plan silently dropped.
7. Bottom line — greenlight or not, + the single most important correction.
Voice: plain and direct, numbers first, no filler. Output ONLY the markdown.`,
  { label: 'judge', phase: 'Judge',
    schema: { type: 'object', additionalProperties: false, required: ['markdown', 'overallVerdict', 'counts', 'greenlight'],
      properties: {
        markdown: { type: 'string' },
        overallVerdict: { type: 'string', enum: ['SAFE-AS-WRITTEN', 'SAFE-WITH-CORRECTIONS', 'NOT-SAFE'] },
        counts: { type: 'object', additionalProperties: false, required: ['verified','imprecise','refuted','unverifiable'], properties: { verified:{type:'number'}, imprecise:{type:'number'}, refuted:{type:'number'}, unverifiable:{type:'number'} } },
        greenlight: { type: 'string' },
      } } })

return { judge, allClaims, rechecked, flipped, claimCount: claims.length }
