#!/usr/bin/env node
// mk-rerank.mjs — a VERA-style LLM RE-RANKER (a substitute for the
// paper's pre-trained cross-encoder — a different mechanism reaching a similar goal, labeled as such).
// Input JSON {query, chunks:[{id,text}]} in the retriever's ORIGINAL order. To avoid an LLM grading
// its own work, relevance is judged by a DIFFERENT model (grok-4.6) as an independent oracle, and
// the RE-RANK is done by Gemini. Reports precision@5 original-order vs re-ranked-order under the
// independent oracle. Read-only. Sends chunk text to the model providers configured in ../llm.mjs, so use
// non-confidential product or documentation content only.
import { readFileSync } from 'node:fs';
import { llm } from '../llm.mjs';

const { query, chunks } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const N = chunks.length;

const main = async () => {
  // 1) independent relevance oracle (grok) — judge each chunk 1/0, blind to rank
  const rel = [];
  for (const c of chunks) {
    const r = await llm(`Is this documentation chunk RELEVANT to answering the query? Reply with exactly 1 (relevant) or 0 (not).\nQuery: ${query}\nChunk: ${(c.text || '').slice(0, 700)}`, { provider: 'grok', max: 8 });
    rel.push(/1/.test(r) && !/^0/.test(r.trim()) ? 1 : 0);
  }
  // 2) Gemini re-ranks by relevance
  const listing = chunks.map((c, i) => `[${i + 1}] ${(c.text || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const rr = await llm(`Reorder these ${N} chunks by relevance to the query, most relevant first. Return ONLY the numbers, comma-separated.\nQuery: ${query}\n${listing}`, { max: 512, model: 'gemini-3.8-flash' });
  let order = [...new Set((rr.match(/\d+/g) || []).map((x) => +x - 1).filter((i) => i >= 0 && i < N))];
  for (let i = 0; i < N; i++) if (!order.includes(i)) order.push(i); // append any missed, preserving

  const p5 = (idxs) => idxs.slice(0, 5).reduce((s, i) => s + (rel[i] || 0), 0) / 5;
  const origP5 = p5([...Array(N).keys()]);
  const rrP5 = p5(order);
  console.log(`mk-rerank — query: "${query}"`);
  console.log(`  ${N} chunks retrieved · independent oracle (grok-4.6) marked ${rel.reduce((a, b) => a + b, 0)} relevant`);
  console.log(`  precision@5  original-order=${origP5.toFixed(2)}   Gemini-reranked=${rrP5.toFixed(2)}   delta=${(rrP5 - origP5 >= 0 ? '+' : '') + (rrP5 - origP5).toFixed(2)}`);
  console.log(`  original rel@rank: ${[...Array(N).keys()].map((i) => rel[i]).join('')}   reranked: ${order.map((i) => rel[i]).join('')}`);
  console.log(`  Faithful-scope: LLM re-ranker, NOT the paper's pre-trained cross-encoder — same goal, different mechanism.`);
};
main().catch((e) => { console.error(String(e)); process.exit(1); });
