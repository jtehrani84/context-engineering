#!/usr/bin/env node
// mk-rewrite.mjs — Meta-Knowledge query rewrite (retrieval-time, embed-free). Decomposes a
// broad/multi-concept query into focused sub-queries via Gemini, to improve retrieval coverage.
// Prints the sub-queries (one per line); the caller runs each through its own retriever and unions
// the hits. No re-indexing needed, because this is a query-time transform. The query goes to the model
// providers configured in ../llm.mjs, so keep it free of confidential content.
import { llm } from '../llm.mjs';
const q = process.argv.slice(2).join(' ').trim() || 'How does our product compare to competitors?';
const out = await llm(
  `A user asked a broad, multi-concept documentation search query. Decompose it into 2-4 FOCUSED sub-queries that each target ONE retrievable concept/entity, so a retriever can find the specific chunks the broad query would blur together. Return ONLY the sub-queries, one per line, no numbering.\nQuery: ${q}`,
  { max: 512, model: 'gemini-3.8-flash' });
console.log(out.trim());
