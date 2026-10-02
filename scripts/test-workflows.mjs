#!/usr/bin/env node
// Self-test for the four proof-family workflows in workflows/*.mjs.
//
//   node scripts/test-workflows.mjs
//
// Workflow scripts are not importable modules: Claude Code's Workflow tool runs the body with
// `args`, `agent`, `parallel`, `pipeline`, `phase`, and `log` in scope, and the body uses top-level
// await and return. This harness does the same thing with stubs, so each workflow is parsed and
// then actually executed end to end against canned agent answers. Every canned answer is checked
// against the schema the workflow passed to agent(), so a schema that drifts from the prompt
// fails here. No model is called and no file outside workflows/ is read.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WF_DIR = join(HERE, '..', 'workflows')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let passed = 0
let failed = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; failures.push(name); console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`) }
}

// ---- a small JSON-schema subset checker (type, enum, required, additionalProperties:false, items) ----
function validate(value, schema, path = '$') {
  const errs = []
  if (!schema) return errs
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`)
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected object`]
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}.${k}: required`)
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) errs.push(...validate(value[k], sub, `${path}.${k}`))
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in (schema.properties || {}))) errs.push(`${path}.${k}: unexpected property`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`]
    value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)))
  } else if (schema.type === 'string' && typeof value !== 'string') errs.push(`${path}: expected string`)
  else if (schema.type === 'number' && typeof value !== 'number') errs.push(`${path}: expected number`)
  else if (schema.type === 'boolean' && typeof value !== 'boolean') errs.push(`${path}: expected boolean`)
  return errs
}

// ---- load a workflow body and run it against stubs ----
function source(file) { return readFileSync(join(WF_DIR, file), 'utf8') }

function compile(file) {
  const src = source(file)
  if (!/^export const meta = /m.test(src)) throw new Error(`${file}: no "export const meta"`)
  const body = src.replace(/^export const meta = /m, 'const meta = ')
  return new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', `${body}\n//# sourceURL=${file}`)
}

function run(file, args, handler) {
  const calls = []
  const logs = []
  const schemaErrors = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, label: opts.label, phase: opts.phase })
    const out = await handler({ prompt, label: opts.label || '' })
    if (out === undefined) throw new Error(`no canned answer for agent "${opts.label}"`)
    const errs = validate(out, opts.schema)
    if (errs.length) schemaErrors.push(`${opts.label}: ${errs.join('; ')}`)
    return out
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()))
  const pipeline = async (items, ...stages) =>
    Promise.all(items.map(async (item) => {
      let cur = item
      for (const stage of stages) cur = await stage(cur, item)
      return cur
    }))
  const phase = () => {}
  const log = (m) => logs.push(String(m))
  const fn = compile(file)
  return fn(args, agent, parallel, pipeline, phase, log)
    .then((result) => ({ result, calls, logs, schemaErrors, threw: null }))
    .catch((e) => ({ result: undefined, calls, logs, schemaErrors, threw: e }))
}

// ---- 1. every workflow file: metadata and syntax ----
console.log('workflow files')
const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.mjs')).sort()
check('four workflows ship', files.length === 4, files.join(','))
for (const f of files) {
  const name = f.replace(/\.mjs$/, '')
  const src = source(f)
  check(`${f}: meta.name matches the filename`, new RegExp(`name:\\s*'${name}'`).test(src))
  check(`${f}: declares phases`, /phases:\s*\[/.test(src))
  let compiled = true
  try { compile(f) } catch (e) { compiled = false; console.log(String(e)) }
  check(`${f}: body parses`, compiled)
}

// ---- 2. claim-audit ----
console.log('claim-audit')
{
  const handler = ({ label, prompt }) => {
    if (label === 'extract-claims') return { claims: [
      { id: 'c1', quote: 'Enabling X leaves Y untouched.', citedSource: 'release note', kind: 'causal' },
      { id: 'c2', quote: 'The service has three regions.', citedSource: 'docs', kind: 'factual' },
    ] }
    if (label === 'bound-once') return { repeated: [{ bound: 'Only tested on v2', occurrences: 3, keepIn: 'Limits section' }] }
    if (label === 'verify:c1') return { id: 'c1', tag: 'unsupported', faithful: false, problem: 'inversion', sourceSpan: 'none found', fix: 'Say X can break Y.' }
    if (label === 'verify:c2') return { id: 'c2', tag: 'documented', faithful: true, problem: 'none', sourceSpan: 'three regions', fix: '' }
    if (label === 'refute:c1') return { flagStands: true, severity: 'critical', verdict: 'Flag stands.', finalFix: 'Say X can break Y.' }
    if (label === 'synthesize') return { verdict: 'ship-after-fixes', overall: 'One inversion.', punch_list: [{ severity: 'critical', problem: 'inversion', rewrite: 'Say X can break Y.' }] }
  }
  const r = await run('claim-audit.mjs', { artifactPath: '/tmp/handoff.md', register: 'vision', sources: 'SRC-EXCERPT' }, handler)
  check('runs without throwing', !r.threw, r.threw && r.threw.message)
  check('every canned answer matched the workflow schema', r.schemaErrors.length === 0, r.schemaErrors.join(' | '))
  check('returns verdict, counts, and punch list', r.result && r.result.verdict === 'ship-after-fixes' && r.result.claims_total === 2 && r.result.confirmed_problems === 1 && r.result.punch_list.length === 1)
  check('only the unfaithful claim reaches the refute stage', r.calls.filter((c) => c.label.startsWith('refute:')).length === 1)
  check('bound-once finding is returned', r.result && r.result.bound_once.length === 1 && r.result.bound_once[0].occurrences === 3)
  check('register and sources reach the verifier prompt', r.calls.some((c) => c.label === 'verify:c1' && c.prompt.includes('REGISTER: vision') && c.prompt.includes('SRC-EXCERPT')))
  check('default register is technical', (await run('claim-audit.mjs', '/tmp/x.md', (a) => handler(a))).result.register === 'technical')
  const bad = await run('claim-audit.mjs', {}, handler)
  check('missing artifact path throws', bad.threw && /artifact path/.test(bad.threw.message))
  const none = await run('claim-audit.mjs', '/tmp/x.md', ({ label }) => label === 'extract-claims' ? { claims: [] } : { repeated: [] })
  check('zero extracted claims returns an error, not a ship verdict', none.result && none.result.error === 'no claims extracted' && !none.result.verdict)
}

// ---- 3. plan-audit ----
console.log('plan-audit')
{
  const claim = (id, stakes) => ({ claimId: id, planClaim: `claim ${id}`, whereInPlan: 's1', howToCheck: 'src/a.js:10', stakes })
  const handler = ({ label }) => {
    if (label === 'extract-claims') return { claims: [claim('a', 'cosmetic'), claim('b', 'broken-deploy'), claim('c', 'wrong-fix')] }
    if (label.startsWith('verify:shard')) return { dimension: label, summary: 's', claims: [
      { claimId: label.endsWith('1') ? 'a' : label.endsWith('2') ? 'b' : 'c', planClaim: 'p', verdict: label.endsWith('2') ? 'REFUTED' : 'VERIFIED',
        evidence: 'src/a.js:10', correctionIfWrong: label.endsWith('2') ? 'it is line 12' : '', buildImpact: label.endsWith('2') ? 'broken-deploy' : label.endsWith('3') ? 'wrong-fix' : 'none' },
    ] }
    if (label.startsWith('recheck:')) return { claimId: label.slice(8), firstVerdict: 'x', confirmedVerdict: 'VERIFIED', agree: !label.endsWith('b'), evidence: 'e', note: 'n' }
    if (label === 'judge') return { markdown: '# audit', overallVerdict: 'SAFE-WITH-CORRECTIONS', counts: { verified: 2, imprecise: 0, refuted: 1, unverifiable: 0 }, greenlight: 'after fixes' }
  }
  const r = await run('plan-audit.mjs', { planPath: '/tmp/plan.md', codebaseRoot: '/tmp/repo' }, handler)
  check('runs without throwing', !r.threw, r.threw && r.threw.message)
  check('every canned answer matched the workflow schema', r.schemaErrors.length === 0, r.schemaErrors.join(' | '))
  check('re-checks the refuted and the high-stakes verified claims', r.calls.filter((c) => c.label.startsWith('recheck:')).length === 2)
  check('a disagreeing recheck is reported as flipped', r.result && r.result.flipped.length === 1)
  check('judge output is returned', r.result && r.result.judge.overallVerdict === 'SAFE-WITH-CORRECTIONS')
  const none = await run('plan-audit.mjs', undefined, handler)
  check('missing plan path returns an error without calling an agent', none.result && none.result.error === 'no planPath' && none.calls.length === 0)
}

// ---- 4. execution-truth-sweep ----
console.log('execution-truth-sweep')
{
  const finding = { target: 'Widget__c', category: 'written-object', claimed: 'written by job', actual: '0 rows', verdict: 'silent-zero', evidence: 'COUNT=0', severity: 'high', rootCause: 'swallowed error' }
  const handler = ({ label }) => {
    if (label.startsWith('probe:')) return { dimension: label, summary: 's', findings: label === 'probe:written-objects' ? [finding] : [] }
    if (label.startsWith('verify:')) return { target: 'Widget__c', originalVerdict: 'silent-zero', confirmedVerdict: 'silent-zero', agree: true, evidence: 'COUNT=0 again', note: '' }
    if (label === 'synthesize') return { markdown: '# sweep', ghostCount: 1, oneLineSummary: 'one ghost' }
  }
  for (const [name, a] of [['no args', undefined], ['string args', 'x'], ['missing datastore', { root: '/r', apiBase: 'https://api.example.test' }],
                           ['missing apiBase', { root: '/r', datastore: 'psql service=app' }], ['missing root', { datastore: 'psql service=app', apiBase: 'https://api.example.test' }]]) {
    const r = await run('execution-truth-sweep.mjs', a, handler)
    check(`${name}: returns an error and never calls an agent`, r.result && /missing required args/.test(r.result.error) && r.calls.length === 0)
  }
  const badUrl = await run('execution-truth-sweep.mjs', { root: '/r', datastore: 'psql service=app', apiBase: 'api.example.test' }, handler)
  check('apiBase without http(s) is rejected', badUrl.result && /http\(s\)/.test(badUrl.result.error) && badUrl.calls.length === 0)
  const r = await run('execution-truth-sweep.mjs', { root: '/repo', datastore: 'psql service=app', apiBase: 'https://api.example.test', statusPath: '/status' }, handler)
  check('runs without throwing', !r.threw, r.threw && r.threw.message)
  check('every canned answer matched the workflow schema', r.schemaErrors.length === 0, r.schemaErrors.join(' | '))
  check('passed args reach every probe prompt', r.calls.filter((c) => c.label.startsWith('probe:')).length === 6 && r.calls.filter((c) => c.label.startsWith('probe:')).every((c) => c.prompt.includes('psql service=app') && c.prompt.includes('https://api.example.test') && c.prompt.includes('/status')))
  check('critical verdicts are adversarially re-verified', r.calls.filter((c) => c.label.startsWith('verify:')).length === 1)
  check('returns the synthesized sweep', r.result && r.result.synth.ghostCount === 1 && r.result.disputed.length === 0)
  check('source carries no default datastore or API host', !/datastore\s*=\s*\(?args[^\n]*\|\|/.test(source('execution-truth-sweep.mjs')) && !/apiBase\s*=\s*\(?args[^\n]*\|\|/.test(source('execution-truth-sweep.mjs')))
}

// ---- 5. provenance-audit ----
console.log('provenance-audit')
{
  const routed = (lane) => ({ routed: [
    { claim: 'A new suit was filed.', claimType: 'newly filed lawsuit', rightOracle: 'court dockets', lane, wrongOracleWarning: 'periodic filing' },
    { claim: 'The CFO joined in May.', claimType: 'exec hire', rightOracle: 'newsroom', lane: 'web', wrongOracleWarning: 'prior filings' },
  ] })
  const check1 = (claim, verdict) => ({ claim, lane: 'web', oracleReached: verdict !== 'UNVERIFIED', verdict, evidence: 'e', source: 's', confidence: 'med' })
  const handler = (lane, overturn) => ({ label, prompt }) => {
    if (label === 'route-claims') return routed(lane)
    if (label.startsWith('check:')) return prompt.includes('A new suit') ? check1('A new suit was filed.', 'REFUTED') : check1('The CFO joined in May.', 'CONFIRMED')
    if (label.startsWith('refute:')) return overturn ? { claim: 'A new suit was filed.', verdictUpheld: false, reasoning: 'wrong oracle', saferVerdict: 'UNVERIFIED' } : { claim: 'A new suit was filed.', verdictUpheld: true, reasoning: 'ok' }
  }
  const none = await run('provenance-audit.mjs', {}, handler('web', false))
  check('no claims returns an error without calling an agent', none.result && none.result.error === 'no claims provided' && none.calls.length === 0)
  const bare = await run('provenance-audit.mjs', ['A new suit was filed.', 'The CFO joined in May.'], handler('web', true))
  check('a bare array of claims is accepted', !bare.threw && bare.result.claims.length === 2, bare.threw && bare.threw.message)
  check('every canned answer matched the workflow schema', bare.schemaErrors.length === 0, bare.schemaErrors.join(' | '))
  check('a REFUTED verdict the skeptic overturns is downgraded to UNVERIFIED', bare.result.claims.find((c) => c.claim.startsWith('A new suit')).verdict === 'UNVERIFIED' && bare.result.falseFabricationsCaught.length === 1)
  check('a CONFIRMED verdict skips the skeptic', bare.calls.filter((c) => c.label.startsWith('refute:')).length === 1)
  const upheld = await run('provenance-audit.mjs', { claims: ['A new suit was filed.', 'The CFO joined in May.'] }, handler('web', false))
  check('an upheld REFUTED stays REFUTED', upheld.result.claims.find((c) => c.claim.startsWith('A new suit')).verdict === 'REFUTED' && upheld.result.falseFabricationsCaught.length === 0)
  const limited = await run('provenance-audit.mjs', { claims: ['A new suit was filed.', 'The CFO joined in May.'], lanes: ['web'] }, handler('crm', false))
  const crmClaim = limited.result.claims.find((c) => c.claim.startsWith('A new suit'))
  check('a claim routed to an unconnected lane is UNVERIFIED and no agent checks it', crmClaim.verdict === 'UNVERIFIED' && crmClaim.oracleReached === false && limited.calls.filter((c) => c.label === 'check:crm').length === 0)
}

// ---- 6. no leftovers from the private originals ----
console.log('portability')
{
  const bad = []
  for (const f of files) {
    const src = source(f)
    if (/\/Users\/|~\/\.claude\/workflows/.test(src)) bad.push(f)
  }
  check('no absolute user paths in the workflows', bad.length === 0, bad.join(','))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) { console.log(`failed: ${failures.join('; ')}`); process.exit(1) }
