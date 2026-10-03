// main-guard.test.mjs — each guard's command line runs when it is started through a symlinked path.
// Found 2026-10-03: the CLIs compared import.meta.url with `file://${process.argv[1]}`, and argv[1] is the path as
// typed, so through a symlink (macOS /tmp is one, and so may be ~/.claude) the CLI silently did nothing and exited 0.
// Run: node main-guard.test.mjs   (local only, no network)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'main-guard-'));
const LINK = join(tmp, 'linked-guards');
symlinkSync(HERE, LINK);
const log = join(tmp, 'sample.log');
writeFileSync(log, Array.from({ length: 40 }, (_, i) => `line ${i} ok`).join('\n') + '\nERROR something failed\n');

let pass = 0, fail = 0;
const run = (file, args, expect) => {
  const r = spawnSync('node', [join(LINK, file), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, SCRUB_DENYLIST: join(tmp, 'none.json') } });
  const ok = expect.test(r.stdout + r.stderr);
  if (ok) pass++; else { fail++; console.log(`  ✗ ${file} through a symlinked path printed nothing useful (exit ${r.status}): ${JSON.stringify((r.stdout + r.stderr).slice(0, 200))}`); }
};
run('canary.mjs', [], /canary:/);
run('fuzz.mjs', [], /fuzz:/);
run('verifier.mjs', [], /verifier tiers/);
run('reducer.mjs', [log], /reducer|MEASURED|faithfulness/);
run('scrub.mjs', [HERE], /LEAK-SCAN GATE/);
// imported under `node -e` with the module's own path as argv[1] (the voice hook test scans with scrub.mjs this way):
// the CLI must not run, print a report and exit
for (const f of ['scrub.mjs', 'canary.mjs', 'reducer.mjs']) {
  const r = spawnSync('node', ['--input-type=module', '-e', "const s = await import(process.argv[1]); console.log('imported', Object.keys(s).length > 0);", join(HERE, f), HERE], { encoding: 'utf8', timeout: 60000 });
  if (r.status === 0 && /^imported true\s*$/.test(r.stdout)) pass++; else { fail++; console.log(`  ✗ ${f} imported under node -e ran its CLI (exit ${r.status}): ${JSON.stringify((r.stdout + r.stderr).slice(0, 200))}`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`main-guard.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
