#!/usr/bin/env node
// voice-doctor.mjs: check that the voice system is installed, wired and failing closed, with one PASS or FAIL line
// per check.
//
// What it checks (node voice-doctor.mjs --list prints this table from the code, with what each check catches):
//   runtime, config, engine, detector, detector-pin, scorer, normalizer, gate   the engine runs and is the tested one
//   overlay                                                                   your overlay loads, is reviewed, and is read
//   hook-wiring, hook-controls, send-fails-closed, write-warns                the hook is wired and fails closed
//   judges                                                                    optional; reports det-only mode when none
//   engine-calibration, user-calibration                                      calibration data is present and current
//
// It never changes your settings or your files. It runs the scorer, the gate and the hook on fixed made-up texts
// (lib/probes.mjs), simulates a broken scorer by pointing the hook at broken stand-ins through VOICE_AISCORE and
// VOICE_NORMALIZE in a temporary folder it deletes afterwards, and reads your overlay and calibration report without
// printing their contents. The network is off in this process. Only --live-judges reaches a judge, with one fixed
// made-up sentence.
//
// Usage:
//   node voice-doctor.mjs [--config <file>] [--tools <dir>] [--settings <file>[,<file>]] [--hook <file>]
//                         [--overlay <file>] [--only <ids>] [--skip <ids>] [--live-judges] [--slow] [--json]
//   node voice-doctor.mjs --list [--json]        the checks and what each one catches
//   node voice-doctor.mjs --print-hooks          the hooks block for settings.json that this config needs
// Exit: 0 no check failed (WARN and INFO allowed), 1 at least one FAIL, 2 the doctor couldn't run (usage error).
import './lib/local-only.mjs';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync, accessSync, constants, realpathSync, statSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { enginePaths, checkDetectorPin, loadDetector, runScorer, runNode, loadOverlay, overlayImports, engineLoadsOverlay, fileSha256, lastLine } from './lib/engine.mjs';
import { resolveHook, matcherMatches, matcherKind, recommendedSendMatcher, sendToolName, hookIntrospect, runHook, sendPayload, writePayload, FILE_TOOLS } from './lib/hook.mjs';
import * as P from './lib/probes.mjs';

export const EXIT = { 0: 'no check failed', 1: 'at least one check failed', 2: "the doctor couldn't run (usage error)" };
const VALUE_FLAGS = new Set(['--config', '--tools', '--settings', '--hook', '--overlay', '--only', '--skip']);
const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const samePath = (a, b) => !!a && !!b && realOr(a) === realOr(b);
const isExecutable = (p) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };
const onPath = (name, env) => String(env.PATH || '').split(delimiter).filter(Boolean).map((d) => join(d, name)).find(isExecutable) || null;
const tilde = (p, env) => { const h = env.HOME || homedir(); return p.startsWith(h + '/') ? `~${p.slice(h.length)}` : p; };
const first = (s) => String(s || '').split('\n')[0].slice(0, 200);
const PASS = 'PASS', FAIL = 'FAIL', WARN = 'WARN', INFO = 'INFO';
const res = (status, summary, { details = [], fix = null } = {}) => ({ status, summary, details, fix });
// What to do when the engine doesn't read the configured overlay. An engine that imports ./voice-overlay.mjs reads a
// kit-interface overlay copied there. An engine that imports per-person names (scan<Name>Voice and so on) breaks if a
// kit-interface overlay is copied over its file, so the fix says so instead of suggesting the copy.
function overlayFix(toolsDir) {
  const imps = overlayImports(toolsDir);
  const generic = imps.length && imps.every((i) => i.names.every((n) => ['scanVoice', 'hardBanCount', 'cadenceCount', 'VERDICT_STRUCT_TYPES', 'CALIBRATED'].includes(n)));
  if (generic) return `copy your reviewed overlay to ${join(toolsDir, imps[0].spec.replace(/^\.\//, ''))} (keep a dated copy of the old file first), or set paths.overlay to that file if your overlay is already there`;
  return `this engine imports ${[...new Set(imps.map((i) => `${i.spec} (${i.names.join(', ')})`))].join('; ') || 'no overlay module'}, a per-person interface; copying a kit overlay over that file breaks the scorer. Use an engine whose overlay import is ./voice-overlay.mjs (the current release), or calibrate the draft with calibrate-user.mjs --overlay, which builds a temporary engine copy that reads it`;
}

// Broken stand-ins for the scorer and the normalizer. The hook must deny a send with each one.
const BROKEN_SCORERS = {
  'throws an error': "throw new Error('voice-doctor stand-in: the scorer crashed');",
  'prints no JSON': "console.log('score: 12, looks fine');",
  'prints JSON without a score or issues': 'console.log(JSON.stringify({ ok: true }));',
  'exits 1 with no output': 'process.exit(1);',
};
const SLOW_SCORERS = { 'hangs': 'setTimeout(() => {}, 120000);' };
const BROKEN_NORMALIZERS = {
  'throws an error': "throw new Error('voice-doctor stand-in: the normalizer crashed');",
  'prints no JSON': "console.log('canonical text');",
};

// A concrete file path that a nudge glob matches, for a synthetic write.
export function probeFileFor(glob, dir) {
  const rel = glob.replace(/^\/+/, '')
    .replace(/\{([^}]*)\}/g, (m, c) => c.split(',')[0])
    .replace(/\[!?([^\]]+)\]/g, (m, c) => c[0])
    .replace(/\*\*\//g, 'sub/').replace(/\*\*/g, 'sub').replace(/\*/g, 'voice-doctor-probe').replace(/\?/g, 'x');
  return join(dir, rel);
}

// The concrete tool names a configured send tool is tested as: an mcp__ name as it is, a suffix under two made-up
// MCP server prefixes (one plain, one with the hyphens and underscores plugin servers use).
export const namesFor = (s) => (s.startsWith('mcp__') ? [s] : [sendToolName(s), sendToolName(s, 'plugin_mail-tools_server')]);

// What is wrong with this runtime: a list of messages, empty when Node.js is 18 or later and python3 answered.
export function runtimeProblems({ node, python }) {
  const bad = [];
  if (!(Number(String(node).split('.')[0]) >= 18)) bad.push(`Node.js ${node} is older than 18`);
  if (!python) bad.push('python3 is not on PATH');
  return bad;
}

// The scorer check warns above this many milliseconds for one sentence (the hook gives the scorer 20 s).
const SCORER_WARN_MS = Number(process.env.VOICE_DOCTOR_SCORER_WARN_MS) || 10000;

// The judge-model name prose-gate expects for the drafter's lab.
const DRAFTER_FOR_LAB = { anthropic: 'claude', google: 'gemini', openai: 'gpt', xai: 'grok' };

// ── the checks ──────────────────────────────────────────────────────────────────────────────────────────────
// Each check: id, what it verifies, the failures it catches (voice-doctor --list prints these, and test/doctor.test.mjs
// builds a fixture for each one), and run(ctx) -> { status, summary, details, fix }.
export const CHECKS = [
  {
    id: 'runtime', verifies: 'Node.js 18 or later and python3 are installed (the hook runs under python3).',
    catches: ['Node.js older than 18', 'python3 missing'],
    run(ctx) {
      const py = spawnSync('python3', ['--version'], { encoding: 'utf8', env: ctx.env, timeout: 15000 });
      const python = py.status === 0 ? (py.stdout || py.stderr).trim() : null;
      const bad = runtimeProblems({ node: process.versions.node, python });
      if (bad.length) return res(FAIL, bad.join('; '), { fix: 'install Node.js 18 or later and python3, then re-run' });
      return res(PASS, `node ${process.versions.node}, ${python}`);
    },
  },
  {
    id: 'config', verifies: 'The config file parses and follows voice-config.schema.json, and no allowed judge comes from the drafter\'s lab.',
    catches: ['config that is not valid JSON', 'config that breaks the schema', 'a judge from the drafter\'s lab', 'a config that lets samples leave the machine'],
    run(ctx) {
      if (ctx.cfgErrors.length) return res(FAIL, `${ctx.cfgSource} can't be used`, { details: ctx.cfgErrors, fix: `fix the file (the schema is ${join(ctx.onboarding, 'voice-config.schema.json')}), or start from voice-config.example.json` });
      const j = ctx.config.judges;
      const judges = j.mode === 'none' ? 'no judges (det-only)' : `${j.mode}: ${j.allowed.map((a) => `${a.name} (${a.lab})`).join(', ')}; drafter lab ${j.drafterLab}`;
      return res(PASS, `${ctx.cfgExists ? ctx.cfgSource : `no config file at ${ctx.cfgSource}, using the defaults`}; ${judges}; samples stay on this machine`);
    },
  },
  {
    id: 'engine', verifies: 'The engine files are installed: aiscore.mjs (scorer), prose-gate.mjs (gate), text-normalize.mjs (normalizer).',
    catches: ['a missing scorer, gate or normalizer'],
    run(ctx) {
      const want = { 'aiscore.mjs': ctx.paths.aiscore, 'prose-gate.mjs': ctx.paths.gate, 'text-normalize.mjs': ctx.paths.normalizer };
      const missing = Object.entries(want).filter(([, p]) => !existsSync(p)).map(([n]) => n);
      if (missing.length) return res(FAIL, `missing in ${ctx.paths.toolsDir}: ${missing.join(', ')}`, { fix: 'reinstall the tools (the kit\'s setup.sh, or a checkout of the voice-system repo)' });
      return res(PASS, `scorer, gate and normalizer in ${ctx.paths.toolsDir}`);
    },
  },
  {
    id: 'detector', verifies: 'The generic detector (avoid-ai-writing detector/patterns.js) is present and loads.',
    catches: ['detector missing', 'detector that does not load'],
    run(ctx) {
      if (!existsSync(ctx.paths.detector)) return res(FAIL, `no detector at ${ctx.paths.detector}`, { fix: 'restore tools/avoid-ai-writing (vendored in the kits; in the repo, clone it as the README Setup section says) or set AVOID_AI_DETECTOR' });
      const D = loadDetector(ctx.paths);
      if (!D || typeof D.analyzeText !== 'function') return res(FAIL, `the detector at ${ctx.paths.detector} doesn't load or has no analyzeText`, { fix: 'restore the pinned detector checkout' });
      return res(PASS, ctx.paths.detector);
    },
  },
  {
    id: 'detector-pin', verifies: 'The detector is the tested one: the commit and the patterns.js hash in detector-pin.json.',
    catches: ['detector at another commit', 'detector with edited patterns'],
    run(ctx) {
      if (!existsSync(ctx.paths.detector)) return res(FAIL, "can't run: no detector", { fix: 'see the detector check' });
      const p = checkDetectorPin(ctx.paths.detector);
      if (!p.ok) return res(FAIL, `not the tested detector (${p.how})`, { details: p.problems, fix: `check out ${p.want.commit.slice(0, 7)} in the detector folder; before moving the pin, re-run calibration/gate-eval.mjs and calibration/human-fp-budget.mjs` });
      return res(PASS, `${p.want.commit.slice(0, 7)}, patterns.js sha256 ${p.sha.slice(0, 12)} (${p.how})`);
    },
  },
  {
    id: 'scorer', verifies: 'The scorer runs, prints its JSON with an overlay issues list, and flags a known-AI probe.',
    catches: ['scorer that crashes', 'scorer that prints no usable JSON', 'scorer that flags nothing on a known-AI probe', 'scorer slower than half the hook budget'],
    run(ctx) {
      if (!existsSync(ctx.paths.aiscore)) return res(FAIL, "can't run: no aiscore.mjs", { fix: 'see the engine check' });
      const t0 = Date.now();
      const clean = runScorer(ctx.paths, P.CLEAN_SEND, { env: ctx.env });
      const ms = Date.now() - t0;
      if (!clean.ok) return res(FAIL, `the scorer fails on a plain sentence: ${clean.error}`, { fix: 'run node aiscore.mjs - --json < some.txt and fix what it prints' });
      const ai = runScorer(ctx.paths, P.AI_PROBE, { env: ctx.env });
      if (!ai.ok) return res(FAIL, `the scorer fails on the AI probe: ${ai.error}`);
      const n = ai.json.issueCount ?? 0;
      if (n < 3 || !(ai.json.score > 0)) return res(FAIL, `the scorer flags almost nothing on stock AI vocabulary (${n} issues, score ${ai.json.score})`, { fix: 'the detector or the scorer is not the tested one; check detector-pin and reinstall the engine' });
      if (ms > SCORER_WARN_MS) return res(WARN, `runs, but took ${ms} ms on one sentence (warning above ${SCORER_WARN_MS} ms); the hook gives the scorer 20 s`);
      return res(PASS, `plain sentence: score ${clean.json.score}; AI probe: score ${ai.json.score}, ${n} issues (${ms} ms)`);
    },
  },
  {
    id: 'normalizer', verifies: 'The text-normalize.mjs CLI drops invisible and tag characters, folds look-alikes, and counts the input.',
    catches: ['normalizer CLI that crashes or prints no JSON', 'normalizer that leaves zero-width, look-alike or tag characters', 'normalizer that miscounts its input'],
    run(ctx) {
      if (!existsSync(ctx.paths.normalizer)) return res(FAIL, "can't run: no text-normalize.mjs", { fix: 'see the engine check' });
      const r = runNode(ctx.paths.normalizer, ['--json'], P.NORMALIZE_PROBE, { env: ctx.env, timeout: 15000 });
      let j = null;
      try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* below */ }
      if (r.code !== 0 || !j || typeof j.canonical !== 'string') return res(FAIL, `node text-normalize.mjs --json didn't print its JSON (exit ${r.code ?? r.signal}${r.stderr ? `: ${lastLine(r.stderr)}` : ''})`, { fix: 'reinstall text-normalize.mjs from the same release as aiscore.mjs' });
      const bad = [];
      if (P.NORMALIZE_LEFTOVERS.test(j.canonical)) bad.push('canonical text still has a zero-width, look-alike or tag character');
      if (!/preview/.test(j.canonical) || !/code/.test(j.canonical)) bad.push('canonical text lost the probe words');
      if (j.inputCodePoints !== [...P.NORMALIZE_PROBE].length) bad.push(`inputCodePoints is ${j.inputCodePoints}, the probe has ${[...P.NORMALIZE_PROBE].length}`);
      if ('rendered' in j && typeof j.rendered !== 'string') bad.push('rendered is present but not text');
      if (bad.length) return res(FAIL, 'the normalizer runs but gets the probe wrong', { details: bad, fix: 'reinstall text-normalize.mjs from the same release as aiscore.mjs' });
      return res(PASS, `folds the probe${'rendered' in j ? '; prints canonical and rendered views' : '; prints the canonical view (no rendered view in this version)'}`);
    },
  },
  {
    id: 'gate', verifies: 'prose-gate.mjs --det-only never ADMITs without a judge and rejects text addressed to a grader.',
    catches: ['gate that crashes', 'gate that ADMITs with no judge', 'gate that misses judge-directed injection'],
    run(ctx) {
      if (!existsSync(ctx.paths.gate)) return res(FAIL, "can't run: no prose-gate.mjs", { fix: 'see the engine check' });
      const call = (text) => {
        const r = runNode(ctx.paths.gate, ['-', '--json', '--det-only'], text, { env: ctx.env, timeout: 120000 });
        let j = null; try { j = JSON.parse(r.stdout); } catch { /* below */ }
        return { code: r.code, verdict: j?.verdict || 'ERROR', err: j?.error || lastLine(r.stderr) };
      };
      const clean = call(P.CLEAN_SEND), inj = call(P.INJECTION_PROBE);
      const bad = [];
      if (clean.verdict !== 'INCONCLUSIVE') bad.push(`a plain sentence got ${clean.verdict} (exit ${clean.code}); with no judge it must be INCONCLUSIVE${clean.verdict === 'ERROR' ? `: ${clean.err}` : ''}`);
      if (inj.verdict !== 'REJECT') bad.push(`text addressed to a grader got ${inj.verdict} (exit ${inj.code}); it must be REJECT`);
      if (bad.length) return res(FAIL, 'the gate gives the wrong verdict on a probe', { details: bad, fix: 'reinstall prose-gate.mjs from the same release as aiscore.mjs' });
      return res(PASS, 'plain sentence INCONCLUSIVE (exit 3), grader-directed text REJECT (exit 2)');
    },
  },
  {
    id: 'overlay', verifies: 'Your personal overlay loads, has the engine interface, is marked reviewed, and is the overlay the engine reads.',
    catches: ['overlay missing', 'overlay that does not load', 'overlay missing scanVoice, hardBanCount or cadenceCount', 'draft overlay not reviewed yet', 'engine reading a different overlay'],
    async run(ctx) {
      const path = ctx.config.paths.overlay;
      const ov = await loadOverlay(path);
      if (!ov.ok) return res(FAIL, ov.error, { fix: existsSync(path) ? 'fix the overlay file, or rebuild it with profile-build.mjs' : 'build a draft with profile-build.mjs, review it, then install it at this path (see /voice-setup)' });
      const notes = [`interface ${ov.iface}`];
      if (ov.reviewed === false) return res(FAIL, `${path} is a draft: REVIEWED is false`, { fix: 'open it in your editor, keep only what is yours, set REVIEWED = true, then re-run calibrate-user.mjs' });
      if (ov.calibrated === false) return res(FAIL, `${path} says CALIBRATED = false, so the engine treats every clean score as generic-only`, { fix: 'run /voice-setup to build and review a personal overlay' });
      if (ov.reviewed === null) notes.push('no REVIEWED flag');
      if (ov.probe) {
        const r = runScorer(ctx.paths, `voice-doctor probe ${ov.probe}`, { env: ctx.env });
        if (!r.ok) return res(FAIL, `can't tell whether the engine reads it: the scorer fails (${r.error})`);
        if (!r.issues.some((i) => /-probe$/.test(i.type) && i.text === ov.probe)) {
          const imps = [...new Set(overlayImports(ctx.paths.toolsDir).map((i) => i.spec))];
          return res(FAIL, `the engine at ${ctx.paths.toolsDir} doesn't read ${path}`, { details: [`the engine imports ${imps.join(', ') || 'no overlay module'}`], fix: overlayFix(ctx.paths.toolsDir) });
        }
        notes.push('the engine reads it (probe seen)');
      } else if (engineLoadsOverlay(ctx.paths.toolsDir, path)) notes.push('the engine imports it (no PROBE to confirm at run time)');
      else return res(FAIL, `the engine at ${ctx.paths.toolsDir} doesn't import ${path}`, { details: [`the engine imports ${[...new Set(overlayImports(ctx.paths.toolsDir).map((i) => i.spec))].join(', ') || 'no overlay module'}`], fix: overlayFix(ctx.paths.toolsDir) });
      return res(PASS, `${path} (sha256 ${ov.sha256.slice(0, 12)}): ${notes.join(', ')}`);
    },
  },
  {
    id: 'hook-wiring', verifies: 'settings.json runs the voice hook on PreToolUse for every send tool (under any MCP server) and on PostToolUse for Write, Edit and MultiEdit; the hook treats every send tool as a send and scores with this engine.',
    catches: ['settings.json that is not valid JSON', 'voice hook not wired', 'a flat hook entry Claude Code does not run', 'a send matcher that misses an MCP send tool (an exact-name list never matches mcp__server__tool)', 'a write matcher that misses Write, Edit or MultiEdit', 'hook script missing', 'a hook that does not treat a configured send tool as a send', 'a hook that scores with a different engine', 'a hook timeout shorter than the scorer budget'],
    run(ctx) {
      const { hook, config } = ctx;
      const problems = [], warns = [], details = [];
      let hookScriptProblem = false;
      for (const e of hook.errors) problems.push(e);
      const nested = hook.entries.filter((e) => !e.flat);
      for (const e of hook.entries.filter((x) => x.flat)) problems.push(`${e.file}: a ${e.event} entry runs the hook in the flat form ({matcher, command}); Claude Code only runs entries with a "hooks" list`);
      if (!hook.entries.length) problems.push(`the voice hook (${ctx.hookName}) isn't wired in ${config.paths.settings.join(', ')}`);
      const pre = nested.filter((e) => e.event === 'PreToolUse'), post = nested.filter((e) => e.event === 'PostToolUse');
      const probes = config.sendTools.flatMap(namesFor);
      const uncovered = config.sendTools.filter((s) => !namesFor(s).every((n) => pre.some((e) => matcherMatches(e.matcher, n))));
      if (hook.entries.length && !pre.length) problems.push('no PreToolUse entry runs the hook, so nothing blocks a send');
      else if (pre.length && uncovered.length) {
        const kinds = [...new Set(pre.map((e) => matcherKind(e.matcher)))].join(', ');
        problems.push(`the PreToolUse matcher (${kinds}) misses ${uncovered.length} of ${config.sendTools.length} send tools under an MCP prefix, for example ${sendToolName(uncovered[0])}`);
        if (pre.some((e) => matcherKind(e.matcher) === 'exact names')) details.push('Claude Code reads a matcher made only of letters, digits, "_" and "|" as a list of exact tool names, so "slack_send_message" never matches "mcp__slack__slack_send_message"');
      }
      const missingWrite = FILE_TOOLS.filter((t) => !post.some((e) => matcherMatches(e.matcher, t)));
      if (hook.entries.length && missingWrite.length) problems.push(`no PostToolUse entry covers ${missingWrite.join(', ')}, so those writes are never nudged`);
      for (const e of nested) if (e.timeout != null && Number(e.timeout) < 35) warns.push(`${e.event} entry has timeout ${e.timeout} s; the hook's scorer and normalizer budgets add up to 30 s, so it can be stopped before it decides`);
      if (!hook.exists) problems.push(`no hook script at ${hook.hookPath || config.paths.hook}`);
      else {
        const intro = ctx.intro();
        if (!intro.ok) problems.push(`can't load the hook in python3: ${intro.error}`);
        else {
          if (intro.isSend === null) problems.push('the hook has no is_send_tool function, so it can\'t block sends (an older, write-only hook)');
          else {
            const sendOf = new Map(probes.map((n, i) => [n, intro.isSend[i]]));
            const notSend = config.sendTools.filter((s) => namesFor(s).some((n) => !sendOf.get(n)));
            if (notSend.length) { hookScriptProblem = true; problems.push(`the hook doesn't treat ${notSend.length} of the configured send tools as sends (${notSend.slice(0, 3).join(', ')}${notSend.length > 3 ? ', ...' : ''}), so it lets them through even when the matcher routes them to it`); }
          }
          if (intro.aiscore && !samePath(intro.aiscore, ctx.paths.aiscore)) problems.push(`the hook scores with ${intro.aiscore}, but this config's engine is ${ctx.paths.aiscore}; the overlay and the calibration were checked against the second one`);
        }
      }
      const shipped = join(ctx.paths.toolsDir, 'hook', 'voice-tell-gate.py');
      const scriptFix = `the hook script decides which tools are sends, and merge-hooks.mjs doesn't change it: install the hook that ships with this engine (cp ${shipped} ${hook.hookPath || config.paths.hook}${existsSync(shipped) ? '' : '; this engine has no hook/ folder, so get the hook from the same release'}), or add the name to the hook's SEND_SUFFIXES, or remove it from sendTools`;
      const wiringFix = `run node ${join(ctx.onboarding, 'merge-hooks.mjs')} --dry-run to see the hooks section this config needs, then without --dry-run to write it into ${config.paths.settings[0]} (it keeps a backup and every other hook)`;
      const fix = !problems.length ? null : hookScriptProblem && problems.length === 1 ? scriptFix : hookScriptProblem ? `${wiringFix}; then ${scriptFix}` : wiringFix;
      if (problems.length) return res(FAIL, problems[0], { details: [...problems.slice(1), ...details, ...warns], fix });
      if (warns.length) return res(WARN, warns[0], { details: warns.slice(1) });
      return res(PASS, `PreToolUse covers all ${config.sendTools.length} send tools, PostToolUse covers ${FILE_TOOLS.join(', ')}; hook ${hook.hookPath}`);
    },
  },
  {
    id: 'hook-controls', verifies: 'The wired hook lets a plain message through and stops an obvious tell, with the real scorer.',
    catches: ['a hook that denies a clean send', 'a hook that lets an obvious tell through'],
    run(ctx) {
      if (!ctx.hook.exists) return res(FAIL, "can't run: no hook script", { fix: 'see the hook-wiring check' });
      const tool = sendToolName(ctx.config.sendTools[0]);
      const clean = runHook({ command: ctx.preCommand, hookPath: ctx.hook.hookPath, payload: sendPayload(P.CLEAN_SEND, tool), env: ctx.env });
      const tell = runHook({ command: ctx.preCommand, hookPath: ctx.hook.hookPath, payload: sendPayload(P.TELL_SEND, tool), env: ctx.env });
      const bad = [];
      if (clean.decision === 'deny') bad.push(`it denies a plain message: ${first(clean.message)}`);
      else if (clean.decision === 'other') bad.push(`it printed something unexpected for a plain message (exit ${clean.code}): ${first(clean.message || clean.stderr)}`);
      if (tell.decision === 'pass') bad.push('it let "seamless ... streamline ... synergy" through without a block or a nudge');
      else if (tell.decision === 'other') bad.push(`it printed something unexpected for the tell (exit ${tell.code}): ${first(tell.message || tell.stderr)}`);
      if (bad.length) return res(FAIL, bad[0], { details: bad.slice(1), fix: clean.decision === 'deny' ? 'run the scorer and the normalizer by hand; a hook that denies everything usually means they are from different releases' : 'check the hook\'s word list and the scorer' });
      return res(PASS, `plain message ${clean.decision === 'pass' ? 'allowed' : 'allowed with a nudge'}; tell ${tell.decision === 'deny' ? 'blocked' : 'nudged (not blocked)'} on ${tool}`);
    },
  },
  {
    id: 'send-fails-closed', verifies: 'With the scorer (or the normalizer) broken, the hook denies a send instead of letting it through.',
    catches: ['a broken scorer that lets a send through', 'a broken normalizer that lets a send through', 'a hook that ignores VOICE_AISCORE (older than the fail-closed hook)'],
    run(ctx) {
      if (!ctx.hook.exists) return res(FAIL, "can't run: no hook script", { fix: 'see the hook-wiring check' });
      const intro = ctx.intro();
      if (!intro.ok) return res(FAIL, `can't load the hook: ${intro.error}`);
      if (!intro.honorsAiscoreEnv) return res(FAIL, 'the hook ignores VOICE_AISCORE, so a broken scorer can\'t be simulated; hooks that ignore it are older than the fail-closed hook', { fix: 'install the current voice-tell-gate.py' });
      const tool = sendToolName(ctx.config.sendTools[0]);
      const leaks = [];
      const scorers = { ...BROKEN_SCORERS, ...(ctx.f.slow ? SLOW_SCORERS : {}) };
      for (const [kind, body] of Object.entries(scorers)) {
        const stub = ctx.stub(`aiscore-${kind}`, body);
        const r = runHook({ command: ctx.preCommand, hookPath: ctx.hook.hookPath, payload: sendPayload(P.CLEAN_SEND, tool), env: { ...ctx.env, VOICE_AISCORE: stub } });
        if (r.decision !== 'deny') leaks.push(`a scorer that ${kind}: the send was ${r.decision === 'pass' ? 'allowed' : r.decision === 'context' ? 'allowed with a note' : `not denied (exit ${r.code})`}`);
      }
      let normNote = 'the hook reads no normalizer';
      if (intro.normalizer) {
        if (!intro.honorsNormalizeEnv) normNote = 'the hook ignores VOICE_NORMALIZE, so a broken normalizer was not simulated';
        else {
          for (const [kind, body] of Object.entries(BROKEN_NORMALIZERS)) {
            const stub = ctx.stub(`normalize-${kind}`, body);
            const r = runHook({ command: ctx.preCommand, hookPath: ctx.hook.hookPath, payload: sendPayload(P.CLEAN_SEND, tool), env: { ...ctx.env, VOICE_NORMALIZE: stub } });
            if (r.decision !== 'deny') leaks.push(`a normalizer that ${kind}: the send was ${r.decision === 'pass' ? 'allowed' : r.decision === 'context' ? 'allowed with a note' : `not denied (exit ${r.code})`}`);
          }
          normNote = `${Object.keys(BROKEN_NORMALIZERS).length} broken normalizers denied too`;
        }
      }
      if (leaks.length) return res(FAIL, `the hook fails open: ${leaks[0]}`, { details: leaks.slice(1), fix: 'install the current voice-tell-gate.py, which denies a send whenever its scorer or normalizer fails' });
      return res(intro.normalizer && !intro.honorsNormalizeEnv ? WARN : PASS, `${Object.keys(scorers).length} broken scorers, each send denied; ${normNote}`);
    },
  },
  {
    id: 'write-warns', verifies: 'With the scorer broken, a write to each nudge glob gets a visible warning, and a tell in a written file gets a nudge.',
    catches: ['a broken scorer that leaves a file write silent', 'a nudge glob the hook ignores', 'a hook that never nudges a tell in a written file'],
    run(ctx) {
      if (!ctx.hook.exists) return res(FAIL, "can't run: no hook script", { fix: 'see the hook-wiring check' });
      const intro = ctx.intro();
      if (!intro.ok) return res(FAIL, `can't load the hook: ${intro.error}`);
      if (!intro.honorsAiscoreEnv) return res(FAIL, 'the hook ignores VOICE_AISCORE, so a broken scorer can\'t be simulated', { fix: 'install the current voice-tell-gate.py' });
      const stub = ctx.stub('aiscore-throws-write', BROKEN_SCORERS['throws an error']);
      const silent = [];
      for (const g of ctx.config.nudgeGlobs) {
        const file = probeFileFor(g, ctx.tmp());
        const r = runHook({ command: ctx.postCommand, hookPath: ctx.hook.hookPath, payload: writePayload(P.CLEAN_FILE, file), env: { ...ctx.env, VOICE_AISCORE: stub } });
        if (r.decision !== 'context' && r.decision !== 'deny') silent.push(`${g} (probe ${file.split('/').pop()}): ${r.decision === 'pass' ? 'no warning' : `exit ${r.code}`}`);
      }
      const tell = runHook({ command: ctx.postCommand, hookPath: ctx.hook.hookPath, payload: writePayload(P.TELL_FILE, probeFileFor(ctx.config.nudgeGlobs[0], ctx.tmp())), env: ctx.env });
      const bad = [...silent.map((s) => `broken scorer, silent write: ${s}`)];
      if (tell.decision !== 'context' && tell.decision !== 'deny') bad.push(`a written file with "seamless ... streamline ... synergy" got no nudge (${tell.decision})`);
      if (bad.length) return res(FAIL, bad[0], { details: bad.slice(1), fix: 'install the current voice-tell-gate.py; for a glob it ignores, add the extension to its prose list or drop the glob from nudgeGlobs' });
      return res(PASS, `${ctx.config.nudgeGlobs.length} nudge globs warned with a broken scorer; a tell in a written file was nudged`);
    },
  },
  {
    id: 'judges', optional: true, verifies: 'Optional. Each allowed judge is in the gate\'s registry, from the lab the config says, and has a backend command; with --live-judges, answers one made-up sentence.',
    catches: ['a judge name the gate does not know', 'a judge whose lab differs from the gate\'s registry', 'a missing judge backend (the gate then runs det-only)'],
    async run(ctx) {
      const j = ctx.config.judges;
      if (j.mode === 'none' || !j.allowed.length) return res(INFO, 'no judges configured: det-only mode, so a clean draft is INCONCLUSIVE, never ADMIT; the deterministic checks and the send hook still run');
      if (!existsSync(ctx.paths.gate)) return res(WARN, 'no prose-gate.mjs, so no judge can run (det-only at best)');
      let G;
      try { G = await import(pathToFileURL(ctx.paths.gate).href); } catch (e) { return res(WARN, `can't load the gate to read its judge registry: ${first(e.message)}`); }
      const issues = [], ok = [];
      for (const a of j.allowed) {
        const reg = G.JUDGES?.[a.name];
        if (!reg) { issues.push(`${a.name}: not in the gate's judge registry (${Object.keys(G.JUDGES || {}).join(', ')})`); continue; }
        if (reg.vendor !== a.lab) { issues.push(`${a.name}: the config says lab ${a.lab}, the gate's registry says ${reg.vendor}`); continue; }
        if (reg.vendor === j.drafterLab) { issues.push(`${a.name}: from the drafter's lab (${j.drafterLab})`); continue; }
        if (reg.backend === 'opencode') {
          const bin = [a.command, ctx.env.OPENCODE_BIN].filter(Boolean).find(isExecutable) || onPath('opencode', ctx.env);
          if (!bin) { issues.push(`${a.name}: no backend command (judges.allowed[].command, OPENCODE_BIN, or opencode on PATH)`); continue; }
        }
        if (ctx.f.liveJudges) {
          const r = runNode(ctx.paths.gate, ['-', '--json', '--drafter', DRAFTER_FOR_LAB[j.drafterLab] || 'unknown', '--judge', a.name], P.JUDGE_PROBE, { env: ctx.env, local: false, timeout: 400000 });
          let out = null; try { out = JSON.parse(r.stdout); } catch { /* below */ }
          const d = (out?.judgeDetail || []).find((x) => x.provider === a.name);
          if (!d || d.error) { issues.push(`${a.name}: no answer to the probe (${d?.error ? first(d.error) : `exit ${r.code}`})`); continue; }
        }
        ok.push(a.name);
      }
      const how = ctx.f.liveJudges ? 'answered the probe' : 'configured (not called; --live-judges sends one made-up sentence)';
      if (!ok.length) return res(WARN, `no judge is usable, so the gate runs det-only: ${issues[0]}`, { details: issues.slice(1) });
      if (j.mode === 'consensus' && ok.length < 2) return res(WARN, `consensus needs two judges and only ${ok[0]} is usable; the gate's verdict is INCONCLUSIVE when fewer jurors answer than the panel needs`, { details: issues });
      if (issues.length) return res(WARN, `${ok.join(', ')} ${how}; ${issues[0]}`, { details: issues.slice(1) });
      return res(PASS, `${j.mode}: ${ok.join(', ')} ${how}; none from the drafter's lab (${j.drafterLab})`);
    },
  },
  {
    id: 'engine-calibration', verifies: 'The engine\'s human false-positive record (calibration/human-fp-budget.json) is present and shows 0 rejects, and the corpus manifest to re-run it is there.',
    catches: ['no engine calibration record', 'a record with rejects on human writing', 'no corpus manifest to re-run the budget'],
    run(ctx) {
      const p = ctx.paths.fpBudget;
      if (!existsSync(p)) return res(FAIL, `no engine calibration record at ${p}`, { fix: 'install the calibration/ folder that ships with the engine; without it nothing shows this engine was measured on human writing' });
      let b; try { b = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return res(FAIL, `${p} is not valid JSON (${first(e.message)})`); }
      const pooled = b.pooledPublic || {};
      const sets = Object.entries(b.sets || {});
      const withRejects = sets.filter(([, s]) => s.rejects !== 0).map(([k, s]) => `${k}: ${s.rejects} of ${s.n}`);
      if (!(pooled.n > 0) || pooled.rejects !== 0 || withRejects.length) return res(FAIL, `the record shows rejects on human writing or no public set (${withRejects.join(', ') || `public ${pooled.rejects} of ${pooled.n}`})`, { fix: 're-run calibration/human-fp-budget.mjs on the pinned detector and fix what it reports' });
      const manifest = existsSync(join(ctx.paths.toolsDir, 'calibration', 'public-corpora.sha256'));
      return res(manifest ? PASS : WARN, `0 rejects in ${pooled.n.toLocaleString('en-US')} public human documents, and every one of the ${sets.length} sets in the record at 0 (measured ${String(b.measuredAt || '').slice(0, 10)} at ${b.toolsCommit || 'an unrecorded commit'})${manifest ? '' : '; no corpus manifest (calibration/public-corpora.sha256), so the budget can\'t be re-run here'}`);
    },
  },
  {
    id: 'user-calibration', verifies: 'Your calibration report exists, shows 0 failed held-out samples, and was made with the current overlay, scorer, gate and hook.',
    catches: ['no calibration report', 'held-out samples that failed', 'a report made with an older overlay, scorer, gate or hook'],
    run(ctx) {
      const p = ctx.config.paths.calibrationReport;
      if (!existsSync(p)) return res(FAIL, `no calibration report at ${p}`, { fix: 'run calibrate-user.mjs on the installed overlay (step 7 of /voice-setup)' });
      let r; try { r = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return res(FAIL, `${p} is not valid JSON (${first(e.message)})`); }
      const h = r.heldOut || {};
      if (!(h.n > 0)) return res(FAIL, 'the report has no held-out samples');
      if (h.failed || h.errors) return res(FAIL, `${h.failed || 0} of ${h.n} held-out samples failed${h.errors ? ` and ${h.errors} had a check error` : ''} in the last calibration`, { fix: 'run calibrate-user.mjs, apply its suggestions to the overlay, and re-run until 0 fail' });
      const stale = [];
      const cmp = (what, want, path) => { if (!want) return; if (!path || !existsSync(path)) stale.push(`${what}: ${path || 'not found'} is gone`); else if (fileSha256(path) !== want) stale.push(`${what} changed since the report`); };
      cmp('overlay', r.overlay?.sha256, ctx.config.paths.overlay);
      cmp('scorer (aiscore.mjs)', r.engine?.aiscoreSha256, ctx.paths.aiscore);
      cmp('gate (prose-gate.mjs)', r.engine?.gateSha256, ctx.paths.gate);
      if (r.hook) cmp('hook', r.hook.sha256, ctx.hook.hookPath);
      if (stale.length) return res(FAIL, `the report is stale: ${stale[0]}`, { details: stale.slice(1), fix: 'run calibrate-user.mjs again' });
      const small = h.n < 6 ? `; only ${h.n} held-out samples, so add more writing when you can` : '';
      return res(h.n < 6 ? WARN : PASS, `0 of ${h.n} held-out samples failed (${r.strictness?.level || 'standard'}, ${String(r.createdAt || '').slice(0, 10)}); report matches the current overlay, scorer, gate${r.hook ? ' and hook' : ''}${small}`);
    },
  },
];

// ── command line ────────────────────────────────────────────────────────────────────────────────────────────
class UsageError extends Error {}
function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); f[a.slice(2)] = argv[++i]; }
    else if (a === '--json') f.json = true;
    else if (a === '--list') f.list = true;
    else if (a === '--print-hooks') f.printHooks = true;
    else if (a === '--live-judges') f.liveJudges = true;
    else if (a === '--slow') f.slow = true;
    else if (a === '--help' || a === '-h') f.help = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  const ids = new Set(CHECKS.map((c) => c.id));
  for (const k of ['only', 'skip']) if (f[k]) {
    f[k] = f[k].split(',').map((s) => s.trim()).filter(Boolean);
    const bad = f[k].filter((x) => !ids.has(x));
    if (bad.length) throw new UsageError(`--${k}: unknown check ${bad.join(', ')} (see --list)`);
  }
  return f;
}

export function hooksBlock(config, env = process.env) {
  const cmd = `python3 ${tilde(config.paths.hook, env)}`;
  return {
    hooks: {
      PreToolUse: [{ matcher: recommendedSendMatcher(config.sendTools), hooks: [{ type: 'command', command: cmd }] }],
      PostToolUse: [{ matcher: FILE_TOOLS.join('|'), hooks: [{ type: 'command', command: cmd }] }],
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let f;
  try { f = parseArgs(argv); } catch (e) { console.error(`voice-doctor: ${e.message}`); return 2; }
  const self = fileURLToPath(import.meta.url);
  if (f.help) {
    console.log(`usage: node voice-doctor.mjs [--config <file>] [--tools <dir>] [--settings <file>[,<file>]] [--hook <file>] [--overlay <file>]\n                          [--only <ids>] [--skip <ids>] [--live-judges] [--slow] [--json]\n       node voice-doctor.mjs --list [--json]\n       node voice-doctor.mjs --print-hooks\nexit: ${Object.entries(EXIT).map(([k, v]) => `${k} ${v}`).join('; ')}`);
    return 0;
  }
  if (f.list) {
    const rows = CHECKS.map((c) => ({ id: c.id, optional: !!c.optional, verifies: c.verifies, catches: c.catches }));
    if (f.json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.id}${r.optional ? ' (optional)' : ''}\n  verifies: ${r.verifies}\n  catches:  ${r.catches.join('; ')}`);
    return 0;
  }

  const overrides = { toolsDir: f.tools, hook: f.hook, overlay: f.overlay, settings: f.settings ? f.settings.split(',').map((s) => s.trim()).filter(Boolean) : undefined };
  const { config, errors, source, exists } = loadConfig({ path: f.config, env, overrides });
  if (f.printHooks) { console.log(JSON.stringify(hooksBlock(config, env), null, 2)); return errors.length ? 1 : 0; }

  const paths = enginePaths(config.paths.toolsDir, env);
  const hook = resolveHook(config);
  const pick = (ev) => hook.entries.find((e) => e.event === ev && !e.flat)?.command || null;
  let tmp = null, intro = null;
  const ctx = {
    f, env, config, cfgErrors: errors, cfgSource: source, cfgExists: exists, paths, hook, self,
    onboarding: resolve(self, '..'), hookName: config.paths.hook.split('/').pop(),
    preCommand: pick('PreToolUse'), postCommand: pick('PostToolUse'),
    intro: () => (intro ||= hookIntrospect(hook.hookPath, config.sendTools.flatMap(namesFor), env)),
    tmp: () => (tmp ||= mkdtempSync(join(tmpdir(), 'voice-doctor-'))),
    stub: (name, body) => { const p = join(ctx.tmp(), `${name.replace(/[^a-z0-9-]+/gi, '-')}.mjs`); writeFileSync(p, `// voice-doctor stand-in, deleted when the doctor exits\n${body}\n`); return p; },
  };

  const selected = CHECKS.filter((c) => (!f.only || f.only.includes(c.id)) && !(f.skip || []).includes(c.id));
  const results = [];
  try {
    for (const c of selected) {
      let r;
      try { r = await c.run(ctx); } catch (e) { r = res(FAIL, `the check itself failed: ${first(e.stack || e)}`); }
      results.push({ id: c.id, optional: !!c.optional, ...r });
      if (!f.json) {
        console.log(`${r.status.padEnd(5)} ${c.id.padEnd(19)} ${r.summary}`);
        for (const d of r.details) console.log(`      ${d}`);
        if (r.fix && r.status === FAIL) console.log(`      fix: ${r.fix}`);
      }
    }
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }

  const counts = Object.fromEntries([PASS, FAIL, WARN, INFO].map((s) => [s, results.filter((r) => r.status === s).length]));
  const ok = counts.FAIL === 0;
  if (f.json) console.log(JSON.stringify({ tool: 'onboarding/voice-doctor.mjs', date: new Date().toISOString(), toolsDir: paths.toolsDir, config: { path: source, exists }, results, counts, ok }, null, 2));
  else console.log(`\n${ok ? 'GREEN' : 'RED'}  ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.WARN} warn, ${counts.INFO} info${f.only || f.skip ? ' (a subset of the checks)' : ''}`);
  return ok ? 0 : 1;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(`voice-doctor: ${e.stack || e}`); process.exit(2); });
