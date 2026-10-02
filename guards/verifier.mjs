#!/usr/bin/env node
/**
 * verifier.mjs — the verifier hierarchy.
 *
 * The plan names three tiers with STRICTLY different authority, and the whole point is that they do
 * NOT collapse into one another:
 *   1. same-model / fresh-context review  → ADVISORY. It shares the model's blind spots, so it may
 *      surface a concern but can NEVER block or bless. (An agent grading its own work is advisory.)
 *   2. deterministic oracle               → BLOCKS. A test, schema check, hash compare, row count —
 *      model-independent, so it is allowed to fail the run.
 *   3. independent manual / owner review  → OUTSIDE THE BUILDER'S REACH. A builder run can NEVER satisfy it;
 *      it stays REQUIRES-OWNER until an out-of-band owner signal arrives .
 *
 * adjudicate() enforces the ordering: an advisory result cannot flip a block, a deterministic failure
 * blocks, and an unmet owner requirement blocks and cannot be auto-cleared. Unknown verifier kinds
 * fail closed to the owner tier (a check we can't classify must not auto-pass).
 */

export const TIERS = ['advisory', 'oracle', 'owner']; // strictly increasing authority

// map a verifier's KIND string to its tier. OWNER-FIRST (adversarial-review fix): an owner/independent/
// approval signal outranks a generic "review"/"gate", so an "independent model-review" is owner (not
// advisory) and an "approval gate" is owner (not a builder-clearable oracle). Same-model/self review is
// advisory (shares the model's blind spots). Deterministic checks block. Unknown fails closed to owner.
export function verifierTier(kind = '') {
  const k = String(kind).toLowerCase();
  if (/\b(manual|owner|human|independent|hash[-_ ]?approval|approval|sign[-_ ]?off)\b/.test(k)) return 'owner';
  if (/\b(same[-_ ]?model|fresh[-_ ]?context|self[-_ ]?review|model[-_ ]?review|advisory)\b/.test(k)) return 'advisory';
  if (/\b(oracle|test|schema|hash|deterministic|proof|gate|assertion|count|lint|typecheck)\b/.test(k)) return 'oracle';
  return 'owner'; // fail-closed: an unclassifiable verifier cannot be a blocking oracle NOR auto-pass
}

/**
 * adjudicate(results, opts) — decide whether a set of verifier results clears.
 * Each result: { id, kind?, tier?, passed:boolean }.
 *
 * Adversarial-review fixes (all four were fail-OPEN holes):
 *  - EXPLICIT TIER IS CLAMPED + NO-DOWNGRADE. A caller-supplied `tier` used to short-circuit the
 *    fail-closed classifier (`r.tier || verifierTier(...)`), and an unknown/mis-cased/downgraded value
 *    fell into no bucket → never blocked. Now `tier` is lower-cased, clamped to TIERS, and may only RAISE
 *    authority above the kind-derived tier, never lower it (so tier:'advisory' can't neuter an oracle).
 *  - ORACLE IS FAIL-CLOSED. Blocks unless `passed === true` (a missing/undefined/null/crashed oracle
 *    result blocks, instead of the old `passed === false` which let every non-false value pass).
 *  - OWNER CLEARANCE IS AUTHENTICATED. A plain `ownerSatisfied` boolean on a builder-produced result is
 *    NO LONGER TRUSTED (it contradicted "a builder run can never satisfy it"). Owner tier clears ONLY via
 *    opts.ownerVerify(id, result) === true — a callback the caller binds to an owner key/signature check,
 *    out of the builder's reach . With no ownerVerify, every owner item stays open.
 */
export function adjudicate(results = [], opts = {}) {
  const rank = t => TIERS.indexOf(t);
  const ownerVerify = typeof opts.ownerVerify === 'function' ? opts.ownerVerify : null;
  const decided = results.map(r => {
    const fromKind = verifierTier(r.kind || '');
    const explicit = TIERS.includes(String(r.tier || '').toLowerCase()) ? String(r.tier).toLowerCase() : null;
    const tier = explicit && rank(explicit) >= rank(fromKind) ? explicit : fromKind; // raise-only clamp
    return { ...r, tier };
  });
  const oracleBlocks = decided.filter(r => r.tier === 'oracle' && r.passed !== true);          // fail-closed
  const advisoryWarns = decided.filter(r => r.tier === 'advisory' && r.passed !== true);
  const ownerOpen = decided.filter(r => r.tier === 'owner' && !(ownerVerify && ownerVerify(r.id, r) === true));
  const blocked = oracleBlocks.length > 0 || ownerOpen.length > 0;
  return {
    ok: !blocked,
    blocked,
    reason: oracleBlocks.length ? `deterministic oracle failed/unproven: ${oracleBlocks.map(r => r.id).join(', ')}`
      : ownerOpen.length ? `requires authenticated owner clearance (outside the builder's reach): ${ownerOpen.map(r => r.id).join(', ')}`
        : 'clear',
    oracleBlocks: oracleBlocks.map(r => r.id),
    advisoryWarns: advisoryWarns.map(r => r.id), // surfaced, never blocking
    ownerOpen: ownerOpen.map(r => r.id),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('verifier tiers:', TIERS.join(' < '), '(advisory never blocks; oracle blocks; owner is outside the builder\'s reach)');
}
