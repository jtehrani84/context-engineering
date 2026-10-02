#!/usr/bin/env node
/**
 * verifier.test.mjs — proof for the verifier hierarchy. Exit 1 on any failure.
 * Invariants: advisory NEVER blocks; a deterministic oracle blocks and is FAIL-CLOSED; owner clearance is
 * AUTHENTICATED (a builder-set boolean can't clear it); an explicit tier can only RAISE authority; unknown
 * kinds fail closed to owner. The last four guard the adversarial holes folded in.
 */
import { verifierTier, adjudicate } from './verifier.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
// an owner-key-backed clearance oracle (in production this verifies a signature; here a fixed allowlist)
const ownerVerify = id => new Set(['m1']).has(id);

// --- tier classification (owner-first) ---
ok(verifierTier('same-model fresh context review') === 'advisory', 'same-model self-review → advisory');
ok(verifierTier('deterministic oracle test') === 'oracle', 'deterministic test → oracle');
ok(verifierTier('independent manual review') === 'owner', 'independent manual review → owner');
ok(verifierTier('independent model-review') === 'owner', 'INDEPENDENT model-review → owner (independence outranks "model")');
ok(verifierTier('approval gate') === 'owner', 'approval gate → owner (approval outranks "gate"), not a builder-clearable oracle');
ok(verifierTier('vibes') === 'owner', 'unknown kind → fail-closed to owner');

// --- advisory NEVER blocks; oracle blocks ---
ok(adjudicate([{ id: 'a1', kind: 'same-model review', passed: false }]).ok === true, 'advisory failure warns but does NOT block');
ok(adjudicate([{ id: 'o1', kind: 'oracle test', passed: false }]).ok === false, 'oracle failure blocks');
ok(adjudicate([{ id: 'o1', kind: 'oracle test', passed: false }, { id: 'a1', kind: 'self-review', passed: true }]).ok === false, 'a passing advisory cannot rescue a failing oracle');

// --- oracle is FAIL-CLOSED: a non-true (missing/undefined/crashed) oracle result blocks ---
ok(adjudicate([{ id: 'o1', kind: 'oracle test' /* no passed */ }]).ok === false, 'oracle with missing passed → blocks (fail-closed, not the old ===false gap)');
ok(adjudicate([{ id: 'o1', kind: 'oracle test', passed: undefined }]).ok === false, 'oracle passed:undefined → blocks');
ok(adjudicate([{ id: 'o1', kind: 'oracle test', passed: 'false' }]).ok === false, "oracle passed:'false' (string) → blocks");

// --- explicit tier is clamped + raise-only (the fail-open short-circuit is closed) ---
ok(adjudicate([{ id: 'o1', kind: 'oracle test', tier: 'advisory', passed: false }]).ok === false, 'tier:advisory CANNOT downgrade a failing oracle (raise-only clamp)');
ok(adjudicate([{ id: 'o1', kind: 'oracle test', tier: 'Oracle', passed: false }]).ok === false, "case-variant tier:'Oracle' still blocks (lower-cased + clamped)");
ok(adjudicate([{ id: 'o1', kind: 'oracle test', tier: 'blah', passed: false }]).ok === false, "garbage tier:'blah' falls back to the kind (oracle) → blocks");
ok(adjudicate([{ id: 'm1', kind: 'independent manual review', tier: 'oracle', passed: true }], { ownerVerify: () => false }).ok === false, 'tier:oracle CANNOT downgrade an owner-kind item (raise-only) → still needs owner clearance');

// --- owner clearance is AUTHENTICATED: a builder-set boolean does NOT clear it ---
ok(adjudicate([{ id: 'm1', kind: 'independent manual review', passed: false, ownerSatisfied: true }]).ok === false, 'a self-set ownerSatisfied:true does NOT clear the owner tier (builder cannot forge clearance)');
ok(adjudicate([{ id: 'm1', kind: 'independent manual review', passed: true }]).ok === false, 'owner item with no ownerVerify → REQUIRES-OWNER (blocks)');
ok(adjudicate([{ id: 'm1', kind: 'independent manual review', passed: true }], { ownerVerify }).ok === true, 'owner item clears ONLY via an authenticated ownerVerify callback');
ok(adjudicate([{ id: 'm2', kind: 'owner hash-approval', passed: true }], { ownerVerify }).ok === false, 'ownerVerify keyed per id: an unlisted owner item (m2) stays open');

// --- full green path: advisory pass + oracle pass + owner authenticated ---
ok(adjudicate([
  { id: 'a1', kind: 'same-model review', passed: true },
  { id: 'o1', kind: 'oracle test', passed: true },
  { id: 'm1', kind: 'owner hash-approval', passed: true },
], { ownerVerify }).ok === true, 'full stack clears only when oracle passes AND owner is authenticated');

console.log(`verifier.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
