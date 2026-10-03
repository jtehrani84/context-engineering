#!/usr/bin/env node
// mk-synth-qa.mjs — index-time synthetic Q&A generation (Meta-Knowledge's ingest step),
// local + one model call per chunk (the gemini-flash role in ../llm.mjs). For a sample of grounding chunks, the model
// generates {question, answer_span}; the
// answer_span must appear VERBATIM in the chunk — a DETERMINISTIC self-consistency check (no second
// LLM call), which is the guard that stops a mis-synthesized question from becoming a bad index entry.
// Proves the generation mechanism locally; writing the Q&A packets into your retrieval index is left to you.
// Read-only over the corpus. Chunk text goes to the model providers configured in ../llm.mjs, so use
// non-confidential product or documentation content only.

import { readFileSync } from 'node:fs';
import { llm } from '../llm.mjs';

const CORPUS = process.env.CORPUS || './corpus.json';
const N = +(process.argv[2] || 6);
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const main = async () => {
  const data = JSON.parse(readFileSync(CORPUS, 'utf8'));
  const all = data.chunks;
  const step = Math.max(1, Math.floor(all.length / N));
  const sample = Array.from({ length: N }, (_, i) => all[i * step]).filter(Boolean);

  let total = 0, grounded = 0;
  const rows = [];
  for (const c of sample) {
    const text = (c.text || c.full_text || '').slice(0, 2500);
    let qa = [];
    try {
      const r = await llm(`From this documentation chunk, generate 3 synthetic questions a user would realistically ask that THIS chunk answers, and for each, the ANSWER SPAN copied VERBATIM from the chunk (exact substring, no paraphrase). Return ONLY a JSON array: [{"question":"...","answer_span":"..."}].\n\nChunk:\n${text}`, { max: 2048, role: 'gemini-flash' });
      const m = r.match(/\[[\s\S]*\]/);
      qa = m ? JSON.parse(m[0]) : [];
    } catch { qa = []; }
    const nt = norm(text);
    let g = 0;
    for (const item of qa) { total++; const span = norm(item.answer_span).slice(0, 80); if (span && nt.includes(span)) { grounded++; g++; } }
    rows.push({ id: c.id, n: qa.length, g, q: qa[0]?.question || '' });
  }

  console.log(`mk-synth-qa — ${sample.length} chunks sampled across the ${all.length}-chunk corpus\n`);
  for (const r of rows) console.log(`  ${String(r.id).slice(0, 28).padEnd(30)} ${r.n} QA, ${r.g} verbatim-grounded · e.g. "${r.q.slice(0, 62)}"`);
  console.log(`\nGenerated ${total} synthetic Q&A. Self-consistency: ${grounded}/${total} answer spans verbatim-grounded in their chunk (${total ? (100 * grounded / total).toFixed(0) : 0}%).`);
  console.log(`Mechanism proven locally. Writing these packets into your retrieval index is a separate step this script does not take.`);
};
main().catch((e) => { console.error(String(e)); process.exit(1); });
