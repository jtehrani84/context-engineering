// human-fp-budget.mjs — standing gate: the deterministic layer must not start rejecting real people.
// LOCAL ONLY: no model, judge or web call. Scores every doc in the public human corpora (fetched by
// fetch-public-corpora.sh) with the shipped code in one process (aiscore.mjs scoreText -> prose-gate.mjs
// parseAiscore + detectInjection + combine, i.e. the --det-only verdict), and cross-checks a sample against the
// real `prose-gate --det-only` CLI so the in-process path can't drift from what ships.
//
// FAILS (exit 1) if
//   - the pooled public reject count exceeds the measured post-fix count in human-fp-budget.json plus a small
//     margin, max(2, ceil(0.01% of n)); or
//   - any pinned structural tell (VERDICT_STRUCT_TYPES) or any judge-directed-injection pattern hits ANY human
//     doc (a pattern that rejects on its own must cost zero real people); or
//   - a corpus is missing or has a different doc count than the one measured (wrong version: re-run the fetch);
//   - the in-process verdict disagrees with the CLI on any cross-checked doc.
//
// The hook lane (added 2026-10-02 with D19): the same docs also go through the send hook's own word list and "As <Name>"
// check (calibration/hook-lexicon.py, counts only), because the verdict above never runs the hook's lexicon. FAILS if
// a set's docs the hook would deny on a send exceed the baseline's hookLexicon count plus the same margin, or if the
// lane can't run. --write-hook-baseline records only that part of the baseline (review the diff!).
//
// Every guard change must pass this AND calibration/gate-eval.mjs. For changes that only move a verdict (a pin, a
// bar, which checks count), this replaces harness-eval's "tune gain" requirement: harness-eval measures the raw
// score and flag counts, so it reads a verdict-only change as g = 0 and can't pass or fail it.
//
// Run:   bash calibration/fetch-public-corpora.sh && node calibration/human-fp-budget.mjs
//        node calibration/human-fp-budget.mjs --write-baseline   # record the current counts (review the diff!)
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const DEST = process.env.VOICE_CORPORA || join(homedir(), '.cache', 'voice-system', 'corpora');
const BASELINE = join(HERE, 'human-fp-budget.json');
const { scoreText } = await import(join(ROOT, 'aiscore.mjs'));
const { parseAiscore, detectInjection, combine } = await import(join(ROOT, 'prose-gate.mjs'));
const { VERDICT_STRUCT_TYPES } = await import(join(ROOT, 'voice-overlay.mjs'));
const md5 = (s) => createHash('md5').update(s).digest('hex');
const ws = (t) => t.split(/\s+/).filter(Boolean).length;

// ── corpora: the cleaning the 2026-10-01 calibration used (recal/common.mjs), so counts are comparable ────────
function loadPublic() {
  const need = ['f18', 'pep', 'rfc', '20news-bydate-train', '20news-bydate-test'].filter((d) => !existsSync(join(DEST, d)));
  if (need.length) { console.error(`missing corpora in ${DEST}: ${need.join(', ')}\nrun: bash ${join(HERE, 'fetch-public-corpora.sh')}`); process.exit(1); }
  const docs = [];
  for (const f of readdirSync(join(DEST, 'f18')).filter((f) => f.endsWith('.md')).sort()) {
    let t = readFileSync(join(DEST, 'f18', f), 'utf8');
    if (/^---\n[\s\S]*?^(redirect_to|redirect_from|layout: redirect)/m.test(t.slice(0, 2000))) continue;
    t = t.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '').replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, '');
    docs.push({ set: '18F', id: f, text: t });
  }
  for (const f of readdirSync(join(DEST, 'pep')).sort()) docs.push({ set: 'PEP', id: f, text: readFileSync(join(DEST, 'pep', f), 'utf8').split('\n').filter((l) => !/^\s{2,}|^\t/.test(l)).join('\n') });
  for (const f of readdirSync(join(DEST, 'rfc')).sort()) docs.push({ set: 'RFC', id: f, text: readFileSync(join(DEST, 'rfc', f), 'utf8') });
  const seen = new Set();
  for (const r of ['20news-bydate-train', '20news-bydate-test']) for (const g of readdirSync(join(DEST, r)).sort()) for (const f of readdirSync(join(DEST, r, g)).sort()) {
    let t = readFileSync(join(DEST, r, g, f), 'latin1');
    const i = t.indexOf('\n\n'); t = i >= 0 ? t.slice(i + 2) : t;
    const sig = t.search(/^-- ?$/m); if (sig >= 0) t = t.slice(0, sig);
    t = t.split('\n').filter((l) => !/^\s*(>|\||:)/.test(l) && !/(writes|wrote|says):\s*$/i.test(l) && !/^In article\s*</i.test(l)).join('\n');
    const h = md5(t.replace(/\s+/g, ' ').trim()); if (seen.has(h)) continue; seen.add(h);
    if (ws(t) < 20) continue;
    docs.push({ set: '20NG', id: `${g}/${f}`, text: t });
  }
  return docs;
}

// ── the --det-only verdict, in process ─────────────────────────────────────────────────────────────────────
function verdictOf(text) {
  const det = parseAiscore(JSON.stringify({ file: '(stdin)', ...scoreText(text).json }));
  det.injection = detectInjection(text);
  const c = combine({ det, judges: [], bar: 50, detBar: 40, need: 1 });
  return { verdict: c.verdict, reason: c.detReason, pinned: det.criticalStruct.count > 0, injection: det.injection.count > 0, adjusted: det.adjustedScore };
}

const t0 = Date.now();
const pub = loadPublic();
const sets = {}, rejects = [], hardFails = [];
for (const d of pub) {
  const v = verdictOf(d.text);
  const s = (sets[d.set] ||= { n: 0, rejects: 0, byScore: 0, pinned: 0, injection: 0 });
  s.n++;
  if (v.verdict === 'REJECT') { s.rejects++; if (!d.countsOnly) rejects.push(`${d.set}/${d.id}: ${v.reason}`); }
  if (v.adjusted >= 40) s.byScore++;
  if (v.pinned) { s.pinned++; hardFails.push(d.countsOnly ? `${d.set}: a pinned tell hit a doc (id withheld)` : `${d.set}/${d.id}: pinned tell (${v.reason})`); }
  if (v.injection) { s.injection++; hardFails.push(d.countsOnly ? `${d.set}: an injection pattern hit a doc (id withheld)` : `${d.set}/${d.id}: injection pattern (${v.reason})`); }
}
const PUBLIC_SETS = ['18F', 'PEP', 'RFC', '20NG'];
const pooled = PUBLIC_SETS.reduce((a, k) => ({ n: a.n + (sets[k]?.n || 0), rejects: a.rejects + (sets[k]?.rejects || 0) }), { n: 0, rejects: 0 });
const margin = (n) => Math.max(2, Math.ceil(0.0001 * n));

// ── cross-check a seeded sample (plus every reject) against the real CLI ───────────────────────────────────
let seed = 20261002; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const check = pub.filter((d) => rnd() < 24 / pub.length || verdictOf(d.text).verdict === 'REJECT').slice(0, 60);
let cliMismatch = 0;
for (const d of check) {
  const p = spawnSync('node', [join(ROOT, 'prose-gate.mjs'), '-', '--det-only', '--json'], { input: d.text, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180000, killSignal: 'SIGKILL' });
  let j = null; try { j = JSON.parse(p.stdout); } catch {}
  if (!j || j.verdict !== verdictOf(d.text).verdict) { cliMismatch++; console.log(`  CLI mismatch: ${d.set}/${d.id} in-process ${verdictOf(d.text).verdict}, CLI ${j?.verdict} (exit ${p.status})`); }
}

// ── the hook lane: the send hook's own lexicon over the same docs (counts only) ─────────────────────────────
const lane = spawnSync('python3', [join(HERE, 'hook-lexicon.py')], {
  input: pub.map((d) => JSON.stringify({ set: d.set, text: d.text })).join('\n'), encoding: 'utf8', maxBuffer: 1 << 26,
  timeout: 1800000, killSignal: 'SIGKILL', env: { ...process.env, VOICE_COMPANY_NAMES: join(HERE, '.no-company-names') },
});
let hookSets = null; try { hookSets = JSON.parse(lane.stdout.trim().split('\n').pop()); } catch {}
if (hookSets) for (const k of PUBLIC_SETS) if (!hookSets[k]) hookSets[k] = { n: 0, blockDocs: 0, openerBlockDocs: 0, nudgeOnlyDocs: 0 };

let commit = '?'; try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
console.log(`human-fp-budget · tools @ ${commit} · corpora ${DEST} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('set'.padEnd(8), 'n'.padStart(6), ' rejects  by-score  pinned  injection');
for (const [k, s] of Object.entries(sets)) console.log(k.padEnd(8), String(s.n).padStart(6), String(s.rejects).padStart(9), String(s.byScore).padStart(9), String(s.pinned).padStart(7), String(s.injection).padStart(10));
console.log(`pooled public: ${pooled.rejects} of ${pooled.n} rejected; CLI cross-check ${check.length - cliMismatch}/${check.length} agree`);
for (const r of rejects) console.log(`  reject: ${r}`);
if (hookSets) {
  console.log('hook lane (send hook lexicon: docs it would deny, of them for an opener, docs with nudges only)');
  for (const [k, s] of Object.entries(hookSets)) console.log(k.padEnd(8), String(s.n).padStart(6), String(s.blockDocs).padStart(9), String(s.openerBlockDocs).padStart(9), String(s.nudgeOnlyDocs).padStart(9));
} else console.log(`hook lane did not run (exit ${lane.status}${lane.error ? `, ${lane.error.message}` : ''}): ${(lane.stderr || '').trim().split('\n').pop() || 'no output'}`);
if (process.argv.includes('--write-hook-baseline')) {
  if (!hookSets) { console.log('FAIL: the hook lane did not run; nothing written'); process.exit(1); }
  const b = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  b.hookLexicon = { measuredAt: new Date().toISOString(), toolsCommit: commit, note: 'send hook lexicon (word list + "As <Name>" + flat view, built-in company names only) over the same docs; counts only. Re-record only with a reviewed reason (decision log D19).', sets: Object.fromEntries(Object.entries(hookSets).map(([k, s]) => [k, { n: s.n, blockDocs: s.blockDocs, openerBlockDocs: s.openerBlockDocs }])) };
  writeFileSync(BASELINE, JSON.stringify(b, null, 1) + '\n'); console.log(`hook-lane baseline written to ${BASELINE}`); process.exit(0);
}

if (process.argv.includes('--write-baseline')) {
  const b = { measuredAt: new Date().toISOString(), toolsCommit: commit, note: 'post-fix rates after rule C, cadence out of the score, AI-evidence classification, normalization and the injection check (2026-10-02). Re-record only with a reviewed reason.', sets: Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { n: s.n, rejects: s.rejects }])), pooledPublic: pooled };
  writeFileSync(BASELINE, JSON.stringify(b, null, 1) + '\n'); console.log(`baseline written to ${BASELINE}`); process.exit(0);
}
if (!existsSync(BASELINE)) { console.log(`FAIL: no baseline at ${BASELINE}`); process.exit(1); }
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const fails = [...hardFails];
for (const k of PUBLIC_SETS) if (base.sets[k] && sets[k]?.n !== base.sets[k].n) fails.push(`${k}: ${sets[k]?.n ?? 0} docs, baseline measured ${base.sets[k].n} (corpus version changed? re-run fetch-public-corpora.sh)`);
const allowed = base.pooledPublic.rejects + margin(base.pooledPublic.n);
if (pooled.rejects > allowed) fails.push(`pooled public rejects ${pooled.rejects} > budget ${allowed} (measured ${base.pooledPublic.rejects} + margin ${margin(base.pooledPublic.n)})`);
if (cliMismatch) fails.push(`${cliMismatch} in-process verdicts disagree with the CLI`);
if (!hookSets) fails.push('the hook lane did not run (python3 and hook/voice-tell-gate.py are needed)');
else if (!base.hookLexicon) fails.push('no hookLexicon baseline: run with --write-hook-baseline and review it');
else for (const [k, b] of Object.entries(base.hookLexicon.sets)) {
  const s = hookSets[k];
  if (!s) { fails.push(`hook lane: no docs for ${k}`); continue; }
  const a = b.blockDocs + margin(b.n);
  if (s.blockDocs > a) fails.push(`hook lane ${k}: ${s.blockDocs} docs the send hook would deny > budget ${a} (measured ${b.blockDocs} at ${base.hookLexicon.toolsCommit} + margin ${margin(b.n)})`);
}
if (fails.length) { console.log(`\nFAIL:\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`PASS: pooled public ${pooled.rejects} ≤ budget ${allowed} (measured ${base.pooledPublic.rejects} at ${base.toolsCommit} + margin ${margin(base.pooledPublic.n)}); pinned tells and injection patterns hit 0 human docs; the hook lane is within its baseline`);
