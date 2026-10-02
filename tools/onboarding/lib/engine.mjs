// engine.mjs: find and run the installed voice engine (aiscore.mjs, text-normalize.mjs, prose-gate.mjs, the detector),
// load a personal overlay whichever interface it uses, and build a temporary engine copy that reads a given overlay.
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, copyFileSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { childEnv } from './local-only.mjs';

const ONBOARDING = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN_PATH = join(ONBOARDING, 'detector-pin.json');
export const fileSha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

export function enginePaths(toolsDir, env = process.env) {
  return {
    toolsDir,
    aiscore: join(toolsDir, 'aiscore.mjs'),
    normalizer: join(toolsDir, 'text-normalize.mjs'),
    gate: join(toolsDir, 'prose-gate.mjs'),
    evidence: join(toolsDir, 'ai-evidence.mjs'),
    fpBudget: join(toolsDir, 'calibration', 'human-fp-budget.json'),
    // aiscore.mjs resolves the detector the same way: AVOID_AI_DETECTOR, else ./avoid-ai-writing/detector/patterns.js
    detector: env.AVOID_AI_DETECTOR ? resolve(env.AVOID_AI_DETECTOR) : join(toolsDir, 'avoid-ai-writing', 'detector', 'patterns.js'),
  };
}

// The detector pin: the upstream commit every calibration number was measured on, and the sha256 of its
// detector/patterns.js (for a vendored copy, which has no git history of its own).
export const readPin = () => JSON.parse(readFileSync(PIN_PATH, 'utf8'));

// The detector at `patternsPath` against the pin: { ok, how, head, sha, want, problems }. A git checkout must be at the
// pinned commit AND its detector/patterns.js must hash to the pinned bytes (an edited file at the right commit is not
// the tested detector). A vendored copy, which has no git history of its own, is checked by the hash alone.
export function checkDetectorPin(patternsPath, pin = readPin()) {
  const repo = resolve(dirname(patternsPath), '..');
  let head = null;
  try {
    const top = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (realOr(top) === realOr(repo)) head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not a git checkout, or git missing: the file hash decides */ }
  const sha = fileSha256(patternsPath);
  const problems = [];
  if (head && head !== pin.commit) problems.push(`checkout is at ${head.slice(0, 7)}, the tested commit is ${pin.commit.slice(0, 7)}`);
  if (sha !== pin.patternsSha256) problems.push(`detector/patterns.js sha256 is ${sha.slice(0, 12)}, the tested file is ${pin.patternsSha256.slice(0, 12)}`);
  return { ok: !problems.length, how: head ? 'git commit and file sha256' : 'file sha256 (vendored copy)', head, sha, want: { commit: pin.commit, sha256: pin.patternsSha256 }, problems };
}

// Run `node script args` with input on stdin, inside the local-only guard. Never throws.
export function runNode(script, args = [], input = '', { timeout = 60000, env = process.env, local = true } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    input, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, env: local ? childEnv(env) : env,
  });
  return { code: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT', error: r.error };
}

// The overlay issues in an aiscore JSON result. Engines put them under `voice` or under an older per-person key.
export function overlayIssuesOf(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.voice && Array.isArray(json.voice.issues)) return json.voice.issues;
  for (const [k, v] of Object.entries(json)) if (/Voice$/.test(k) && v && Array.isArray(v.issues)) return v.issues;
  return null;
}

// Score text with the engine's CLI. Returns { ok, json, issues, error }.
export function runScorer(paths, text, { env = process.env, timeout = 60000 } = {}) {
  if (!existsSync(paths.aiscore)) return { ok: false, error: `no scorer at ${paths.aiscore}` };
  const r = runNode(paths.aiscore, ['-', '--json'], text, { env, timeout });
  if (r.timedOut) return { ok: false, error: `scorer timed out after ${timeout} ms` };
  if (r.code !== 0) return { ok: false, error: `scorer exited ${r.code ?? r.signal}: ${lastLine(r.stderr)}` };
  const line = r.stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  let json;
  try { json = JSON.parse(line); } catch { return { ok: false, error: 'scorer printed no JSON' }; }
  if (typeof json.score !== 'number') return { ok: false, error: 'scorer JSON has no numeric score' };
  const issues = overlayIssuesOf(json);
  if (!issues) return { ok: false, error: 'scorer JSON has no overlay issues list' };
  return { ok: true, json, issues };
}
export const lastLine = (s) => (String(s || '').trim().split('\n').filter((l) => /Error|error|failed/.test(l)).pop() || String(s || '').trim().split('\n').pop() || '').slice(0, 160);

// Load the detector module directly (it is local, MIT-licensed code). Returns null if it can't be loaded.
export function loadDetector(paths) {
  try { return createRequire(import.meta.url)(paths.detector); } catch { return null; }
}

// ── overlays ──────────────────────────────────────────────────────────────────────────────────────────
// Two interfaces exist. The kit interface exports scanVoice, hardBanCount, cadenceCount and CALIBRATED. Older
// per-person overlays export scan<Name>Voice, <name>HardBanCount and <name>CadenceCount. loadOverlay accepts either.
const pickExport = (mod, exact, rx) => (typeof mod[exact] === 'function' ? mod[exact] : Object.entries(mod).find(([k, v]) => rx.test(k) && typeof v === 'function')?.[1]);

export async function loadOverlay(path) {
  if (!path || !existsSync(path)) return { ok: false, error: `no overlay at ${path}` };
  let mod;
  try { mod = await import(`${pathToFileURL(path).href}?v=${fileSha256(path).slice(0, 12)}`); }
  catch (e) { return { ok: false, error: `overlay doesn't load: ${String(e.message || e).split('\n')[0].slice(0, 200)}` }; }
  const scan = pickExport(mod, 'scanVoice', /^scan\w*Voice$/);
  const hard = pickExport(mod, 'hardBanCount', /HardBanCount$/);
  const cad = pickExport(mod, 'cadenceCount', /CadenceCount$/);
  if (!scan || !hard || !cad) return { ok: false, error: 'overlay is missing scanVoice, hardBanCount or cadenceCount', mod };
  return {
    ok: true, mod, scan, hardBanCount: hard, cadenceCount: cad,
    iface: typeof mod.scanVoice === 'function' ? 'kit' : 'legacy',
    reviewed: mod.REVIEWED === undefined ? null : mod.REVIEWED === true,
    calibrated: mod.CALIBRATED === undefined ? null : !!mod.CALIBRATED,
    probe: typeof mod.PROBE === 'string' ? mod.PROBE : null,
    prefix: typeof mod.ISSUE_PREFIX === 'string' ? mod.ISSUE_PREFIX : null,
    approvedLines: Array.isArray(mod.APPROVED_LINES) ? mod.APPROVED_LINES : Array.isArray(mod.EXEMPTIONS) ? mod.EXEMPTIONS : null,
    sha256: fileSha256(path), path,
  };
}

// The engine's own modules: the files in toolsDir that the scorer, the gate and the normalizer load, followed through
// their relative imports (static, dynamic and require). Only these are copied into an engine copy, so other tools that
// share the folder never are. Returns basenames.
export const ENGINE_ENTRIES = ['aiscore.mjs', 'prose-gate.mjs', 'text-normalize.mjs'];
export function engineModules(toolsDir) {
  const seen = new Set(), queue = ENGINE_ENTRIES.filter((f) => existsSync(join(toolsDir, f)));
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    // An overlay module is listed, but its own imports are not followed: in the voice-system repo voice-overlay.mjs
    // re-exports the owner's overlay, which must never be copied into an engine copy or an install.
    if (/overlay/.test(f) && !ENGINE_ENTRIES.includes(f)) continue;
    let src = '';
    try { src = readFileSync(join(toolsDir, f), 'utf8'); } catch { continue; }
    const rx = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]\.\/([^'"/]+\.(?:mjs|js|cjs))['"]/gm;
    for (const m of src.matchAll(rx)) if (!seen.has(m[1]) && existsSync(join(toolsDir, m[1]))) queue.push(m[1]);
  }
  return [...seen];
}

// The engine modules that import an overlay, and the names they import: [{ file, spec, names }].
export function overlayImports(toolsDir) {
  const out = [];
  for (const f of engineModules(toolsDir)) {
    const src = readFileSync(join(toolsDir, f), 'utf8');
    for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"](\.\/[^'"]*overlay[^'"]*\.mjs)['"]/gim)) {
      out.push({ file: f, spec: m[2], names: m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) });
    }
  }
  return out;
}

// Build a temporary copy of the engine whose overlay import resolves to `overlayPath`. The engine's own modules are
// copied (a symlinked module would resolve its imports from the real folder), the detector and the calibration
// folder are linked, and each overlay module the engine imports becomes a small shim that re-exports the given
// overlay under the names the engine asks for; the engine's own overlay file is never copied. Returns
// { dir, cleanup }. With `into`, the copy is built in that (existing) folder instead of a new temporary one, and
// cleanup leaves the folder alone.
export function buildEngineWithOverlay(toolsDir, overlayPath, { into = null } = {}) {
  const dir = into || mkdtempSync(join(tmpdir(), 'voice-engine-'));
  const target = realOr(overlayPath);
  const isOverlay = (p) => realOr(p) === target;
  const byModule = new Map();
  for (const imp of overlayImports(toolsDir)) {
    const set = byModule.get(imp.spec) || new Set();
    imp.names.forEach((n) => set.add(n));
    byModule.set(imp.spec, set);
  }
  const shims = new Set([...byModule.keys()].map((spec) => basename(spec)));
  for (const f of engineModules(toolsDir)) {
    if (shims.has(f) || isOverlay(join(dir, f))) continue; // overlay files become shims; never overwrite the overlay under test
    copyFileSync(join(toolsDir, f), join(dir, f));
  }
  for (const d of ['avoid-ai-writing', 'calibration']) {
    const src = join(toolsDir, d);
    if (existsSync(src) && statSync(src).isDirectory() && !existsSync(join(dir, d))) symlinkSync(realOr(src), join(dir, d));
  }
  // A relative import when the overlay sits in the copy itself, so the folder still works after it is moved.
  const url = realOr(dirname(resolve(overlayPath))) === realOr(dir) ? `./${basename(overlayPath)}` : pathToFileURL(resolve(overlayPath)).href;
  const generic = (n) => (/^scan\w*Voice$/.test(n) ? 'scanVoice' : /HardBanCount$/.test(n) ? 'hardBanCount' : /CadenceCount$/.test(n) ? 'cadenceCount' : n);
  for (const [spec, names] of byModule) {
    if (isOverlay(join(dir, basename(spec)))) continue; // the engine imports the overlay under test directly
    const lines = [
      '// Generated by onboarding/lib/engine.mjs for an engine copy. Re-exports the overlay under test under the names',
      '// this engine imports.',
      `import * as O from ${JSON.stringify(url)};`,
    ];
    for (const n of names) {
      const g = generic(n);
      const fallback = n === 'VERDICT_STRUCT_TYPES' ? '[]' : 'undefined';
      lines.push(`export const ${n} = O[${JSON.stringify(n)}] ?? O[${JSON.stringify(g)}] ?? ${fallback};`);
    }
    if (!names.has('scanVoice')) lines.push('export const scanVoice = O.scanVoice;');
    writeFileSync(join(dir, basename(spec)), lines.join('\n') + '\n');
  }
  return { dir, cleanup: into ? () => {} : () => rmSync(dir, { recursive: true, force: true }) };
}

// Does the engine at toolsDir already load overlayPath directly (no shim needed)?
export function engineLoadsOverlay(toolsDir, overlayPath) {
  const want = realOr(overlayPath);
  return overlayImports(toolsDir).some((imp) => realOr(join(toolsDir, imp.spec)) === want);
}
