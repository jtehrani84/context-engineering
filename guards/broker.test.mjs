#!/usr/bin/env node
/**
 * broker.test.mjs — proof for the model-boundary token broker + leak canary. Exit 1 on fail.
 * Includes the 3 adversarial-review regressions: equivalent-form leak, registration-order
 * fragmentation, and handle-interior re-tokenization.
 */
import { openBroker } from './broker.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

const KEY = 'trusted-connector-key';
const b = openBroker('run-1', { key: KEY });
const CANARY = 'CANARY-Acme-Corp-9f3a';
b.register(CANARY, { field: 'account.name', dataClass: 'tier0' });
b.register('FAKEID000000000000', { field: 'account.id', dataClass: 'tier0' }); // 18-char SF id

const rawToolResult = `Account ${CANARY} (id FAKEID000000000000) has 3 open opps.`;
const modelVisible = b.tokenize(rawToolResult, { destination: 'vendor-a' });
ok(!modelVisible.includes(CANARY) && !modelVisible.includes('FAKEID000000000000'), 'raw values not in tokenized text');
ok(b.scanForLeak(modelVisible).clean, 'leak scan: tokenized text is clean');
ok(!b.scanForLeak(rawToolResult).clean, 'leak scan: raw text flagged as leak');

// restoration only in the trusted connector
const restored = b.detokenize(modelVisible, KEY);
ok(restored.ok && restored.text === rawToolResult, 'trusted connector restores original');
ok(!b.detokenize(modelVisible, 'wrong').ok, 'model process (wrong key) cannot detokenize');

// --- regression 1: equivalent-form leak (15-char SF id, case, unicode) ---
ok(!b.scanForLeak('leaked id FAKEID000000000 here').clean, 'leak scan catches the 15-char SF id form (equivalent-form leak)');
ok(!b.scanForLeak('account canary-acme-corp-9f3a lowercased').clean, 'leak scan catches a case variant (canonical)');
ok(!b.scanForLeak('id FAKEID000000000​foo').clean, 'leak scan catches a zero-width-split variant');

// --- regression 2: registration-order fragmentation (substring registered first) ---
{
  const b2 = openBroker('run-2', { key: KEY });
  b2.register('Acme-Corp');                 // shorter, registered FIRST
  b2.register('CANARY-Acme-Corp-9f3a');     // longer superstring (canary)
  const tk = b2.tokenize('Account CANARY-Acme-Corp-9f3a flagged.');
  ok(!tk.includes('CANARY-') && !tk.includes('-9f3a'), 'longest-first: canary is tokenized whole, no raw fragment egresses');
  ok(b2.scanForLeak(tk).clean, 'fragmentation regression: leak scan clean after longest-first tokenize');
}

// --- regression 3: value that is a substring of a handle must not corrupt tokenize/detokenize ---
{
  const b3 = openBroker('run-1', { key: KEY }); // runId contains '1'
  b3.register('Acme');
  b3.register('1');                              // '1' is a substring of the handle ⟦H:run-1#N⟧
  const tk = b3.tokenize('Acme visited on day 1');
  const back = b3.detokenize(tk, KEY);
  ok(back.ok && back.text === 'Acme visited on day 1', 'handle-substring: round-trips cleanly (no corruption)');
}

// detokenize refuses unknown/nested handles (integrity)
ok(!b.detokenize('see ⟦H:other-run#1⟧ here', KEY).ok, 'unknown handle -> detokenize ok:false (integrity)');
const b4 = openBroker('run-4', {});
ok(!b4.detokenize('⟦H:run-4#1⟧', 'anything').ok, 'broker without a key cannot detokenize (fail-closed)');

console.log(`broker.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
