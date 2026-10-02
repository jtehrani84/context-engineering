// reducer.test.mjs — proof the Evidence-Preserving Reducer reduces, verifies, and FAILS correctly.
import assert from 'node:assert';
import { reduce, verify, applyReducer } from './reducer.mjs';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}: ${e.message}`); } }

// 1. below threshold → bypass, original returned unchanged, zero claimed savings
t('below threshold → bypass unchanged, 0% savings', () => {
  const small = 'ok\n'.repeat(20);
  const r = applyReducer(small);
  assert.equal(r.reduced, false);
  assert.equal(r.output, small);
  assert.equal(r.savings.pct, 0);
});

// 2. large noisy log with one error → reduced, verified, real savings, error line preserved VERBATIM
t('large log → reduced + verified + error line preserved verbatim', () => {
  const noise = 'compiling module '.padEnd(80, '.') + '\n';
  const big = noise.repeat(400) + 'ERROR: assertion failed at foo.js:42 expected 3 got 4\n' + noise.repeat(400);
  const r = applyReducer(big);
  assert.equal(r.reduced, true, 'should reduce');
  assert.equal(r.verified, true, 'should verify');
  assert.ok(r.savings.pct > 0, 'positive measured savings');
  assert.ok(r.output.includes('ERROR: assertion failed at foo.js:42 expected 3 got 4'), 'error line preserved verbatim');
});

// 3. verifier REJECTS a receipt with a quote that isn't in the source (the gate can fail)
t('verifier rejects a fabricated quote', () => {
  const big = 'x\n'.repeat(3000);
  const receipt = reduce(big);
  receipt.quotes.push('THIS LINE WAS NEVER IN THE LOG');
  const v = verify(receipt, big);
  assert.equal(v.ok, false);
  assert.match(v.reason, /quote not in source/);
});

// 4. verifier REJECTS a source-hash mismatch
t('verifier rejects hash mismatch', () => {
  const big = 'y\n'.repeat(3000);
  const receipt = reduce(big);
  const v = verify(receipt, big + 'tampered');
  assert.equal(v.ok, false);
  assert.match(v.reason, /hash mismatch/);
});

// 5. faithfulness: a reduced result NEVER claims a saving it can't back — savings are real or it falls back
t('never claims false savings — reduced ⇒ real positive, else fallback with 0', () => {
  let s = ''; for (let i = 0; i < 600; i++) s += `ERROR unique failure number ${i} at line ${i}\n`;
  const r = applyReducer(s);
  if (r.reduced) { assert.ok(r.savings.pct > 0); assert.ok(r.savings.outBytes < r.savings.origBytes); }
  else { assert.equal(r.savings.pct, 0); assert.equal(r.output, s); }
});

// 6. a reduced output always carries the retrieval handle (full log recoverable by hash)
t('reduced output carries the source hash for retrieval', () => {
  const big = 'noise line here\n'.repeat(500);
  const r = applyReducer(big);
  if (r.reduced) assert.match(r.output, /evidence-receipt sha=[0-9a-f]{16}/);
});

console.log(`reducer.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
