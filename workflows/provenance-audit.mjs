export const meta = {
  name: 'provenance-audit',
  description: 'Before any claim is called FALSE or fabricated, route it to the source where it would be TRUE and check that oracle. Lanes are firewalled (public web, CRM, team chat, product docs) so internal data never touches a web query. Returns CONFIRMED / REFUTED / UNVERIFIED per claim with the oracle named: the negative-verdict mirror of claim-audit.',
  whenToUse: 'An audit, review, or model-vs-source comparison is about to call claims false, fabricated, or hallucinated. Pass {claims: [...], context?, lanes?} or a bare array of claim strings.',
  phases: [
    { title: 'Route', detail: 'one router assigns each disputed claim to the oracle where it would live if true' },
    { title: 'Check', detail: 'firewalled lanes verify each claim against its right oracle; the web lane never sees internal data' },
    { title: 'Refute', detail: 'an independent skeptic tries to overturn each REFUTED verdict, because a wrong RED is the failure mode' },
  ],
}

// Why this exists: an auditor tests a batch of claims against the one document in front of it,
// finds them missing, and writes "fabricated". But many of those documents cannot contain the
// claim by design. A periodic financial filing lists no newly filed lawsuits, no executive hires,
// no CRM records, and no chat threads. Routing each disputed claim to the source where it would
// actually live, and checking there, can flip most of such a verdict. The failure is testing a
// claim against an oracle that could never have held it, then reading absence as disproof.
// This workflow makes "route the claim to its right oracle before refuting" a runnable step.
// Rule: rules/refutation-needs-the-right-oracle.md
//
// USAGE:
//   Workflow({ name: "provenance-audit", args: {
//     claims: [ "<disputed claim 1>", "<disputed claim 2>", ... ],   // REQUIRED
//     context: "<optional: what artifact these came from, the correct record or account, etc.>",
//     lanes: ["web", "crm", "chat", "docs"],                         // optional: lanes you can actually reach
//   }})
//   (A bare array of strings also works: args: ["claim 1", "claim 2"].)
//
// Lanes: a lane you list is one whose tools you have connected. A claim routed to a lane you did
// not list comes back UNVERIFIED (not-checked is never the same as false).

const ALL_LANES = ['web', 'crm', 'chat', 'docs']
const isObj = args && typeof args === 'object' && !Array.isArray(args)
const rawClaims = Array.isArray(args) ? args : (isObj ? (args.claims ?? []) : [])
const CONTEXT = (isObj ? (args.context ?? '') : '').toString()
const LANES = isObj && Array.isArray(args.lanes) && args.lanes.length
  ? args.lanes.map(String).filter((l) => ALL_LANES.includes(l))
  : ALL_LANES
const CLAIMS = rawClaims.map((c) => c.toString()).filter(Boolean)

if (!CLAIMS.length) {
  log('provenance-audit: no claims passed. Pass args:{claims:[...]} or args:[...]. Nothing to audit.')
  return { error: 'no claims provided', claims: [] }
}
log(`provenance-audit: routing ${CLAIMS.length} disputed claim(s) to their right oracles before any verdict of FALSE. Reachable lanes: ${LANES.join(', ') || '(none)'}.`)

// The oracle map: where each claim TYPE lives if true, and where it is absent BY DESIGN (a wrong oracle).
const ORACLE_MAP = `
ORACLE ROUTING TABLE. Match the claim to where it would be TRUE, not to whatever is in front of you:
| Claim type                         | RIGHT oracle (check this)                                   | WRONG oracle (absent by design, so absence proves nothing) |
| newly filed lawsuit                | court dockets, legal-news wire, securities-suit trackers    | the company's own periodic filing (boilerplate risk factor only) |
| exec hire or departure             | company newsroom, professional networks, trade press        | prior-period financial filings |
| product, rate, or policy change    | product blog, product docs, investor-relations press release | a periodic financial statement |
| financial figure or guidance       | investor-relations data sheet, transcript, press release    | a product blog or a CRM record |
|   (note: FORWARD guidance cut != TRAILING actuals. Both can be true; reconcile before refuting) |
| CRM contact, opportunity, amount   | the CRM of record, pinned to the CORRECT account            | any public web source |
|   (beware duplicates: a name search can grab the first of many near-identical records)           |
| deal color, champion, thread       | the account's team-chat channel, CRM activities             | any public web source, any filing |
| product capability or name         | the vendor's product docs and any grounding corpus you have | model memory, a competitor's page |
`

const FIREWALL = `
HARD FIREWALL (non-negotiable; the point is that lanes stay isolated):
- WEB lane: uses web search and fetch tools ONLY. It sees ONLY the public claim text. NEVER put a customer or account name paired with a deal amount, a CRM record ID, a person's private detail, or any internal chat content into a web query.
- CRM lane: uses your CRM connector's tools ONLY. NEVER calls a web search or fetch tool.
- CHAT lane: uses your team-chat connector's tools ONLY (read the relevant channel). NEVER calls a web search or fetch tool.
- DOCS lane: uses product-documentation search ONLY.
- A lane that cannot reach its tools, or is out of scope, returns verdict UNVERIFIED, NOT REFUTED. Not-checked is never the same as false.
`

const INTEGRITY = `
INTEGRITY RULE (a verdict is only as good as the oracle it was tested against):
- For every claim, name the RIGHT oracle (where it would be true) and state whether you actually reached it.
- CONFIRMED  = the right oracle supports the claim. Paste a VERBATIM excerpt (a real sentence) into "evidence" and the source ID or URL into "source".
- REFUTED    = the right oracle was reached AND it truly lacks or contradicts the claim. Quote the contradicting span, or state the exact query that returned zero (for example "amount = 125000 -> 0 rows, band 120k-130k enumerated"). Absence from a WRONG-by-design oracle does NOT qualify.
- UNVERIFIED = the right oracle was NOT reached (no access, firewalled, out of scope). This is the honest default. Never upgrade "couldn't check" to REFUTED.
- Do NOT fill evidence from your own training. Empty or vague evidence means the claim is UNVERIFIED, not REFUTED.
`

const LANE_TOOLS = {
  web: 'web search and web fetch tools (find them with ToolSearch if they are deferred)',
  crm: 'your CRM connector tools (find them with ToolSearch if they are deferred)',
  chat: 'your team-chat connector tools (find them with ToolSearch if they are deferred)',
  docs: 'product documentation search tools (find them with ToolSearch if they are deferred)',
}

const ROUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['routed'],
  properties: {
    routed: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['claim', 'claimType', 'rightOracle', 'lane', 'wrongOracleWarning'],
        properties: {
          claim: { type: 'string' },
          claimType: { type: 'string' },
          rightOracle: { type: 'string' },
          lane: { type: 'string', enum: ALL_LANES },
          wrongOracleWarning: { type: 'string' },
        },
      },
    },
  },
}

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claim', 'lane', 'oracleReached', 'verdict', 'evidence', 'source', 'confidence'],
  properties: {
    claim: { type: 'string' },
    lane: { type: 'string' },
    oracleReached: { type: 'boolean' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'UNVERIFIED'] },
    evidence: { type: 'string' },
    source: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'med', 'low'] },
  },
}

const REFUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claim', 'verdictUpheld', 'reasoning'],
  properties: {
    claim: { type: 'string' },
    verdictUpheld: { type: 'boolean' }, // false = the REFUTED verdict is itself wrong (a false fabrication call)
    reasoning: { type: 'string' },
    saferVerdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'UNVERIFIED', 'unchanged'] },
  },
}

// Phase 1: ROUTE. One agent assigns each claim to the oracle where it would be true.
phase('Route')
const routing = await agent(
  `You route disputed claims to the SOURCE where each would be TRUE, before anyone renders a verdict of FALSE.
${ORACLE_MAP}
For EACH claim below, decide: what TYPE of claim is it? what is the RIGHT oracle (where it would live if true)? which lane checks it (${ALL_LANES.join(', ')})? and, critically, name the WRONG oracle whose absence must NOT be read as disproof (for example "a periodic filing would not list this newly filed suit").

${CONTEXT ? `Context on where these came from: ${CONTEXT}\n` : ''}
Claims to route:
${CLAIMS.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`,
  { label: 'route-claims', phase: 'Route', schema: ROUTE_SCHEMA },
)

const routed = (routing && routing.routed) || []
if (!routed.length) {
  log('provenance-audit: router returned nothing; falling back to the web lane for all claims.')
}
const items = routed.length ? routed : CLAIMS.map((c) => ({ claim: c, claimType: 'unknown', rightOracle: 'unknown', lane: 'web', wrongOracleWarning: '' }))
log(`Routed: ${items.map((r) => `[${r.lane}] ${r.claimType}`).join(' | ')}`)

// Phases 2 and 3: CHECK each claim against its right oracle in its firewalled lane, then REFUTE the RED verdicts.
// Pipeline: a claim can be in Refute while another is still in Check. No barrier needed.
const results = await pipeline(
  items,
  // stage 1: CHECK against the right oracle in the firewalled lane
  (r) => {
    if (!LANES.includes(r.lane)) {
      // The right oracle is in a lane this run cannot reach. That is UNVERIFIED by definition.
      return Promise.resolve({
        claim: r.claim, lane: r.lane, oracleReached: false, verdict: 'UNVERIFIED',
        evidence: `Lane "${r.lane}" is not connected in this run (reachable: ${LANES.join(', ') || 'none'}). Right oracle: ${r.rightOracle}.`,
        source: 'none', confidence: 'low',
      })
    }
    return agent(
      `You verify ONE disputed claim against the RIGHT oracle: the source where it would be TRUE if real. You do NOT get to call it false just because it is absent from some other document.

Claim: "${r.claim}"
Claim type: ${r.claimType}
Right oracle (check THIS): ${r.rightOracle}
Lane: ${r.lane}
Do NOT read absence from this wrong-by-design source as disproof: ${r.wrongOracleWarning || '(none named)'}
${CONTEXT ? `Context: ${CONTEXT}` : ''}

Use ONLY your lane's tools: ${LANE_TOOLS[r.lane]}.
${FIREWALL}
${INTEGRITY}
Run the queries needed to reach the right oracle. Return your verdict with verbatim evidence (or the exact zero-result query if REFUTED). If you could not reach the right oracle, the answer is UNVERIFIED.`,
      { label: `check:${r.lane}`, phase: 'Check', schema: CHECK_SCHEMA },
    )
  },
  // stage 2: only REFUTED verdicts get an adversarial skeptic (a wrong RED is the failure we hunt)
  (checked) => {
    if (!checked || checked.verdict !== 'REFUTED') return { ...(checked || {}), refute: null }
    return agent(
      `A prior pass called this claim REFUTED (false). Your job is to try to OVERTURN that. A false "fabricated" verdict is the exact error this audit exists to prevent.

Claim: "${checked.claim}"
Lane: ${checked.lane} | oracle reached: ${checked.oracleReached}
Their REFUTED evidence: ${checked.evidence}
Their source: ${checked.source}

Ask hard: (1) Was the RIGHT oracle actually queried, or a wrong-by-design one? (2) For a CRM claim, was the query pinned to the CORRECT record, not a name-matched duplicate? (3) For a financial claim, is this forward guidance versus trailing actuals, where both are true? (4) Is this "not found where it would not be" masquerading as "false"?
Use ONLY your lane's tools if you need to re-check: ${LANE_TOOLS[checked.lane] || LANE_TOOLS.web}.
${FIREWALL}
Return whether the REFUTED verdict holds. If the right oracle was not truly reached, the safer verdict is UNVERIFIED, not REFUTED.`,
      { label: `refute:${checked.lane}`, phase: 'Refute', schema: REFUTE_SCHEMA },
    ).then((ref) => ({ ...checked, refute: ref }))
  },
)

// Synthesis (plain code, no barrier needed). Downgrade any REFUTED the skeptic overturned.
const final = results.filter(Boolean).map((x) => {
  let verdict = x.verdict
  if (x.verdict === 'REFUTED' && x.refute && x.refute.verdictUpheld === false) {
    verdict = (x.refute.saferVerdict && x.refute.saferVerdict !== 'unchanged') ? x.refute.saferVerdict : 'UNVERIFIED'
  }
  return {
    claim: x.claim, lane: x.lane, oracleReached: x.oracleReached, verdict, originalVerdict: x.verdict,
    evidence: x.evidence, source: x.source, refuteNote: (x.refute && x.refute.reasoning) || null,
  }
})

const tally = final.reduce((a, f) => { a[f.verdict] = (a[f.verdict] || 0) + 1; return a }, {})
const overturned = final.filter((f) => f.originalVerdict === 'REFUTED' && f.verdict !== 'REFUTED')
log(`provenance-audit done: ${JSON.stringify(tally)}${overturned.length ? ` | ${overturned.length} false-fabrication verdict(s) caught and downgraded` : ''}`)

return {
  tally,
  claims: final,
  falseFabricationsCaught: overturned.map((f) => f.claim),
  rule: 'Absence from a wrong-by-design oracle is not evidence. UNVERIFIED != REFUTED. Ref: rules/refutation-needs-the-right-oracle.md',
}
