#!/usr/bin/env node
// calibrate-user.mjs: test a personal overlay on writing it was not built from.
//
// Splits your samples into tune and held-out exactly as profile-build.mjs did (by content hash), then runs the
// checks that act on what you send on every HELD-OUT sample:
//   the gate        prose-gate.mjs --det-only (the deterministic layer; no judge is ever called for a sample)
//   the send hook   the installed voice hook, given the sample as a synthetic send (it blocks or nudges; nothing is sent)
// Your own writing must come through clean: in standard strictness a held-out sample fails when the gate rejects it
// or the send hook blocks it, and in strict mode a nudge also counts. Every failure is reported with the check that
// fired and a suggested change. The target is 0.
//
// Optionally, --ai-drafts <dir> runs the same checks on AI drafts in your topics (you supply them, or generate them
// with your own model) and reports how many the checks catch. With --judge-drafts the gate may also send THOSE
// DRAFTS to the judges your config allows; your samples never go to a judge.
//
// Local only for samples: the network is switched off here and in the Node processes this starts. The output names
// samples by id (s01, s02, ...) and check, never by their text; --show-files and --show-spans add file names and
// matched text, for a terminal you run yourself. The report (paths.calibrationReport) records the overlay and engine
// hashes, so voice-doctor.mjs can tell when a later change makes it stale.
//
// Usage:
//   node calibrate-user.mjs [--overlay <file>] [--samples <dir> | --tune <dir> --held-out <dir>] [--strict]
//                           [--ai-drafts <dir> [--judge-drafts --drafter <model>]] [--no-hook] [--report <file> | --no-report]
//                           [--config <file>] [--tools <dir>] [--json] [--show-files] [--show-spans]
import './lib/local-only.mjs';
import { existsSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { readSamplesDir, splitSamples, sha256 } from './lib/samples.mjs';
import { enginePaths, loadOverlay, buildEngineWithOverlay, engineLoadsOverlay, runNode, runScorer, fileSha256, checkDetectorPin, lastLine } from './lib/engine.mjs';
import { resolveHook, runHook, sendPayload, sendToolName, hookBullets } from './lib/hook.mjs';

export const FLAGS = {
  '--overlay': 'overlay to test (default: the installed overlay, paths.overlay); a draft is tested in a temporary engine copy',
  '--samples': 'folder of your samples (default: paths.samplesDir), split into tune and held-out',
  '--tune': 'an explicit tune folder (use with --held-out instead of --samples)',
  '--held-out': 'an explicit held-out folder',
  '--strict': 'count nudges as failures too (default: config strictness.level)',
  '--ai-drafts': 'folder of AI drafts in your topics, for the recall check (default: none)',
  '--judge-drafts': 'also send the AI drafts (never your samples) to the judges your config allows; needs judges.aiDraftsToJudges',
  '--drafter': 'the model that wrote the AI drafts (prose-gate drafter name), required with --judge-drafts',
  '--no-hook': "don't run the send hook",
  '--report': 'where to write the report (default: paths.calibrationReport)',
  '--no-report': "don't write a report",
  '--config': 'config file (default: VOICE_CONFIG, else {claude}/voice/voice-config.json)',
  '--tools': 'the voice engine folder (default: paths.toolsDir)',
  '--json': 'print the report as JSON',
  '--show-files': 'print sample file names (for your own terminal)',
  '--show-spans': 'print the matched text (for your own terminal; never paste it into a chat)',
  '--help': 'this text',
};
export const EXIT = { 0: 'held-out samples: none failed', 1: 'one or more held-out samples failed (see the report)', 2: "couldn't run: usage, config, engine or overlay problem, or a gate ERROR" };
const VALUE_FLAGS = new Set(['--overlay', '--samples', '--tune', '--held-out', '--ai-drafts', '--drafter', '--report', '--config', '--tools']);

class UsageError extends Error {}
function parseArgs(argv) {
  const f = { hook: true, report: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); f[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i]; }
    else if (a === '--strict') f.strict = true;
    else if (a === '--judge-drafts') f.judgeDrafts = true;
    else if (a === '--no-hook') f.hook = false;
    else if (a === '--no-report') f.report = false;
    else if (a === '--json') f.json = true;
    else if (a === '--show-files') f.showFiles = true;
    else if (a === '--show-spans') f.showSpans = true;
    else if (a === '--help' || a === '-h') f.help = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  for (const [k, v] of Object.entries(f)) if (typeof v === 'string' && /^[a-z][a-z0-9+.-]*:\/\/|^\/\/|^\\\\/i.test(v) && k !== 'drafter') throw new UsageError(`--${k} looks like a remote path (${v}); calibrate-user only reads local files`);
  if ((f.tune && !f.heldOut) || (!f.tune && f.heldOut)) throw new UsageError('--tune and --held-out go together');
  if (f.samples && f.tune) throw new UsageError('use --samples, or --tune with --held-out, not both');
  if (f.judgeDrafts && !f.aiDrafts) throw new UsageError('--judge-drafts needs --ai-drafts');
  if (f.judgeDrafts && !f.drafter) throw new UsageError('--judge-drafts needs --drafter <model>');
  return f;
}

// ── suggestions: one per check id ───────────────────────────────────────────────────────────────────────────
export function suggestionFor(c, prefix = 'voice') {
  const id = c.check;
  if (id.startsWith('injection:')) return 'This reads like an instruction to a grader. The injection check rejects it on purpose and nothing exempts it. If you quote text like this, keep it out of drafts you gate.';
  if (id.startsWith('ai-evidence')) return `The detector's AI-evidence categories (${(c.categories || []).join(', ') || 'see the report'}) added up past strictness.detBar. Your overlay can't exempt detector categories. If this is how you write (placeholders such as [TODO], heavy bold), raise strictness.detBar a little and re-run, or leave that sample out if it isn't really yours.`;
  if (id.startsWith('pinned:')) return `${id.slice(7)} is in your overlay's VERDICT_STRUCT_TYPES, so it rejects on its own. Remove it from that list, or add the line to APPROVED_LINES.`;
  if (id.startsWith('gate-error')) return 'The gate failed on this sample. Run voice-doctor.mjs; the scorer or the gate is broken.';
  const t = id.replace(/^send-hook:/, '');
  if (t === 'hard-ban') return "The send hook's word list blocks this word or phrase, and your overlay can't exempt it. If you really use it, move it from the hook's block list to its nudge list in your copy of voice-tell-gate.py (BLOCK_WORDS / NUDGE_WORDS), or reword.";
  if (t === 'soft-ban') return "A dual-use word on the send hook's nudge list. It never blocks; in strict mode it counts. Move it to the hook's exempt list if it's your vocabulary.";
  if (t === `${prefix}-phrase` || t === 'phrase') return 'A phrase in your TEAM_PHRASES appears in your own writing. Remove it from TEAM_PHRASES, or add the full line to APPROVED_LINES.';
  if (t === `${prefix}-word` || t === 'word') return 'A word in your TEAM_WORDS appears in your own writing. Remove it from TEAM_WORDS.';
  if (t.startsWith(`${prefix}-cadence-sentence-length`) || t.startsWith('cadence-sentence-length')) return 'This sample sits outside REGISTER.sentenceMedian. Widen low or high a little.';
  if (t.startsWith(`${prefix}-cadence-contractions`) || t.startsWith('cadence-contractions')) return 'This sample uses fewer contractions than REGISTER.contractions.minPer1k. Lower it, or set contractions to null.';
  if (t.startsWith(`${prefix}-cadence-em-dash`) || t.startsWith('cadence-em-dash')) return 'This sample uses more em dashes than REGISTER.emDash.maxPer1k. Raise it, or set emDash to null.';
  if (/cadence/.test(t)) return 'A cadence check from the engine. It never blocks; in strict mode it counts. Tune it in the overlay that defines it.';
  if (c.level === 'block') return 'A critical structure check blocked this send. Add the line to APPROVED_LINES if your overlay defines the check; if the engine defines it, lower its severity there or reword.';
  return 'A softer check flagged this. It never blocks; in strict mode it counts.';
}

const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

export async function main(argv = process.argv.slice(2), env = process.env) {
  let f;
  try { f = parseArgs(argv); } catch (e) { console.error(`calibrate-user: ${e.message}`); return 2; }
  if (f.help) { console.log('usage: node calibrate-user.mjs [flags]\n' + Object.entries(FLAGS).map(([k, v]) => `  ${k.padEnd(14)} ${v}`).join('\n')); return 0; }
  const { config, errors } = loadConfig({ path: f.config, env, overrides: { toolsDir: f.tools } });
  if (errors.length) { console.error(`calibrate-user: the config can't be used:\n  ${errors.join('\n  ')}`); return 2; }
  const strict = f.strict || config.strictness.level === 'strict';
  const log = (...l) => { if (!f.json) for (const x of l) console.log(x); };

  // ── engine and overlay ──────────────────────────────────────────────────────────────────────────────────
  const tools = config.paths.toolsDir;
  const base = enginePaths(tools, env);
  for (const [k, p] of [['scorer', base.aiscore], ['gate', base.gate]]) {
    if (!existsSync(p)) { console.error(`calibrate-user: no ${k} at ${p}. Run voice-doctor.mjs; the engine is incomplete.`); return 2; }
  }
  const overlayPath = resolve(f.overlay || config.paths.overlay);
  const ov = await loadOverlay(overlayPath);
  if (!ov.ok) { console.error(`calibrate-user: ${ov.error}`); return 2; }
  // The engine reads this overlay directly only when it imports this very file. Otherwise a temporary engine copy
  // reads it. A matching probe is not enough: a draft copied from the installed overlay carries the same PROBE, and
  // taking the probe as proof scored the installed file instead of the draft (fixed 2026-10-02).
  const direct = engineLoadsOverlay(tools, overlayPath);
  const temp = direct ? null : buildEngineWithOverlay(tools, overlayPath);
  const engineDir = direct ? tools : temp.dir;
  const eng = enginePaths(engineDir, env);
  const cleanup = () => temp?.cleanup();
  try {
    if (ov.probe) {
      const p = runScorer(eng, `Probe sentence for calibration ${ov.probe}.`, { env });
      if (!p.ok) { console.error(`calibrate-user: the scorer fails: ${p.error}`); return 2; }
      if (!p.issues.some((i) => /-probe$/.test(i.type) && i.text === ov.probe)) { console.error(`calibrate-user: the engine at ${tools} doesn't read ${overlayPath} (its probe issue is missing).`); return 2; }
    }
    const prefix = ov.prefix || 'voice';

    // ── samples ───────────────────────────────────────────────────────────────────────────────────────────
    let tune, heldOut, fingerprint, splitMethod;
    try {
      if (f.tune) {
        tune = readSamplesDir(resolve(f.tune)).samples; heldOut = readSamplesDir(resolve(f.heldOut)).samples;
        fingerprint = sha256(heldOut.map((s) => s.sha).sort().join('\n')).slice(0, 16); splitMethod = 'explicit folders';
      } else {
        const all = readSamplesDir(resolve(f.samples || config.paths.samplesDir)).samples;
        if (all.length < 4) { console.error(`calibrate-user: ${all.length} usable samples; need at least 4.`); return 2; }
        const s = splitSamples(all, config.strictness.heldOutShare);
        ({ tune, heldOut, fingerprint } = s); splitMethod = 'sha256 rank';
      }
    } catch (e) { console.error(`calibrate-user: can't read samples: ${e.message}`); return 2; }
    if (!heldOut.length) { console.error('calibrate-user: the held-out set is empty.'); return 2; }
    heldOut.forEach((s, i) => { s.id = `h${String(i + 1).padStart(2, '0')}`; });
    const warnings = [];
    const draftFp = ov.mod.PROFILE?.split?.fingerprint;
    // With explicit folders the user picked the held-out set (for example fresh writing), so the split fingerprint can't
    // match and says nothing; only the user knows whether a held-out file was also a tune sample.
    if (splitMethod === 'explicit folders') warnings.push('Explicit folders: the held-out folder is tested as given. Keep the samples this overlay was tuned on out of it, or the result is in-sample.');
    else if (draftFp && draftFp !== fingerprint) warnings.push('The samples changed since this overlay was built (split fingerprint differs), so some held-out samples may be ones it was tuned on. Re-run profile-build.mjs to rebuild it from the current set.');
    if (tune.length + heldOut.length < config.strictness.minSamples) warnings.push(`Only ${tune.length + heldOut.length} samples; ${config.strictness.minSamples} or more give a held-out set worth trusting.`);

    // ── checks ────────────────────────────────────────────────────────────────────────────────────────────
    const hook = f.hook ? resolveHook(config) : null;
    if (f.hook && !hook.exists) warnings.push(`No send hook found (looked at the settings and ${config.paths.hook}); only the gate ran.`);
    const hookEnv = { ...env, VOICE_AISCORE: eng.aiscore, VOICE_NORMALIZE: existsSync(eng.normalizer) ? eng.normalizer : base.normalizer };
    const sendTool = sendToolName(config.sendTools[0], 'calibrate_user');
    let counted = {};
    try { counted = (await import(pathToFileURL(eng.evidence).href)).COUNTED || {}; } catch { /* older engine: no category table */ }

    let judgePanel = null;
    if (f.judgeDrafts) {
      const j = config.judges;
      if (!j.aiDraftsToJudges) { console.error('calibrate-user: --judge-drafts needs judges.aiDraftsToJudges: true in the config.'); return 2; }
      const allowed = new Map(j.allowed.map((a) => [a.name, a.lab]));
      let G;
      try { G = await import(pathToFileURL(eng.gate).href); } catch (e) { console.error(`calibrate-user: can't load the gate: ${e.message}`); return 2; }
      const panel = j.mode === 'single' ? [j.allowed[0].name] : G.pickJudge(f.drafter, 'consensus');
      const bad = panel.filter((n) => !allowed.has(n) || allowed.get(n) === j.drafterLab || G.JUDGES[n]?.vendor === j.drafterLab);
      if (bad.length || !panel.length) { console.error(`calibrate-user: the gate would use ${panel.join(', ') || 'no judge'} for drafter ${f.drafter}; ${bad.length ? `${bad.join(', ')} isn't allowed by judges.allowed or shares the drafter's lab` : 'none is available'}.`); return 2; }
      // The gate's judge backend reads OPENCODE_BIN; a command set in judges.allowed is passed on when the environment has none.
      const command = panel.map((n) => j.allowed.find((a) => a.name === n)?.command).find(Boolean);
      judgePanel = { judges: panel, judgeArg: j.mode === 'single' ? panel[0] : 'consensus', env: command && !env.OPENCODE_BIN ? { ...env, OPENCODE_BIN: command } : env };
    }

    // The only place gate arguments are built. A sample is always --det-only: no judge sees your writing.
    const gateArgs = (kind) => {
      const a = ['-', '--json', '--det-bar', String(config.strictness.detBar), '--bar', String(config.strictness.judgeBar), '--register', ov.mod.REGISTER?.judgeRegister === 'external' ? 'external' : 'internal'];
      if (kind === 'draft' && judgePanel) a.push('--drafter', f.drafter, '--judge', judgePanel.judgeArg);
      else a.push('--det-only');
      if (kind === 'sample' && !a.includes('--det-only')) throw new Error('internal: a sample must never reach a judge');
      return a;
    };

    const evaluate = (text, kind) => {
      const fired = [];
      // A sample's gate run stays inside the local-only guard. Only an AI draft headed for the allowed judges runs
      // without it, because a judge backend has to reach its model.
      const toJudges = kind === 'draft' && !!judgePanel;
      const g = runNode(eng.gate, gateArgs(kind), text, { env: toJudges ? judgePanel.env : env, timeout: toJudges ? 900000 : 180000, local: !toJudges });
      let gj = null;
      try { gj = JSON.parse(g.stdout); } catch { /* handled below */ }
      const verdict = gj?.verdict || 'ERROR';
      if (verdict === 'ERROR') fired.push({ source: 'gate', check: 'gate-error', level: 'error', detail: gj?.error || lastLine(g.stderr) || `exit ${g.code}` });
      if (gj?.deterministic) {
        const d = gj.deterministic;
        for (const t of d.injection?.types || []) fired.push({ source: 'gate', check: `injection:${t}`, level: 'block', spans: d.injection.spans });
        if (d.adjustedScore >= config.strictness.detBar) {
          const s = runScorer(eng, text, { env });
          const categories = s.ok ? Object.keys(s.json.issueTypes || {}).filter((k) => k in counted) : [];
          fired.push({ source: 'gate', check: 'ai-evidence', level: 'block', score: d.adjustedScore, categories });
        }
        for (const t of d.criticalStruct?.types || []) fired.push({ source: 'gate', check: `pinned:${t}`, level: 'block', spans: d.criticalStruct.spans });
        for (const m of d.mustFix || []) { const k = m.indexOf(': '); fired.push({ source: 'gate', check: `must-fix:${k > 0 ? m.slice(0, k) : m}`, level: 'nudge', spans: k > 0 ? [m.slice(k + 2)] : [] }); }
      }
      if (gj?.gestaltReject) fired.push({ source: 'judges', check: 'judge-panel', level: 'block', detail: `mean AI-ness ${gj.gestalt?.ai_ness}` });
      let hookDecision = null;
      if (hook?.exists) {
        const h = runHook({ command: hook.command, hookPath: hook.hookPath, payload: sendPayload(text, sendTool), env: hookEnv });
        hookDecision = h.decision;
        const level = h.decision === 'deny' ? 'block' : 'nudge';
        if (h.decision === 'deny' || h.decision === 'context') {
          const bs = hookBullets(h.message);
          if (!bs.length) fired.push({ source: 'send-hook', check: `send-hook:${h.decision === 'deny' ? 'blocked' : 'nudged'}`, level, detail: h.message.split('\n')[0].slice(0, 200) });
          for (const b of bs) fired.push({ source: 'send-hook', check: `send-hook:${b.type}`, level, spans: [b.text] });
          if (/couldn't run its scorer/.test(h.message)) fired.push({ source: 'send-hook', check: 'gate-error:hook-scorer', level: 'error', detail: h.message.split('\n')[0].slice(0, 200) });
        } else if (h.decision === 'other') fired.push({ source: 'send-hook', check: 'gate-error:hook', level: 'error', detail: `exit ${h.code}: ${lastLine(h.stderr)}` });
      }
      const blocked = verdict === 'REJECT' || hookDecision === 'deny';
      const nudged = fired.some((x) => x.level === 'nudge');
      const errored = fired.some((x) => x.level === 'error');
      return { verdict, hookDecision, fired, blocked, nudged, errored, fails: blocked || (strict && nudged) };
    };

    log(`calibrate-user ${new Date().toISOString().slice(0, 10)}`,
      `  engine    ${tools}${direct ? '' : ' (temporary copy reading the overlay under test)'}`,
      `  overlay   ${overlayPath} (${ov.reviewed === false ? 'draft, not reviewed yet' : ov.reviewed ? 'reviewed' : 'no REVIEWED flag'}, sha256 ${ov.sha256.slice(0, 12)})`,
      `  samples   ${tune.length} tune, ${heldOut.length} held out (${splitMethod}, fingerprint ${fingerprint})`,
      `  checks    gate --det-only (det-bar ${config.strictness.detBar})${hook?.exists ? ` + send hook ${hook.hookPath}` : ''}; strictness ${strict ? 'strict (nudges count)' : 'standard'}`,
      ...warnings.map((w) => `  warning   ${w}`), '');

    if (!f.json) console.error(`calibrate-user: scoring ${heldOut.length} held-out samples with the gate and the send hook (about a second each)...`);
    const items = heldOut.map((s) => ({ s, r: evaluate(s.text, 'sample') }));
    const failed = items.filter((x) => x.r.fails);
    const nudgedOnly = items.filter((x) => !x.r.fails && x.r.nudged);
    const errored = items.filter((x) => x.r.errored);
    const describe = (x) => {
      const head = `  ${x.s.id}${f.showFiles ? ` (${x.s.file})` : ''}  ${x.r.blocked ? 'FAIL' : x.r.fails ? 'FAIL (strict)' : 'nudge'}`;
      const lines = [head];
      for (const c of x.r.fired) {
        lines.push(`      ${c.source} ${c.check}${c.level === 'nudge' ? ' (nudge)' : c.level === 'error' ? ' (error)' : ''}${f.showSpans && c.spans?.length ? `: ${c.spans.map((t) => JSON.stringify(t)).join(', ')}` : ''}`);
        if (c.level !== 'error') lines.push(`        suggestion: ${suggestionFor(c, prefix)}`);
        else lines.push(`        ${c.detail}`);
      }
      return lines;
    };
    log(`HELD-OUT  ${heldOut.length} samples: ${failed.length} failed, ${nudgedOnly.length} nudged only${errored.length ? `, ${errored.length} with a check error` : ''}   ${failed.length || errored.length ? 'FAIL' : 'PASS'}`);
    for (const x of [...failed, ...nudgedOnly]) log(...describe(x));
    log('');

    // ── AI drafts (optional) ──────────────────────────────────────────────────────────────────────────────
    let drafts = null;
    if (f.aiDrafts) {
      const list = readSamplesDir(resolve(f.aiDrafts)).samples;
      list.forEach((s, i) => { s.id = `d${String(i + 1).padStart(2, '0')}`; });
      const res = list.map((s) => ({ s, r: evaluate(s.text, 'draft') }));
      const caught = res.filter((x) => x.r.blocked).length, flagged = res.filter((x) => x.r.blocked || x.r.nudged).length;
      drafts = { n: list.length, blocked: caught, flaggedAny: flagged, recallBlocked: list.length ? Math.round((1000 * caught) / list.length) / 10 : null, recallAny: list.length ? Math.round((1000 * flagged) / list.length) / 10 : null, judges: judgePanel?.judges || [], items: res.map((x) => ({ id: x.s.id, file: x.s.file, verdict: x.r.verdict, hook: x.r.hookDecision, checks: x.r.fired.map((c) => c.check) })) };
      log(`AI DRAFTS  ${list.length}: ${caught} blocked (${drafts.recallBlocked}%), ${flagged} flagged at all (${drafts.recallAny}%)${judgePanel ? `; judges ${judgePanel.judges.join(' + ')}` : '; deterministic checks only'}`);
      if (!judgePanel) log('  The deterministic layer is built to never flag your own writing, so it catches few drafts by design; the judges add recall.');
      log('');
    }

    // ── report ────────────────────────────────────────────────────────────────────────────────────────────
    let pin = null;
    try { pin = existsSync(base.detector) ? checkDetectorPin(base.detector) : null; } catch { pin = null; }
    const report = {
      tool: 'onboarding/calibrate-user.mjs', version: 1, createdAt: new Date().toISOString(),
      overlay: { path: overlayPath, sha256: ov.sha256, reviewed: ov.reviewed },
      engine: { toolsDir: tools, aiscoreSha256: fileSha256(base.aiscore), gateSha256: fileSha256(base.gate), detectorPinOk: pin ? pin.ok : null, viaTemporaryCopy: !direct },
      hook: hook?.exists ? { path: hook.hookPath, sha256: fileSha256(hook.hookPath), wired: !!hook.command } : null,
      split: { method: splitMethod, heldOutShare: config.strictness.heldOutShare, fingerprint, tune: tune.length, heldOut: heldOut.length },
      strictness: { level: strict ? 'strict' : 'standard', detBar: config.strictness.detBar },
      heldOut: {
        n: heldOut.length, failed: failed.length, nudgedOnly: nudgedOnly.length, errors: errored.length,
        items: items.filter((x) => x.r.fired.length).map((x) => ({ id: x.s.id, file: x.s.file, verdict: x.r.verdict, hook: x.r.hookDecision, fails: x.r.fails, checks: x.r.fired.map((c) => ({ source: c.source, check: c.check, level: c.level, suggestion: c.level === 'error' ? null : suggestionFor(c, prefix) })) })),
      },
      aiDrafts: drafts, warnings,
    };
    const reportPath = f.report === true || f.report === undefined ? config.paths.calibrationReport : f.report === false ? null : resolve(f.report);
    if (reportPath) { mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); log(`report: ${reportPath}`); }
    if (f.json) console.log(JSON.stringify(report, null, 2));
    if (errored.length) return 2;
    return failed.length ? 1 : 0;
  } finally { cleanup(); }
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(`calibrate-user: ${e.stack || e}`); process.exit(2); });
