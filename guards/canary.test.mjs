#!/usr/bin/env node
/**
 * canary.test.mjs — proof for the drift-canary harness. Exit 1 on any failure.
 * Two things must hold: (1) all guards currently hold (no drift), and (2) the detector is NOT vacuous —
 * a seeded drift is actually reported (proof-that-can-fail).
 */
import { runCanaries, CANARY_IDS } from './canary.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

const clean = runCanaries();
ok(clean.ok === true, `all ${clean.total} guards hold, no drift`);
ok(clean.results.every(r => r.ok), 'every canary matches its expected behavior');

// exact-id coverage (adversarial-review fix): a silent deletion of any canary must fail this test,
// and both directions (fire on bad, silent on good) must be covered for each primitive.
const gotIds = new Set(clean.results.map(r => r.id));
for (const id of ['drift·mismatch', 'drift·match', 'silentEmpty·zerorows', 'silentEmpty·hasrows',
  'ungrounded·uncited', 'ungrounded·cited', 'execution·noassert', 'execution·good',
  'modelsub·swap', 'modelsub·match', 'egress·tab-differential', 'egress·protocol-relative',
  'classify·mutate', 'classify·read', 'classify·unknown-failclosed'])
  ok(gotIds.has(id), `canary present: ${id}`);
ok(clean.total === CANARY_IDS.length, 'canary count matches the exported id list (no silent add/drop)');

// proof-that-can-fail: seed a drift and confirm the detector reports it
ok(runCanaries({ seedDrift: true }).ok === false, 'a seeded drift IS reported — the canary can go red');
// a VALUE canary (not fire/silent) can also be seeded — the old flip only handled fire/silent
const seededVal = runCanaries({ seedDrift: 'classify·mutate' });
ok(seededVal.ok === false && seededVal.drifted.some(d => d.id === 'classify·mutate'), 'a seeded VALUE canary (classify·mutate) is flagged (not just fire/silent canaries)');
// an UNKNOWN seed id must NOT read as clean green (no fake-green in the proof mechanism)
const badSeed = runCanaries({ seedDrift: 'no-such-canary-xyz' });
ok(badSeed.ok === false && badSeed.seedMatched === false, 'a typo/unknown seed id → NOT clean (the proof mechanism cannot be fooled into fake-green)');

console.log(`canary.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
