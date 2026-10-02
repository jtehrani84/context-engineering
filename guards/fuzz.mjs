#!/usr/bin/env node
/**
 * fuzz.mjs — gate fuzzing + rule ablation.
 *
 * Property-based, DETERMINISTIC (seeded LCG, so a failure reproduces). The one property that must hold
 * across every generated input is NO FAIL-OPEN: a non-allowlisted host never passes the egress guard, and
 * a tool name containing a mutate verb never classifies as a benign read. Fuzzing hunts the obfuscation
 * the hand-written cases missed; ablation confirms each guard is load-bearing (swap in a no-op and the
 * property breaks — proving the guard, not luck, is what holds it).
 */
import { classifyOp } from './mcp-classify.mjs';
import { checkEgress } from './egress-guard.mjs';

function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const pick = (rnd, arr) => arr[(rnd() * arr.length) | 0];

const ALLOW = ['trusted-saas.test'];
const EVIL = ['evil.com', 'attacker-collect.com', 'data.exfil.net', 'x.evil.co.uk'];
// obfuscations a real attacker reaches for; each embeds a host string
const OBF = [
  h => `https://${h}/p`,
  h => `<img src="https://${h}/pixel.png">`,
  h => `//${h}/p`,
  h => `![x](//${h}/p.png)`,
  h => `url(//${h}/p)`,
  h => `https://trusted-saas.test\t.${h}/p`,   // tab parse-differential
  h => `https://trusted-saas.test\n.${h}/p`,   // newline parse-differential
  h => `see //${h}/p for details`,          // bare protocol-relative
];

// fuzz the egress guard. Property: an EVIL (non-allowlisted) host must never pass. guard is injectable so
// a test can prove the fuzzer catches a fail-open by passing a broken always-allow guard.
export function fuzzEgress(n = 600, seed = 1, guard = (s, o) => checkEgress(s, o)) {
  const rnd = lcg(seed);
  let tested = 0, failOpen = 0; const escapes = [];
  for (let i = 0; i < n; i++) {
    const useEvil = rnd() < 0.5;
    const host = useEvil ? pick(rnd, EVIL) : ALLOW[0];
    const s = pick(rnd, OBF)(host);
    const r = guard(s, { allowHosts: ALLOW });
    tested++;
    if (useEvil && r && r.ok) { failOpen++; if (escapes.length < 5) escapes.push(s.replace(/\t/g, '\\t').replace(/\n/g, '\\n')); }
  }
  return { tested, failOpen, escapes, ok: failOpen === 0 };
}

// fuzz the MCP classifier. Property: a mutate verb ANYWHERE must never classify as network.read.
export function fuzzClassifier(n = 600, seed = 2, classify = classifyOp) {
  const rnd = lcg(seed);
  const MUT = ['delete', 'send', 'update', 'push', 'drop', 'remove', 'create', 'post', 'revoke', 'grant', 'deregister', 'unlink', 'unpublish', 'unassign', 'expire', 'detach', 'flush', 'truncate', 'invalidate', 'decommission'];
  const READ = ['get', 'list', 'search', 'read', 'view'];
  const NOUN = ['record', 'file', 'account', 'thread', 'user', 'key', 'contents'];
  let tested = 0, underGate = 0; const escapes = [];
  for (let i = 0; i < n; i++) {
    const hasMutate = rnd() < 0.5;
    const parts = [];
    const k = 1 + ((rnd() * 3) | 0);
    for (let j = 0; j < k; j++) parts.push(rnd() < 0.4 ? pick(rnd, READ) : pick(rnd, NOUN));
    if (hasMutate) parts.splice((rnd() * (parts.length + 1)) | 0, 0, pick(rnd, MUT));
    const op = parts.join('_');
    const cls = classify(op);
    tested++;
    if (hasMutate && cls === 'network.read') { underGate++; if (escapes.length < 5) escapes.push(op); }
  }
  return { tested, underGate, escapes, ok: underGate === 0 };
}

// rule ablation: swap in a no-op guard and confirm the property BREAKS — proving the guard is load-bearing
// (not that the corpus happened to be benign). A guard whose ablation does NOT break the property is a
// rubber stamp.
export function ablation() {
  const egressAblated = fuzzEgress(600, 1, () => ({ ok: true }));              // no-op egress guard
  const classifyAblated = fuzzClassifier(600, 2, () => 'network.read');        // no-op classifier (always read)
  return {
    egress_is_load_bearing: egressAblated.failOpen > 0,
    classify_is_load_bearing: classifyAblated.underGate > 0,
    ok: egressAblated.failOpen > 0 && classifyAblated.underGate > 0,
  };
}

export function runFuzz() {
  const e = fuzzEgress(), c = fuzzClassifier(), a = ablation();
  return { egress: e, classifier: c, ablation: a, ok: e.ok && c.ok && a.ok };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runFuzz();
  console.log(`fuzz·egress: ${r.egress.tested} inputs, ${r.egress.failOpen} fail-open${r.egress.escapes.length ? ' [' + r.egress.escapes.join(', ') + ']' : ''}`);
  console.log(`fuzz·classifier: ${r.classifier.tested} inputs, ${r.classifier.underGate} under-gated`);
  console.log(`ablation: egress load-bearing=${r.ablation.egress_is_load_bearing} classifier load-bearing=${r.ablation.classify_is_load_bearing}`);
  console.log(r.ok ? 'fuzz: no fail-open; both guards load-bearing' : 'fuzz: FAILURE');
  process.exit(r.ok ? 0 : 1);
}
