// samples.mjs: read a person's writing samples and split them into tune and held-out sets.
//
// Samples are files in one folder (not recursive), or text on stdin cut at separator lines. They are read
// locally and held in memory. Nothing here writes them anywhere or prints them.
//
// The split is by content hash, so it doesn't depend on file names or order and both tools (profile-build and
// calibrate-user) compute the same split from the same files: samples are ranked by the sha256 of their text and
// the first round(n * share) (at least one) are held out. The fingerprint is a hash of the held-out hashes, so a
// later run can tell that the sample set changed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export const SAMPLE_EXT = ['.txt', '.md', '.mdx', '.markdown', '.text'];
export const DEFAULT_SEP = '---8<---';
export const MIN_WORDS = 3;
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const wordCount = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).length;

function finish(items) {
  const kept = [], skipped = [];
  for (const it of items) {
    const text = it.text.replace(/\r\n?/g, '\n').trim();
    if (wordCount(text) < MIN_WORDS) { skipped.push(it.file); continue; }
    kept.push({ ...it, text, sha: sha256(text), words: wordCount(text) });
  }
  // de-duplicate identical samples (same text twice would sit in both splits)
  const seen = new Set(), unique = [];
  for (const s of kept) { if (seen.has(s.sha)) { skipped.push(s.file); continue; } seen.add(s.sha); unique.push(s); }
  unique.forEach((s, i) => { s.id = `s${String(i + 1).padStart(2, '0')}`; });
  return { samples: unique, skipped };
}

export function readSamplesDir(dir) {
  const st = statSync(dir); // throws a clear ENOENT for a missing folder
  if (!st.isDirectory()) throw new Error(`${dir} is not a folder`);
  const files = readdirSync(dir).filter((f) => SAMPLE_EXT.includes(extname(f).toLowerCase()) && !f.startsWith('.')).sort();
  return finish(files.map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') })));
}

export function readSamplesText(text, sep = DEFAULT_SEP) {
  const parts = text.split(/\r?\n/).reduce((acc, line) => {
    if (line.trim() === sep) acc.push([]); else acc[acc.length - 1].push(line);
    return acc;
  }, [[]]);
  return finish(parts.map((lines, i) => ({ file: `stdin#${i + 1}`, text: lines.join('\n') })));
}

export function splitSamples(samples, share = 0.3) {
  const ranked = [...samples].sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const k = samples.length < 2 ? 0 : Math.min(samples.length - 1, Math.max(1, Math.round(samples.length * share)));
  const held = new Set(ranked.slice(0, k).map((s) => s.sha));
  const heldOut = samples.filter((s) => held.has(s.sha));
  const tune = samples.filter((s) => !held.has(s.sha));
  const fingerprint = sha256([...held].sort().join('\n')).slice(0, 16);
  return { tune, heldOut, fingerprint, share };
}
