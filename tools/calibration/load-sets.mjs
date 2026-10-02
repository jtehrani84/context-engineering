// Shared loader for calibration/gate-eval.mjs: the labeled sets the deterministic gate is measured on in a starter-kit
// install. LOCAL ONLY: score these with aiscore or `prose-gate --det-only`; never send your samples to a judge, a model
// or any other tool, and never commit output that quotes them.
//   harness-eval  ../harness-evolution/corpus.json: the kit's generic seed corpus, or the corpus you replaced it with
//   self          your own writing samples, one .txt or .md file per piece: VOICE_SAMPLES, default the samples folder
//                 /voice-setup uses (${CLAUDE_CONFIG_DIR:-~/.claude}/voice/samples). Labeled human; ids are file names.
//   meta-doc      docs that discuss the tells (../rules/structural-voice.md, VOICE-SYSTEM.md); they quote tells on
//                 purpose, so they are not counted as human writing.
// A missing set is skipped.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { homedir } from 'node:os';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const SAMPLES = process.env.VOICE_SAMPLES || join(CLAUDE, 'voice', 'samples');
const SAMPLE_EXT = new Set(['.txt', '.md', '.mdx', '.markdown', '.text']);

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadSets() {
  const rows = [];
  const add = (set, label, id, text) => { if (text && text.trim()) rows.push({ set, label, id, text }); };
  const heval = join(ROOT, '..', 'harness-evolution', 'corpus.json');
  if (existsSync(heval)) for (const p of json(heval).passages || []) add('harness-eval', p.label === 'human' ? 'human' : 'ai', p.id, p.text);
  if (existsSync(SAMPLES)) for (const f of readdirSync(SAMPLES).filter((f) => SAMPLE_EXT.has(extname(f).toLowerCase())).sort())
    add('self', 'human-self', f, readFileSync(join(SAMPLES, f), 'utf8'));
  for (const [id, p] of [['structural-voice.md', join(ROOT, '..', 'rules', 'structural-voice.md')], ['VOICE-SYSTEM.md', join(ROOT, 'VOICE-SYSTEM.md')]])
    if (existsSync(p)) add('meta-doc', 'meta(mention)', id, readFileSync(p, 'utf8'));
  return rows;
}

export const isHuman = (label) => /human/.test(label);
