#!/usr/bin/env node
// profile-build.mjs: draft a personal voice overlay from your own writing samples.
//
// Reads your samples (a folder, or stdin cut at "---8<---" lines), keeps a held-out share aside for
// calibrate-user.mjs, measures your habits on the rest (sentence length distribution, contractions, very short
// sentences, dash and ellipsis use, recurring phrases), runs the installed checks on them to find lines you
// really write that a check flags, and writes ONE file: a draft overlay rendered from
// templates/voice-overlay.template.mjs. You review the draft before it is used; it starts with REVIEWED = false.
//
// Local only. The network is switched off in this process and in the Node processes it starts (lib/local-only.mjs).
// Samples are never sent to a model, a judge or a web tool, and never printed: the output is counts and statistics.
// The only file written is the --out path (and its parent folders if they don't exist yet).
//
// Usage:
//   node profile-build.mjs [--samples <dir> | --samples -] [--out <file.mjs>] [--force]
//                          [--config <file>] [--tools <dir>] [--no-scorer] [--no-hook] [--sep <line>] [--json]
import './lib/local-only.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { readSamplesDir, readSamplesText, splitSamples, DEFAULT_SEP, sha256 } from './lib/samples.mjs';
import { profileOf, registerFrom, recurringPhrases, approvedCandidates } from './lib/measure.mjs';
import { renderOverlay, newProbe, TEMPLATE_PATH } from './lib/render.mjs';
import { enginePaths } from './lib/engine.mjs';
import { resolveHook, sendToolName } from './lib/hook.mjs';
import { makeFlagger } from './lib/flags.mjs';

export const FLAGS = {
  '--samples': 'folder of samples, or - for stdin (default: paths.samplesDir)',
  '--out': 'draft overlay to write, a .mjs file (default: paths.draftOverlay); never the installed overlay',
  '--force': 'overwrite an existing draft',
  '--config': 'config file (default: VOICE_CONFIG, else {claude}/voice/voice-config.json)',
  '--tools': 'the voice engine folder (default: paths.toolsDir)',
  '--no-scorer': "don't run the scorer on the samples (approved-line candidates then come from the detector and hook only)",
  '--no-hook': "don't run the send hook on the samples",
  '--sep': `separator line for stdin samples (default ${DEFAULT_SEP})`,
  '--json': 'print the summary as JSON',
  '--help': 'this text',
};
export const EXIT = { 0: 'draft written', 1: 'refused or usage error (nothing written)', 2: 'not enough samples, or the draft failed to load (nothing written)' };
const VALUE_FLAGS = new Set(['--samples', '--out', '--config', '--tools', '--sep']);
export const MIN_TO_RUN = 4;

function parseArgs(argv) {
  const f = { force: false, scorer: true, hook: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); f[a.slice(2)] = argv[++i]; }
    else if (a === '--force') f.force = true;
    else if (a === '--no-scorer') f.scorer = false;
    else if (a === '--no-hook') f.hook = false;
    else if (a === '--json') f.json = true;
    else if (a === '--help' || a === '-h') f.help = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  for (const k of ['samples', 'out', 'config', 'tools']) {
    if (f[k] && /^[a-z][a-z0-9+.-]*:\/\//i.test(f[k])) throw new UsageError(`--${k} looks like a URL (${f[k]}); profile-build only reads and writes local files`);
    if (f[k] && /^\/\/|^\\\\/.test(f[k])) throw new UsageError(`--${k} looks like a network path (${f[k]}); profile-build only reads and writes local files`);
  }
  return f;
}
class UsageError extends Error {}
const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const say = (json, ...lines) => { if (!json) for (const l of lines) console.log(l); };

export async function main(argv = process.argv.slice(2), env = process.env) {
  let f;
  try { f = parseArgs(argv); } catch (e) { console.error(`profile-build: ${e.message}`); return 1; }
  if (f.help) { console.log('usage: node profile-build.mjs [flags]\n' + Object.entries(FLAGS).map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n')); return 0; }

  const { config, errors } = loadConfig({ path: f.config, env, overrides: { toolsDir: f.tools } });
  if (errors.length) { console.error(`profile-build: the config can't be used:\n  ${errors.join('\n  ')}`); return 1; }

  const out = resolve(f.out || config.paths.draftOverlay);
  if (!out.endsWith('.mjs')) { console.error(`profile-build: --out must be a .mjs file (got ${out})`); return 1; }
  if (realOr(out) === realOr(config.paths.overlay)) {
    console.error(`profile-build: ${out} is the installed overlay. Write a draft, review it, then install it (see /voice-setup).`);
    return 1;
  }
  if (existsSync(out) && !f.force) { console.error(`profile-build: ${out} exists; pass --force to overwrite the draft`); return 1; }

  // ── samples ────────────────────────────────────────────────────────────────────────────────────────────
  let read;
  try {
    if (f.samples === '-') read = readSamplesText(readFileSync(0, 'utf8'), f.sep || DEFAULT_SEP);
    else read = readSamplesDir(resolve(f.samples || config.paths.samplesDir));
  } catch (e) { console.error(`profile-build: can't read samples: ${e.message}`); return 2; }
  const { samples, skipped } = read;
  if (samples.length < MIN_TO_RUN) {
    console.error(`profile-build: ${samples.length} usable samples; need at least ${MIN_TO_RUN} (${config.strictness.minSamples} or more is better). Samples shorter than 3 words and duplicates are skipped.`);
    return 2;
  }
  const split = splitSamples(samples, config.strictness.heldOutShare);
  const tuneTexts = split.tune.map((s) => s.text);

  // ── measure (the template's own definitions) ──────────────────────────────────────────────────────────
  const T = await import(TEMPLATE_PATH);
  const profile = profileOf(tuneTexts, T.measureDoc, T.median);
  const { register, notes: regNotes } = registerFrom(profile);
  const recurring = recurringPhrases(tuneTexts, T.sentences);

  // ── what the installed checks flag in the tune samples ────────────────────────────────────────────────
  const paths = enginePaths(config.paths.toolsDir, env);
  const hook = f.hook ? resolveHook(config) : null;
  const { flagger, used, errors: flagErrors } = makeFlagger({ paths, hook, sendTool: sendToolName(config.sendTools[0], 'profile_build'), useScorer: f.scorer, useHook: f.hook, env });
  const flags = tuneTexts.map((t) => flagger(t));
  const candidates = approvedCandidates(tuneTexts, flags);

  const notes = [
    `Built ${new Date().toISOString().slice(0, 10)} from ${split.tune.length} tune samples; ${split.heldOut.length} more are held out for calibrate-user.mjs.`,
    ...(samples.length < config.strictness.minSamples ? [`Only ${samples.length} samples. ${config.strictness.minSamples} or more give a held-out set worth trusting.`] : []),
    ...regNotes,
    candidates.length
      ? `APPROVED_LINES lists ${candidates.length} lines that appear in 2 or more of your tune samples and that a check flagged. Keep only lines you really write. This overlay's checks skip them; the detector and the send hook's word list don't read the list.`
      : 'No line was flagged in 2 or more tune samples, so APPROVED_LINES is empty. Add a line here if a check keeps flagging something you really write.',
    'TEAM_WORDS and TEAM_PHRASES start empty. Add words you never use and phrases you would never write; a TEAM_PHRASES hit is critical, which the send hook blocks.',
    `Checks run on the samples: detector ${used.detector ? 'yes' : 'no'}, scorer ${used.scorer ? 'yes' : 'no'}, send hook ${used.hook ? 'yes' : 'no'}.`,
    ...(flagErrors.length ? [`Some checks failed on some samples (${[...new Set(flagErrors.map((e) => e.split(':')[0]))].join(', ')}); run voice-doctor.mjs.`] : []),
  ];

  const PROFILE = {
    builtAt: new Date().toISOString(),
    tool: 'onboarding/profile-build.mjs',
    templateSha256: sha256(readFileSync(TEMPLATE_PATH, 'utf8')).slice(0, 16),
    samples: { read: samples.length + skipped.length, used: samples.length, skipped: skipped.length, tune: split.tune.length, heldOut: split.heldOut.length },
    split: { method: 'sha256 rank', heldOutShare: split.share, fingerprint: split.fingerprint },
    stats: profile,
    recurringPhrases: recurring,
  };
  const src = renderOverlay({
    REVIEWED: false, ISSUE_PREFIX: 'voice', PROBE: newProbe(), APPROVED_LINES: candidates, TEAM_WORDS: [], TEAM_PHRASES: [],
    REGISTER: register, VERDICT_STRUCT_TYPES: [], BASE_OVERLAY: config.paths.baseOverlay || null, PROFILE, NOTES: notes,
  });
  // Load the rendered module before writing it, so a broken draft is never left on disk.
  try {
    const m = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`);
    if (!Array.isArray(m.scanVoice('A short check that the draft runs.'))) throw new Error('scanVoice did not return a list');
  } catch (e) { console.error(`profile-build: the rendered draft doesn't load (${e.message}); nothing written`); return 2; }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, src, { flag: f.force ? 'w' : 'wx' });

  const summary = {
    out, samples: PROFILE.samples, split: PROFILE.split,
    sentenceWords: { median: profile.sentenceWords.median, p10: profile.sentenceWords.p10, p90: profile.sentenceWords.p90 },
    per1kWords: profile.per1kWords, approvedLineCandidates: candidates.length, recurringPhrases: recurring.length,
    register: { sentenceMedian: !!register.sentenceMedian, contractions: !!register.contractions, emDash: !!register.emDash },
    checksRun: used,
  };
  if (f.json) console.log(JSON.stringify(summary, null, 2));
  say(f.json,
    'profile-build: draft overlay written (local only; no sample text printed)',
    `  out        ${out}`,
    `  samples    ${samples.length} used (${skipped.length} skipped): ${split.tune.length} tune, ${split.heldOut.length} held out (fingerprint ${split.fingerprint})`,
    `  sentences  median ${profile.sentenceWords.median} words, 10th to 90th percentile ${profile.sentenceWords.p10} to ${profile.sentenceWords.p90}; ${profile.sentenceWords.shareUpTo4}% are 4 words or fewer`,
    `  per 1,000  contractions ${profile.per1kWords.contractions}, em dashes ${profile.per1kWords.emDash}, ellipses ${profile.per1kWords.ellipsis}, semicolons ${profile.per1kWords.semicolons}`,
    `  register   sentence-length band ${register.sentenceMedian ? 'on' : 'off'}, contraction floor ${register.contractions ? 'on' : 'off'}, em-dash ceiling ${register.emDash ? 'on' : 'off'}`,
    `  approved   ${candidates.length} candidate lines; ${recurring.length} recurring phrases recorded in PROFILE`,
    '',
    'next: open the draft in your editor (not in a chat), keep what is yours, change false to true inside',
    '/*@REVIEWED*/false/*@END*/ (keep the markers), then run',
    `  node ${fileURLToPath(new URL('./calibrate-user.mjs', import.meta.url))} --overlay ${out} --no-report`,
  );
  return 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(`profile-build: ${e.stack || e}`); process.exit(2); });
