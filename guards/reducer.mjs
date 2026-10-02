#!/usr/bin/env node
/**
 * reducer.mjs — Evidence-Preserving Reducer.
 *
 * Compresses a large build/test log into a compact, VERIFIED receipt (head + exact evidence lines + tail
 * + a retrieval handle), gated by a DETERMINISTIC verifier that falls back to the original on any failure.
 * No model call: pure deterministic extraction, so it is testable and safe to run on anything. (A cheap-
 * model variant, say a small model extracting evidence, is a later option; the verifier gate stays the same.)
 *
 * WHY IT FITS: cheap/deterministic work does the compression; a deterministic oracle GATES it or falls
 * back. Cheap can only mean "cheaper", never "wrong", because the verifier returns the original on failure.
 *
 * FAITHFULNESS GUARDRAIL: this reports the MEASURED saving on the ACTUAL input, computed before/after,
 * never a hardcoded or borrowed number. A saving measured on someone else's harness and benchmark is not
 * yours; measure your own.
 *
 * Usage:  node reducer.mjs <logfile>    -> the receipt + the measured saving on THIS input + the caveat
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const THRESHOLD = 4 * 1024;   // 4 KiB — below this, bypass unchanged
const HEAD = 8, TAIL = 8;     // verbatim head / tail lines
const EVIDENCE_CAP = 40;      // max exact evidence lines kept inline; full log retrievable by hash
const ERR_RE = /\b(error|fail(ed|ure|s)?|exception|assert\w*|traceback|panic|fatal|✗|✘|FAIL|\bE\d{2,}\b|exit(ed)?\s*(code\s*)?[1-9])/i;

function sha(s) { return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16); }

export function reduce(text, { threshold = THRESHOLD } = {}) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes < threshold) return { kind: 'bypass', reason: 'below threshold', originalSize: bytes };
  const lines = text.split('\n');
  const head = lines.slice(0, HEAD);
  const tail = lines.slice(-TAIL);
  const seen = new Set(); const quotes = [];
  for (const l of lines) {                         // exact-quote preservation of error/status lines
    if (!ERR_RE.test(l)) continue;
    const k = l.trim(); if (!k || seen.has(k)) continue;
    seen.add(k); quotes.push(l);
    if (quotes.length >= EVIDENCE_CAP) break;
  }
  return { kind: 'evidence-receipt', sourceHash: sha(text), originalSize: bytes, lineCount: lines.length, head, tail, quotes };
}

export function renderReceipt(r) {
  if (!r || r.kind !== 'evidence-receipt') return null;
  const L = [`⟦evidence-receipt sha=${r.sourceHash} orig=${r.originalSize}B lines=${r.lineCount}⟧`, '── head ──', ...r.head];
  if (r.quotes.length) { L.push(`── evidence (${r.quotes.length} exact lines) ──`, ...r.quotes); }
  L.push('── tail ──', ...r.tail, `⟦full log retrievable by sha ${r.sourceHash}⟧`);
  return L.join('\n');
}

/** DETERMINISTIC verifier — the oracle gate. Trust the receipt only if hash matches, every preserved line
 *  appears VERBATIM in the source, and the rendered receipt is actually smaller. Any failure → not ok. */
export function verify(receipt, original) {
  if (!receipt || receipt.kind !== 'evidence-receipt') return { ok: false, reason: 'no receipt (bypass)' };
  if (receipt.sourceHash !== sha(original)) return { ok: false, reason: 'source hash mismatch' };
  for (const q of [...receipt.head, ...receipt.quotes, ...receipt.tail]) {
    if (q !== '' && !original.includes(q)) return { ok: false, reason: `quote not in source: ${q.slice(0, 48)}` };
  }
  const outBytes = Buffer.byteLength(renderReceipt(receipt), 'utf8');
  if (outBytes >= receipt.originalSize) return { ok: false, reason: 'no size reduction' };
  return { ok: true, outBytes };
}

/** reduce → verify → fall back to the original on ANY failure. Returns the MEASURED saving, computed. */
export function applyReducer(text, opts = {}) {
  const origBytes = Buffer.byteLength(text, 'utf8');
  const receipt = reduce(text, opts);
  const v = verify(receipt, text);
  if (!v.ok) return { output: text, reduced: false, verified: false, reason: v.reason, savings: { origBytes, outBytes: origBytes, savedBytes: 0, pct: 0 } };
  return {
    output: renderReceipt(receipt), reduced: true, verified: true,
    savings: { origBytes, outBytes: v.outBytes, savedBytes: origBytes - v.outBytes, pct: +(100 * (origBytes - v.outBytes) / origBytes).toFixed(1) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = process.argv[2];
  if (!f) { console.error('usage: node reducer.mjs <logfile>'); process.exit(2); }
  const r = applyReducer(readFileSync(f, 'utf8'));
  const bar = '─'.repeat(66);
  console.log(bar);
  if (!r.reduced) console.log(`  reducer: NO reduction (${r.reason}) → original passed through unchanged (fallback).`);
  else { console.log(r.output); console.log(bar); console.log(`  MEASURED on THIS input: ${r.savings.origBytes}B → ${r.savings.outBytes}B  (${r.savings.pct}% smaller) · verified=${r.verified}`); }
  console.log(bar);
  console.log('  faithfulness: measured on THIS log, not a general claim. Measure yours; do not quote');
  console.log('  anyone else\'s number, and do not claim a compounding effect from one measurement.');
  console.log(bar);
}
