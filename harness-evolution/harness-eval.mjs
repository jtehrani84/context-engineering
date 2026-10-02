#!/usr/bin/env node
// harness-eval — a MEASURED, held-out scorecard for the local harness's voice/quality guard.
//
// The idea, from published research on evolving agent harnesses by selection, applied by hand:
// the harness's voice guard is a component you EVOLVE. Today, changes to it (a new banned word, a
// new structural pattern, a rule edit) are asserted — "I tweaked a regex and the tests still pass."
// This turns that into a MEASUREMENT: score a labeled corpus with the real verifier (aiscore.mjs +
// the voice overlay), on a tune split AND a held-out split, and reduce it to one fitness scalar
// per split. Then a change to the guard is admitted only if it improves tune fitness AND doesn't
// regress held-out beyond a budget (the preserve-and-extend gate) — the overfit check the research calls
// anti-cheat.
//
// Fitness is threshold-free and interpretable:
//     separation   = mean(aiScore | ai-slop passages) − mean(aiScore | human passages)   (want ≫ 0)
//     falseHardBans = human passages the guard wrongly hard-bans                          (want 0)
//     fitness      = separation − FALSE_HARDBAN_PENALTY × falseHardBans
// A guard that separates slop from clean voice AND never flags your own clean writing scores high.
//
// Usage:
//   node harness-eval.mjs                      # score the corpus, print the scorecard
//   node harness-eval.mjs --json               # machine-readable scorecard
//   node harness-eval.mjs --save baseline.json # save the current scorecard as the gate baseline
//   node harness-eval.mjs --gate baseline.json # compare current vs baseline → ADMIT / REJECT
//
// Exit 0 always for a plain run; --gate exits 1 on REJECT (so it can guard a commit/CI step).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AISCORE = join(HERE, '..', 'tools', 'aiscore.mjs');
const FALSE_HARDBAN_PENALTY = 15;   // a guard that flags your team's OWN clean writing is broken — punish hard
const DELTA = 5;                    // δ — held-out regression budget a guard change may carry and still admit

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

// aiscore returns its OWN `label` (e.g. "Minimal AI signals") — rename it so it can't clobber the
// corpus label (human/ai). badness = the guard's combined verdict: generic AI score PLUS the
// voice overlay's hard-bans ×10. This matters because voice-specific tells (announced hedge,
// aphorism) barely move aiScore but fire the overlay — so aiScore alone would miss them.
function score(text) {
  const out = execFileSync('node', [AISCORE, '-', '--json'], { input: text, encoding: 'utf8' });
  const r = JSON.parse(out);
  const cadenceFlags = r.voice.cadenceFlags || 0;
  // badness = generic AI score + hard-bans ×10 + cadence flags ×5. Cadence added 2026-09-19 so the
  // eval measures the RHYTHM layer, not just words — the exact gap that lets a clean-scoring draft
  // slip through with zero hard-bans while still reading as AI to an expert. Cadence is weighted below hard-bans (density signal, not a literal ban).
  return { aiScore: r.score, hardBans: r.voice.hardBans, cadenceFlags, aiLabel: r.label,
    badness: r.score + 10 * r.voice.hardBans + 5 * cadenceFlags };
}

const corpus = JSON.parse(readFileSync(join(HERE, 'corpus.json'), 'utf8'));
const scored = corpus.passages.map(p => ({ ...p, ...score(p.text) }));

// ── per-split fitness ─────────────────────────────────────────────────────────────────────────
// separation = mean(ai badness) − mean(human badness). One scalar that captures BOTH failure modes:
// missing slop pulls mean_ai down, and false-flagging clean human voice pulls mean_human up — either
// way separation drops. falseHardBans + aiCaught are reported as diagnostics (already inside badness).
function splitFitness(rows) {
  const human = rows.filter(r => r.label === 'human');
  const ai = rows.filter(r => r.label === 'ai');
  const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const meanHuman = +mean(human.map(r => r.badness)).toFixed(1);
  const meanAi = +mean(ai.map(r => r.badness)).toFixed(1);
  const separation = +(meanAi - meanHuman).toFixed(1);
  const falseHardBans = human.filter(r => r.hardBans > 0).length;
  const aiCaught = ai.filter(r => r.hardBans > 0 || r.cadenceFlags > 0 || r.aiScore >= 15).length;   // flagged by any signal (words, cadence, or generic)
  const fitness = falseHardBans > 0 ? +(separation - FALSE_HARDBAN_PENALTY * falseHardBans).toFixed(1) : separation;
  return { n: rows.length, nHuman: human.length, nAi: ai.length,
    meanHuman, meanAi, separation, falseHardBans, aiCaught, fitness };
}

// ── leave-one-out jackknife band (coverage-limited robustness, honest at small n) ──
// A COVERAGE-LIMITED robustness band, NOT a confidence interval. n is tiny here (11 total; the
// held-out human arm is n=1), so a "95% CI" would be false precision — the exact overclaim the VERA
// mapping warns against. Instead: drop each passage in turn, recompute fitness, report the min–max.
// It answers one honest question — how far does the number move if any single passage is dropped?
function jackknifeSplit(rows) {
  if (rows.length < 3) return { defined: false, note: `n=${rows.length} (need ≥3 for a band)` };
  const fits = [], seps = [];
  for (let i = 0; i < rows.length; i++) {
    const f = splitFitness(rows.filter((_, j) => j !== i));
    fits.push(f.fitness); seps.push(f.separation);
  }
  return { defined: true, fitMin: Math.min(...fits), fitMax: Math.max(...fits),
    sepMin: Math.min(...seps), sepMax: Math.max(...seps) };
}

const splits = ['tune', 'heldout'];
const scorecard = { generatedAtNote: 'stamp after run (Date.now avoided for reproducibility)' , splits: {} };
for (const s of splits) {
  const rows = scored.filter(r => r.split === s);
  scorecard.splits[s] = splitFitness(rows);
  scorecard.splits[s].jackknife = jackknifeSplit(rows);
}

// ── --save: write the baseline scorecard ────────────────────────────────────────────────────────
if (flagVal('--save')) {
  writeFileSync(flagVal('--save'), JSON.stringify({ splits: scorecard.splits }, null, 2));
  console.log(`baseline scorecard written → ${flagVal('--save')}`);
  process.exit(0);
}

// ── --gate: compare current vs a saved baseline (the preserve-and-extend gate) ───────────────────
if (flagVal('--gate')) {
  const base = JSON.parse(readFileSync(flagVal('--gate'), 'utf8')).splits;
  const cur = scorecard.splits;
  const g = +(cur.tune.fitness - base.tune.fitness).toFixed(1);              // net gain on tune
  const R = +Math.max(0, base.heldout.fitness - cur.heldout.fitness).toFixed(1); // held-out regression
  const admit = g > 0 && R <= DELTA;
  // Leave-one-out verdict stability: drop each passage, recompute the verdict against the FIXED
  // baseline, and see whether ADMIT/REJECT ever flips. If a single passage can flip it, the call
  // hinges on that one row and isn't decisive at this n — honest small-n reporting, not a fake CI.
  const loo = scored.map((_, i) => {
    const sub = scored.filter((_, j) => j !== i);
    const c = {};
    for (const s of splits) c[s] = splitFitness(sub.filter(r => r.split === s));
    const gi = +(c.tune.fitness - base.tune.fitness).toFixed(1);
    const Ri = +Math.max(0, base.heldout.fitness - c.heldout.fitness).toFixed(1);
    return gi > 0 && Ri <= DELTA;
  });
  const flips = loo.filter(v => v !== admit).length;
  const jkT = cur.tune.jackknife, jkH = cur.heldout.jackknife;
  console.log('PRESERVE-AND-EXTEND GATE   admit iff g(tune) > 0  AND  R(heldout) ≤ δ   (δ = ' + DELTA + ')');
  console.log('─'.repeat(72));
  console.log(`  tune fitness    : ${base.tune.fitness}  →  ${cur.tune.fitness}   g = ${g > 0 ? '+' : ''}${g}`);
  console.log(`  heldout fitness : ${base.heldout.fitness}  →  ${cur.heldout.fitness}   R = ${R}`);
  console.log(`  jackknife band  : tune fitness ∈ [${jkT.defined ? `${jkT.fitMin}, ${jkT.fitMax}` : jkT.note}]  ·  heldout ∈ [${jkH.defined ? `${jkH.fitMin}, ${jkH.fitMax}` : jkH.note}]  (coverage-limited, not a CI)`);
  console.log(`  verdict         : ${flips === 0 ? 'STABLE — no single passage drop flips it' : `⚠ FRAGILE — ${flips}/${scored.length} single-passage drops flip the verdict (decide at larger n)`}`);
  console.log('─'.repeat(72));
  if (admit) {
    console.log('  → ADMIT: the guard change improves tune without over-budget held-out regression.');
  } else {
    const why = g <= 0 ? `g=${g} ≤ 0 (no net gain on tune)` : `R=${R} > δ=${DELTA} (held-out regressed — overfit)`;
    console.log(`  → REJECT: ${why}`);
  }
  process.exit(admit ? 0 : 1);
}

// ── default: print the scorecard ─────────────────────────────────────────────────────────────────
if (flag('--json')) {
  console.log(JSON.stringify({ passages: scored.map(({ text, note, ...r }) => r), splits: scorecard.splits }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log('HARNESS VOICE-GUARD EVAL  ·  verifier = aiscore.mjs + voice overlay');
console.log('═'.repeat(72));
console.log(pad('passage', 22) + pad('split', 9) + pad('label', 7) + padL('aiScore', 9) + padL('hardBans', 10) + padL('badness', 9));
console.log('─'.repeat(72));
for (const r of scored) {
  console.log(pad(r.id, 22) + pad(r.split, 9) + pad(r.label, 7) + padL(r.aiScore, 9) + padL(r.hardBans, 10) + padL(r.badness, 9));
}
console.log('═'.repeat(72));
console.log('PER-SPLIT FITNESS  (separation = mean_ai − mean_human aiScore; higher = better guard)');
console.log('─'.repeat(72));
console.log(pad('split', 10) + padL('mean_human', 12) + padL('mean_ai', 9) + padL('separation', 12) +
  padL('falseHB', 9) + padL('aiCaught', 10) + padL('FITNESS', 9));
for (const s of splits) {
  const f = scorecard.splits[s];
  console.log(pad(s, 10) + padL(f.meanHuman, 12) + padL(f.meanAi, 9) + padL(f.separation, 12) +
    padL(f.falseHardBans, 9) + padL(`${f.aiCaught}/${f.nAi}`, 10) + padL(f.fitness, 9));
}
console.log('─'.repeat(72));
console.log('JACKKNIFE (leave-one-out band — coverage-limited at this n, NOT a confidence interval)');
for (const s of splits) {
  const j = scorecard.splits[s].jackknife;
  console.log(pad('  ' + s, 12) + (j.defined
    ? `separation ∈ [${j.sepMin}, ${j.sepMax}]   fitness ∈ [${j.fitMin}, ${j.fitMax}]`
    : `band undefined — ${j.note}`));
}
console.log('─'.repeat(72));
console.log('save a baseline:  node harness-eval.mjs --save baseline.json');
console.log('gate a change:    node harness-eval.mjs --gate baseline.json   (exit 1 = REJECT)');
