#!/usr/bin/env node
/**
 * fuzz.test.mjs — proof for the fuzz + ablation harness. Exit 1 on any failure.
 * The property under test: NO FAIL-OPEN across a fuzzed corpus. Plus the harness is non-vacuous — an
 * ablated (no-op) guard must break the property, and a broken guard passed to the fuzzer must be caught.
 */
import { fuzzEgress, fuzzClassifier, ablation, runFuzz } from './fuzz.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

// the real guards hold across the fuzzed corpus
const e = fuzzEgress();
ok(e.ok && e.failOpen === 0, `egress guard: 0 fail-open across ${e.tested} fuzzed URLs`);
const c = fuzzClassifier();
ok(c.ok && c.underGate === 0, `mcp classifier: 0 under-gated mutations across ${c.tested} fuzzed tool names`);

// proof-that-can-fail: a broken (no-op) egress guard MUST produce fail-opens
const broken = fuzzEgress(600, 1, () => ({ ok: true }));
ok(broken.failOpen > 0, 'the fuzzer catches a broken always-allow egress guard (non-vacuous)');
const brokenC = fuzzClassifier(600, 2, () => 'network.read');
ok(brokenC.underGate > 0, 'the fuzzer catches a broken always-read classifier (non-vacuous)');

// ablation: each guard is load-bearing (removing it breaks the property)
const a = ablation();
ok(a.egress_is_load_bearing, 'ablation: the egress guard is load-bearing (no-op version fails open)');
ok(a.classify_is_load_bearing, 'ablation: the classifier is load-bearing (no-op version under-gates)');

// determinism (adversarial-review fix — the old assertion was 0===0, a tautology that can't go red):
// run a BROKEN guard twice at the same seed so failOpen>0, and require the escape SAMPLES to match
// byte-for-byte across runs — a non-trivial value that would diverge if the generator weren't seeded.
const d1 = fuzzEgress(300, 7, () => ({ ok: true }));
const d2 = fuzzEgress(300, 7, () => ({ ok: true }));
ok(d1.failOpen > 0 && d1.failOpen === d2.failOpen && JSON.stringify(d1.escapes) === JSON.stringify(d2.escapes), 'fuzz is deterministic: same seed → identical failOpen count AND identical escape samples (non-trivial)');
const d3 = fuzzEgress(300, 8, () => ({ ok: true }));
ok(JSON.stringify(d3.escapes) !== JSON.stringify(d1.escapes), 'a DIFFERENT seed produces a different corpus (the seed actually varies the inputs)');
// fuzzClassifier now returns its escape samples (was collected but dropped)
const bc = fuzzClassifier(600, 2, () => 'network.read');
ok(Array.isArray(bc.escapes) && bc.escapes.length > 0, 'fuzzClassifier returns escape samples for a broken classifier');

ok(runFuzz().ok === true, 'runFuzz: all properties hold and both guards load-bearing');

console.log(`fuzz.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
