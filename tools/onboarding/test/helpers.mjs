// helpers.mjs: throwaway installs for the onboarding tests.
//
// makeInstall() builds a temporary HOME whose ~/.claude looks like a kit install: tools/ holds a generic copy of the
// engine (the engine's own modules, with every overlay import pointed at a rendered template overlay, so no personal
// overlay is ever copied), tools/onboarding/ holds these tools, hooks/scripts/voice-tell-gate.py is the fake hook from
// fixtures/ (or another hook you pass), and settings.json wires it with the block voice-doctor --print-hooks prints.
// Every test runs the tools as child processes with a minimal environment (HOME, PATH, TMPDIR inside the install),
// so nothing reads or writes the real ~/.claude.
//
// This module must not import lib/engine.mjs, lib/hook.mjs or the tools themselves: they load lib/local-only.mjs,
// which turns off networking in the importing process, and some tests run a local sentinel server here.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, existsSync, readdirSync, lstatSync, readlinkSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderOverlay, newProbe } from '../lib/render.mjs';

export const ONBOARDING = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The engine the throwaway installs copy: this checkout's tools folder, or VOICE_ENGINE_SRC (for example a kit's
// tools/ folder, to test the onboarding tools against the engine that kit ships).
export const SRC_TOOLS = process.env.VOICE_ENGINE_SRC ? resolve(process.env.VOICE_ENGINE_SRC) : resolve(ONBOARDING, '..');
export const FIXTURES = join(ONBOARDING, 'test', 'fixtures');
export const FAKE_HOOK = join(FIXTURES, 'fake-voice-hook.py');
export const LOCAL_ONLY = join(ONBOARDING, 'lib', 'local-only.mjs');

const PYTHON = (() => {
  const r = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
})();
export const HAVE_PYTHON = !!PYTHON;

// A bin folder with node and (optionally) python3, so PATH can leave everything else out.
export function binDir(dir, { python = true } = {}) {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'node'))) symlinkSync(process.execPath, join(dir, 'node'));
  if (python && PYTHON && !existsSync(join(dir, 'python3'))) symlinkSync(PYTHON, join(dir, 'python3'));
  return dir;
}

// An executable stand-in for a command: logs its argv (one JSON line per call) to `log` and prints `stdout`.
export function stubCommand(path, log, stdout = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `#!${process.execPath}`,
    "const fs = require('fs');",
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(${JSON.stringify(stdout)});`,
    '',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };

// Write samples as s01.txt, s02.txt, ... and return the folder.
export function writeSamples(dir, texts, ext = '.txt') {
  mkdirSync(dir, { recursive: true });
  texts.forEach((t, i) => writeFileSync(join(dir, `s${String(i + 1).padStart(2, '0')}${ext}`), t));
  return dir;
}

// Run a node module from `cwd` with input on stdin. Never throws.
export function runNodeFile(file, args = [], { env, input = '', cwd, timeout = 180000 } = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { env, input, cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT' };
}

// Evaluate `expr` with `module` imported as M in a child process, and return the JSON it prints.
export function evalIn(module, expr, env = process.env) {
  const code = `import * as M from ${JSON.stringify(pathToFileURL(module).href)}; console.log(JSON.stringify(await (async () => (${expr}))()));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`evalIn ${module}: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// Render an overlay from the template. Reviewed unless told otherwise.
export function overlaySource(fields = {}) {
  return renderOverlay({ REVIEWED: true, PROBE: newProbe(), ...fields });
}
export const markReviewed = (path) => writeFileSync(path, readFileSync(path, 'utf8').replace('/*@REVIEWED*/false/*@END*/', '/*@REVIEWED*/true/*@END*/'));

// Build the generic engine copy in `tools`, reading the overlay at `overlay` (lib/engine.mjs buildEngineWithOverlay,
// run in a child so this process keeps its network).
function buildEngine(tools, overlay, env) {
  const code = `import { buildEngineWithOverlay } from ${JSON.stringify(pathToFileURL(join(ONBOARDING, 'lib', 'engine.mjs')).href)};
buildEngineWithOverlay(${JSON.stringify(SRC_TOOLS)}, ${JSON.stringify(overlay)}, { into: ${JSON.stringify(tools)} });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`building the engine copy failed: ${r.stderr}`);
}

// makeInstall(opts) -> an install object (see the header). Options:
//   overlay       overlay source text for tools/voice-overlay.mjs (default: a reviewed template overlay)
//   hook          hook script to install (default: fixtures/fake-voice-hook.py); null installs none
//   settings      settings.json content (object or string); default: the voice-doctor --print-hooks block
//   config        voice-config.json content (object or string) at ~/.claude/voice/voice-config.json; default: none
//   calibration   'copy' (default: human-fp-budget.json and public-corpora.sha256 copied) or 'none'
//   env           extra environment for every run
export function makeInstall(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'voice-ob-test-'));
  const home = join(root, 'home'), claude = join(home, '.claude'), tools = join(claude, 'tools'), voice = join(claude, 'voice');
  const tmp = join(root, 'tmp'), cwd = join(root, 'cwd');
  for (const d of [tools, voice, join(claude, 'hooks', 'scripts'), tmp, cwd]) mkdirSync(d, { recursive: true });
  const bin = binDir(join(root, 'bin'));
  const env = { HOME: home, PATH: [bin, '/usr/bin', '/bin'].join(':'), TMPDIR: tmp, LANG: 'en_US.UTF-8', ...(opts.env || {}) };

  if ((opts.calibration || 'copy') === 'copy') {
    mkdirSync(join(tools, 'calibration'));
    for (const f of ['human-fp-budget.json', 'public-corpora.sha256']) copyFileSync(join(SRC_TOOLS, 'calibration', f), join(tools, 'calibration', f));
  }
  const overlayPath = join(tools, 'voice-overlay.mjs');
  writeFileSync(overlayPath, opts.overlay ?? overlaySource());
  buildEngine(tools, overlayPath, env);
  cpSync(ONBOARDING, join(tools, 'onboarding'), { recursive: true, filter: (src) => { const r = relative(ONBOARDING, src); return r !== 'test' && !r.startsWith(`test${sep}`); } });

  const hookPath = join(claude, 'hooks', 'scripts', 'voice-tell-gate.py');
  if (opts.hook !== null) copyFileSync(opts.hook || FAKE_HOOK, hookPath);
  const inst = { root, home, claude, tools, voice, tmp, cwd, bin, env, overlayPath, hookPath, settingsPath: join(claude, 'settings.json'), configPath: join(voice, 'voice-config.json') };
  // Run one of the installed onboarding tools in this install.
  inst.run = (script, args = [], { env: extra = {}, input = '', cwd: dir = cwd, timeout } = {}) =>
    runNodeFile(join(tools, 'onboarding', script), args, { env: { ...env, ...extra }, input, cwd: dir, timeout });
  // voice-doctor --json: { code, json, byId }.
  inst.doctor = (args = [], o = {}) => {
    const r = inst.run('voice-doctor.mjs', ['--json', ...args], o);
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* left null; the test reports stdout and stderr */ }
    return { ...r, json, byId: Object.fromEntries((json?.results || []).map((x) => [x.id, x])) };
  };
  inst.writeConfig = (cfg) => writeFileSync(inst.configPath, typeof cfg === 'string' ? cfg : JSON.stringify(cfg, null, 2));
  inst.writeSettings = (s) => writeFileSync(inst.settingsPath, typeof s === 'string' ? s : JSON.stringify(s, null, 2));
  inst.cleanup = () => rmSync(root, { recursive: true, force: true });
  if (opts.config !== undefined) inst.writeConfig(opts.config);
  inst.writeSettings(opts.settings !== undefined ? opts.settings : JSON.parse(inst.run('voice-doctor.mjs', ['--print-hooks']).stdout));
  return inst;
}

const fileSha = (p) => sha256(readFileSync(p));

// Every entry under `dir`, without following symlinks: relative path -> 'd' | 'f:<sha256>' | 'l:<target>'.
export function snapshot(dir, out = new Map(), base = dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = lstatSync(p), rel = relative(base, p);
    if (st.isSymbolicLink()) out.set(rel, `l:${readlinkSync(p)}`);
    else if (st.isDirectory()) { out.set(rel, 'd'); snapshot(p, out, base); }
    else out.set(rel, `f:${fileSha(p)}`);
  }
  return out;
}
export function diffSnapshots(before, after) {
  const added = [...after.keys()].filter((k) => !before.has(k)).sort();
  const removed = [...before.keys()].filter((k) => !after.has(k)).sort();
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k)).sort();
  return { added, removed, changed };
}

// A calibration report that matches the install's current overlay, scorer, gate and hook, with `over` merged in.
export function writeGoodReport(inst, over = {}) {
  const report = {
    tool: 'onboarding/calibrate-user.mjs', version: 1, createdAt: '2026-10-02T12:00:00.000Z',
    overlay: { path: inst.overlayPath, sha256: fileSha(inst.overlayPath), reviewed: true },
    engine: { toolsDir: inst.tools, aiscoreSha256: fileSha(join(inst.tools, 'aiscore.mjs')), gateSha256: fileSha(join(inst.tools, 'prose-gate.mjs')), detectorPinOk: true, viaTemporaryCopy: false },
    hook: existsSync(inst.hookPath) ? { path: inst.hookPath, sha256: fileSha(inst.hookPath), wired: true } : null,
    split: { method: 'sha256 rank', heldOutShare: 0.3, fingerprint: '0000000000000000', tune: 21, heldOut: 9 },
    strictness: { level: 'standard', detBar: 40 },
    heldOut: { n: 9, failed: 0, nudgedOnly: 0, errors: 0, items: [] },
    aiDrafts: null, warnings: [],
  };
  const merged = { ...report, ...over, heldOut: { ...report.heldOut, ...(over.heldOut || {}) } };
  writeJson(join(inst.voice, 'calibration-report.json'), merged);
  return merged;
}
