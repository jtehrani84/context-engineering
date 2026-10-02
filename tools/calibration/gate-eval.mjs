// End-to-end: run every labeled item through `prose-gate --det-only` (LOCAL ONLY, no judge, zero egress)
// and count verdicts. This measures the shipped verdict code, not a re-derivation of it. Expect: 0 REJECT
// on every human set, and 0 ADMIT anywhere (det-only can only REJECT or be INCONCLUSIVE).
// Run: node calibration/gate-eval.mjs   (see load-sets.mjs for data-protection rules)
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadSets, isHuman } from './load-sets.mjs';

const gate1 = (text) => {
  try { return JSON.parse(execFileSync('node', [join(ROOT, 'prose-gate.mjs'), '-', '--det-only', '--json'], { input: text, encoding: 'utf8', maxBuffer: 1e8, timeout: 180000, killSignal: 'SIGKILL' })); }
  catch (e) { try { return JSON.parse(e.stdout); } catch { return { verdict: 'ERROR', error: String(e.message || e).slice(0, 120) }; } } // exit 2 = REJECT, 3 = INCONCLUSIVE, 4 = ERROR; stdout still holds the JSON
};
// An ERROR (the deterministic layer failed, 2026-10-02) is retried once, then counted: it must be 0.
const gate = (text) => { const g = gate1(text); return g.verdict === 'ERROR' ? gate1(text) : g; };
const out = loadSets().map((r) => { const g = gate(r.text); return { ...r, v: g.verdict, why: g.deterministic?.reason ?? g.error }; });
const groups = {};
for (const r of out) (groups[`${r.set} | ${r.label}`] ||= []).push(r);
console.log('set | label'.padEnd(36), 'n'.padStart(3), '  REJECT  INCONCL  ADMIT  ERROR');
for (const [k, g] of Object.entries(groups)) {
  const c = (v, w) => String(g.filter((r) => r.v === v).length).padStart(w);
  console.log(k.padEnd(36), String(g.length).padStart(3), `  ${c('REJECT', 6)}  ${c('INCONCLUSIVE', 7)}  ${c('ADMIT', 5)}  ${c('ERROR', 5)}`);
}
const humanRejects = out.filter((r) => isHuman(r.label) && r.v === 'REJECT');
console.log(`\nREJECT on human / approved items: ${humanRejects.length}`);
for (const r of humanRejects) console.log(`  ${r.set}/${r.id}: ${r.why}`);
console.log(`ADMIT anywhere (must be 0): ${out.filter((r) => r.v === 'ADMIT').length}`);
console.log(`ERROR anywhere (must be 0): ${out.filter((r) => r.v === 'ERROR').length}`);
