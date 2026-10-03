// model-roster.drift.test.mjs — tools/model-roster.mjs is a vendored copy of the resolver, kept byte-identical to the
// upstream copy it came from so there is one implementation. model-roster.vendor.json records the sha256 it had when
// it was vendored; this test fails when the file was edited here. tools/model-roster.json is NOT vendored: it is this
// kit's own role list and patterns, and yours to edit. With MODEL_ROSTER_CANONICAL_DIR pointing at an upstream
// checkout, the test also fails when upstream has moved on and this copy needs re-vendoring; without it, that part is
// skipped. Run: node --test model-roster.drift.test.mjs   (local only, no model, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const manifestPath = join(HERE, 'model-roster.vendor.json');
const manifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));

test('the vendor manifest exists and names the vendored resolver only', () => {
  assert.ok(existsSync(manifestPath), 'model-roster.vendor.json is missing');
  const m = manifest();
  assert.deepEqual(Object.keys(m.files), ['model-roster.mjs']);
  assert.match(m.files['model-roster.mjs'], /^[0-9a-f]{64}$/);
  assert.match(m.canonicalCommit, /^[0-9a-f]{7,40}$/);
});

test('the vendored resolver matches the hash recorded when it was vendored (no local edits)', () => {
  const m = manifest();
  for (const [f, h] of Object.entries(m.files)) assert.equal(sha(join(HERE, f)), h, `${f} was edited here; change the upstream copy and re-vendor instead`);
});

test('the role list is the kit\'s own file and loads', () => {
  const r = JSON.parse(readFileSync(join(HERE, 'model-roster.json'), 'utf8'));
  assert.equal(r.schema, 'model-roster.v1');
  assert.ok(Object.keys(r.roles).length > 0);
});

test('upstream has not moved on (skipped unless MODEL_ROSTER_CANONICAL_DIR is set)', (t) => {
  const dir = process.env.MODEL_ROSTER_CANONICAL_DIR;
  if (!dir) { t.skip('MODEL_ROSTER_CANONICAL_DIR not set'); return; }
  const m = manifest();
  for (const [f, h] of Object.entries(m.files)) assert.equal(sha(join(dir, f)), h, `upstream ${f} changed; copy it here byte-identical and update model-roster.vendor.json`);
});
