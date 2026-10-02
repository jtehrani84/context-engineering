#!/usr/bin/env node
// echo-verify-corpus.mjs — how self-verifiable is a folder of memory/notes files? Read-only; it never
// writes or runs anything it finds. Applies two published mechanisms (VERA, arXiv:2409.03759; ECHO,
// arXiv:2510.04886) to the corpus's self-verifiability:
//   VERA (contribution #2): a bootstrap 95% CI on the corpus verify-COVERAGE rate (fraction of
//     memos that carry a re-verify recipe) — makes "how self-verifiable is the corpus" a BOUNDED
//     number, not a point estimate.
//   ECHO (error attribution): rank the weakest memos (unanchored, then stale) as the attributed
//     sites to fix first — objective criteria + leveling by type.
//
// Scope (honest): this bounds verify-COVERAGE (does a memo have a re-verify recipe + a freshness
// stamp), computed from frontmatter. It does NOT run the recipes — verify-OUTCOMES (do they pass)
// is left out on purpose, because running a recipe executes an external command.
// Reproducible: seeded PRNG. Read-only; never writes.
//
// Usage: node echo-verify-corpus.mjs [corpus-dir]   (default: $CORPUS_DIR or ./corpus, a folder of .md docs)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STALE_DAYS = 120;      // a stamp older than this = stale
const B = 2000;              // bootstrap resamples
const SEED = 20260920;
const DEFAULT_DIR = process.env.CORPUS_DIR || './corpus';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pct = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r3 = (x) => Math.round(x * 1000) / 1000;

// crude frontmatter read (between the first two --- fences)
function frontmatter(text) {
  if (!text.startsWith('---')) return '';
  const end = text.indexOf('\n---', 3);
  return end < 0 ? '' : text.slice(0, end);
}

// parse a YYYY-MM-DD anywhere in a line; return age in days vs a FIXED reference (no Date.now for
// reproducibility — reference is the corpus's newest stamp, computed in a first pass)
function stampDate(fm) {
  const m = fm.match(/(?:last_verified|stamp)\s*:?\s*["']?(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function classify(fm, refMs) {
  const hasRecipe = /(?:^|\n)\s*reverify\s*:/.test(fm) || /reverify\.command/.test(fm) || /\n\s*command\s*:/.test(fm);
  const superseded = /version_state\s*:?\s*["']?superseded/.test(fm) || /superseded_by\s*:/.test(fm);
  const d = stampDate(fm);
  const hasStamp = d != null;
  let status;
  if (superseded) status = 'superseded';
  else if (!hasRecipe && !hasStamp) status = 'unanchored';
  else if (hasStamp && refMs != null && (refMs - d) / 86400000 > STALE_DAYS && !hasRecipe) status = 'stale';
  else status = 'current';
  const ageDays = d != null && refMs != null ? Math.round((refMs - d) / 86400000) : null;
  return { hasRecipe, hasStamp, superseded, status, ageDays };
}

const dir = process.argv[2] || DEFAULT_DIR;
const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
const memos = files.map((f) => {
  let text = '';
  try { text = readFileSync(join(dir, f), 'utf8'); } catch {}
  return { name: f.replace(/\.md$/, ''), fm: frontmatter(text) };
});
// reference stamp = newest stamp in the corpus (reproducible, no wall clock)
let refMs = null;
for (const m of memos) { const d = stampDate(m.fm); if (d != null && (refMs == null || d > refMs)) refMs = d; }
for (const m of memos) Object.assign(m, classify(m.fm, refMs));

const n = memos.length;
const census = { current: 0, unanchored: 0, stale: 0, superseded: 0 };
for (const m of memos) census[m.status]++;

// VERA bootstrap CI on verify-coverage (has-recipe rate)
const cov = memos.map((m) => (m.hasRecipe ? 1 : 0));
const rate = cov.reduce((a, b) => a + b, 0) / n;
const draws = [];
for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += cov[Math.floor(rand() * n)]; draws.push(s / n); }
draws.sort((a, b) => a - b);
const ci = [r3(pct(draws, 0.025)), r3(pct(draws, 0.975))];

// ECHO attribution: weakest sites first (unanchored, then stale by age)
const weak = memos
  .filter((m) => m.status === 'unanchored' || m.status === 'stale')
  .sort((a, b) => (a.status === b.status ? (b.ageDays || 0) - (a.ageDays || 0) : a.status === 'unanchored' ? -1 : 1));

console.log(`echo-verify-corpus — ${dir}`);
console.log(`memos: ${n}   (reference stamp = newest in corpus)\n`);
console.log(`DETECT census: current=${census.current} unanchored=${census.unanchored} stale=${census.stale} superseded=${census.superseded}`);
console.log(`\nVERA bound — verify-coverage (fraction with a re-verify recipe): ${r3(rate)}  95% CI [${ci[0]}, ${ci[1]}]  (n=${n}, B=${B}, seeded)`);
console.log(`  read as: a bounded measure of how self-verifiable the corpus is. Coverage-only — running the recipes (outcomes) is the gated extension.`);
console.log(`\nECHO attribution — weakest sites first (fix these to raise coverage): ${weak.length} memos`);
weak.slice(0, 15).forEach((m, i) => console.log(`  #${i + 1} [${m.status}]${m.ageDays != null ? ` ${m.ageDays}d` : ''}  ${m.name}`));
console.log(`\nsignal, not proof — coverage is frontmatter presence, not a passing re-verify run.`);
