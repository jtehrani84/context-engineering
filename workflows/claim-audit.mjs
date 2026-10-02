export const meta = {
  name: 'claim-audit',
  description: 'Audit an external-facing artifact for source-faithfulness: extract claims, re-verify each against source, flag inversions and overclaims, and find caveats stated more than once',
  whenToUse: 'A customer-, Support-, CSM-, or leadership-facing artifact asserts facts or a causal mechanism and someone will act on it as authoritative. Pass the artifact path as args (string), or {artifactPath, sources, register}.',
  phases: [
    { title: 'Extract', detail: 'pull every factual and causal claim from the artifact, and find repeated caveats' },
    { title: 'Verify', detail: 're-verify each claim against its source; tag documented, inferred, or unsupported' },
    { title: 'Refute', detail: 'adversarially re-check the claims marked unfaithful' },
    { title: 'Synthesize', detail: 'punch list and ship verdict' },
  ],
}

// Rule: rules/claims-faithful-to-source.md
// args: a path string, OR { artifactPath, sources, register }
//   sources  = the source excerpts or doc paths the claims rest on (ground truth; pass them for anything high-stakes)
//   register = 'technical' (default; bound every claim) | 'vision' (directional language allowed, stats still need a source)
const artifactPath = (typeof args === 'string') ? args : (args && args.artifactPath)
const sources = (args && typeof args === 'object' && args.sources) || null
const register = (args && typeof args === 'object' && args.register === 'vision') ? 'vision' : 'technical'
if (!artifactPath) throw new Error('claim-audit needs an artifact path (string) or {artifactPath, sources, register}')

const SRC_NOTE = sources
  ? `\n\nSOURCES (ground truth; verify claims against THESE, not the model's memory):\n${sources}`
  : `\n\nNo source excerpts were passed. Verify against any sources the artifact CITES (doc URLs, ticket IDs, records) by reading them; where a claim cites nothing, mark it UNSUPPORTED. Do NOT re-confirm a claim using only the artifact's own prose, because that re-confirms inversions.`

const REGISTER_NOTE = register === 'vision'
  ? `\n\nREGISTER: vision/seller. Directional claims ("our platform helps every team move faster", a bold thesis) are the register working as intended; do NOT flag them. Flag a claim ONLY when it is dressed as measured or proven data (a statistic, a percentage, a benchmark with no source), or when it misstates what a source says.`
  : `\n\nREGISTER: technical. Bound every factual and causal claim to its source.`

phase('Extract')
const [extracted, repeated] = await parallel([
  () => agent(
    `Read the external-facing artifact at ${artifactPath}. Extract EVERY factual claim and EVERY causal or mechanism claim it makes, meaning the things a reader would take as true. Include capability claims ("X does Y"), behavior claims ("enabling Z breaks or leaves W alone"), causal chains ("A happens because B"), absolutes ("the fix", "never", "only"), and any "documented" or "the docs say" assertions. For each, capture the exact sentence and what source (if any) it cites or rests on. Ignore pure formatting and voice; this is about truth claims.`,
    { label: 'extract-claims', phase: 'Extract', schema: {
      type: 'object', additionalProperties: false, required: ['claims'],
      properties: { claims: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['id', 'quote', 'citedSource', 'kind'],
        properties: {
          id: { type: 'string' },
          quote: { type: 'string', description: 'exact sentence from the artifact' },
          citedSource: { type: 'string', description: 'what it cites or rests on, or "none"' },
          kind: { enum: ['factual', 'causal', 'absolute', 'documented-label'] },
        } } } },
    } }),
  () => agent(
    `Read the artifact at ${artifactPath}. Find every caveat, bound, or limitation that is stated MORE THAN ONCE (the same limit restated in several boxes, footnotes, or paragraphs). A true bound stated once reads as rigor; the same bound repeated reads as defensive fluff to a senior reader. For each repeated bound, give the bound in one line, how many times it appears, and which single place should keep it. Return an empty list if nothing repeats.`,
    { label: 'bound-once', phase: 'Extract', schema: {
      type: 'object', additionalProperties: false, required: ['repeated'],
      properties: { repeated: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['bound', 'occurrences', 'keepIn'],
        properties: { bound: { type: 'string' }, occurrences: { type: 'number' }, keepIn: { type: 'string' } } } } },
    } }),
])
const claims = (extracted && extracted.claims) || []
log(`Extracted ${claims.length} claims from ${artifactPath} (register: ${register})`)
if (!claims.length) return { artifact: artifactPath, error: 'no claims extracted', bound_once: (repeated && repeated.repeated) || [] }

phase('Verify')
// Each claim is re-verified against source; the ones that come back unfaithful flow straight into Refute.
const verified = await pipeline(
  claims,
  c => agent(
    `Re-verify ONE claim from an external-facing artifact against its source. Do NOT trust the artifact's own wording; go to the source.\n\nCLAIM (${c.kind}): "${c.quote}"\nCITES: ${c.citedSource}${SRC_NOTE}${REGISTER_NOTE}\n\nDecide the TAG:\n- DOCUMENTED: the source explicitly states this claim (quote the supporting span).\n- INFERRED: the source states the PREMISES but not this exact claim; it is a reasoning step. (A causal chain with any inferred link is INFERRED, not DOCUMENTED.)\n- UNSUPPORTED: neither stated nor cleanly inferable from any cited source.\n\nThen judge FAITHFULNESS: is the claim as written faithful to the source, or does it (a) INVERT the source (says the opposite, especially in a reassuring direction like "no impact", "leaves untouched", "safe"), (b) OVERCLAIM (labels an inference "documented", states a hypothesis as fact, uses an absolute the source does not support), or (c) reason CIRCULARLY (uses the thing to be explained as its own proof)? Be adversarial; default to flagging if the source does not clearly back the exact words.`,
    { label: `verify:${c.id}`, phase: 'Verify', schema: {
      type: 'object', additionalProperties: false,
      required: ['id', 'tag', 'faithful', 'problem', 'sourceSpan', 'fix'],
      properties: {
        id: { type: 'string' },
        tag: { enum: ['documented', 'inferred', 'unsupported'] },
        faithful: { type: 'boolean' },
        problem: { enum: ['none', 'inversion', 'overclaim', 'circular', 'unsupported'] },
        sourceSpan: { type: 'string', description: 'the source text that supports it, or "none found"' },
        fix: { type: 'string', description: 'how to rewrite to be faithful; empty if faithful' },
      },
    } }).then(v => ({ ...c, ...v })),
  // Refute stage: only runs for claims flagged unfaithful; an independent skeptic tries to clear them.
  (v) => (!v || v.faithful)
    ? v
    : agent(
        `An auditor flagged this claim in an external-facing artifact as UNFAITHFUL to source. Try to REFUTE the auditor: is the claim actually fine (auditor misread, the source does support it, it is already hedged elsewhere)? Or is the flag correct?\n\nCLAIM: "${v.quote}"\nAUDITOR TAG: ${v.tag} | PROBLEM: ${v.problem}\nAUDITOR'S SOURCE SPAN: ${v.sourceSpan}\nPROPOSED FIX: ${v.fix}${SRC_NOTE}${REGISTER_NOTE}\n\nDefault to UPHOLDING the flag if the source does not clearly back the claim's exact wording. A reassuring-direction inversion is the highest-cost error, so err toward flagging. (An audit can also inject an inversion of its own; if the auditor's claim about the source looks wrong, say so and read the source again.)`,
        { label: `refute:${v.id}`, phase: 'Refute', schema: {
          type: 'object', additionalProperties: false,
          required: ['flagStands', 'severity', 'verdict', 'finalFix'],
          properties: {
            flagStands: { type: 'boolean' },
            severity: { enum: ['critical', 'high', 'medium', 'low'] },
            verdict: { type: 'string' },
            finalFix: { type: 'string' },
          },
        } }).then(r => ({ ...v, refute: r })),
)

phase('Synthesize')
const all = verified.filter(Boolean)
const confirmed = all.filter(v => !v.faithful && v.refute && v.refute.flagStands)
const tagCounts = all.reduce((m, v) => { m[v.tag] = (m[v.tag] || 0) + 1; return m }, {})
const boundOnce = (repeated && repeated.repeated) || []

const summary = await agent(
  `You are the lead editor for an external-facing artifact. Below are CONFIRMED source-faithfulness problems (flagged, then survived a refutation pass). Produce: (1) a ship verdict: ship-ready, ship-after-fixes, or needs-rework; (2) a prioritized punch list (severity, the problem, the exact rewrite); (3) a one-line tally of claim tags. Weight INVERSIONS and "documented"-over-inference highest, because those are the credibility killers.\n\nCONFIRMED PROBLEMS (${confirmed.length}):\n${JSON.stringify(confirmed.map(c => ({ id: c.id, quote: c.quote, problem: c.problem, severity: c.refute.severity, fix: c.refute.finalFix })), null, 1)}\n\nTAG TALLY: ${JSON.stringify(tagCounts)} across ${all.length} claims.`,
  { label: 'synthesize', phase: 'Synthesize', schema: {
    type: 'object', additionalProperties: false, required: ['verdict', 'overall', 'punch_list'],
    properties: {
      verdict: { enum: ['ship-ready', 'ship-after-fixes', 'needs-rework'] },
      overall: { type: 'string' },
      punch_list: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['severity', 'problem', 'rewrite'],
        properties: { severity: { enum: ['critical', 'high', 'medium', 'low'] }, problem: { type: 'string' }, rewrite: { type: 'string' } } } },
    },
  } }
)

return {
  artifact: artifactPath,
  register,
  sources_passed: !!sources,
  verdict: summary.verdict,
  overall: summary.overall,
  claims_total: all.length,
  tag_tally: tagCounts,
  confirmed_problems: confirmed.length,
  punch_list: summary.punch_list,
  bound_once: boundOnce,
}
