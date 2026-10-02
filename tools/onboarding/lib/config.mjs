// config.mjs: load, default, validate and resolve the onboarding config (voice-config.json).
//
// Lookup order: an explicit path (--config), then VOICE_CONFIG, then {claude}/voice/voice-config.json. A missing
// file is not an error: every property has a default in voice-config.schema.json, which is the single source of
// the defaults. A file that exists but doesn't parse or validate is an error.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, applyDefaults } from './schema-lite.mjs';

export const ONBOARDING_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALLED_TOOLS_DIR = resolve(ONBOARDING_DIR, '..');
export const SCHEMA_PATH = join(ONBOARDING_DIR, 'voice-config.schema.json');
export const EXAMPLE_PATH = join(ONBOARDING_DIR, 'voice-config.example.json');
export const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const homeOf = (env) => env.HOME || homedir();
export const claudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homeOf(env), '.claude');
export const defaultConfigPath = (env = process.env) => env.VOICE_CONFIG || join(claudeDir(env), 'voice', 'voice-config.json');

// Expand ~, $HOME and the {claude} {tools} {toolsDir} {voiceDir} tokens.
export function expandPath(p, vars = {}, env = process.env) {
  if (p == null) return p;
  let s = String(p);
  const home = homeOf(env);
  if (s === '~' || s.startsWith('~/')) s = home + s.slice(1);
  s = s.replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);
  const table = { claude: claudeDir(env), tools: INSTALLED_TOOLS_DIR, ...vars };
  s = s.replace(/\{(claude|tools|toolsDir|voiceDir)\}/g, (m, k) => (table[k] !== undefined ? table[k] : m));
  return resolve(s);
}

// Rules JSON Schema can't express. Returns a list of messages.
export function crossFieldErrors(cfg) {
  const errs = [];
  const j = cfg.judges || {};
  const drafter = String(j.drafterLab || '').toLowerCase();
  for (const a of j.allowed || []) {
    if (drafter && drafter !== 'unknown' && String(a.lab).toLowerCase() === drafter) {
      errs.push(`$.judges.allowed: judge "${a.name}" is from ${a.lab}, the drafter's lab; a judge never comes from the drafter's lab`);
    }
  }
  if (j.aiDraftsToJudges && !(j.allowed || []).length) errs.push('$.judges.aiDraftsToJudges is true but judges.allowed is empty');
  if ((j.mode === 'single' || j.mode === 'consensus') && !(j.allowed || []).length) errs.push(`$.judges.mode is "${j.mode}" but judges.allowed is empty`);
  if (j.mode === 'consensus' && new Set((j.allowed || []).map((a) => a.lab)).size < 2 && (j.allowed || []).length) {
    errs.push('$.judges.mode is "consensus" but judges.allowed has fewer than two labs');
  }
  return errs;
}

// Resolve every path in the config to an absolute path. Returns a new object.
export function resolvePaths(cfg, env = process.env) {
  const p = cfg.paths;
  const toolsDir = expandPath(p.toolsDir, {}, env);
  const voiceDir = expandPath(p.voiceDir, { toolsDir }, env);
  const vars = { toolsDir, voiceDir };
  const one = (v) => (v == null ? null : expandPath(v, vars, env));
  const settings = (Array.isArray(p.settings) ? p.settings : [p.settings]).map(one);
  return {
    ...cfg,
    paths: {
      toolsDir, voiceDir, overlay: one(p.overlay), draftOverlay: one(p.draftOverlay), baseOverlay: one(p.baseOverlay),
      samplesDir: one(p.samplesDir), aiDraftsDir: one(p.aiDraftsDir), calibrationReport: one(p.calibrationReport),
      settings, hook: one(p.hook),
    },
  };
}

// loadConfig -> { config (resolved), raw, source, exists, errors }. errors is non-empty when the file exists but
// can't be used; config is then the defaults, so a caller can still report other checks.
// overrides: command-line paths ({ toolsDir, settings, hook, overlay }), applied before the tokens are resolved, so
// a default such as {toolsDir}/voice-overlay.mjs follows a --tools override.
export function loadConfig({ path, env = process.env, overrides = {} } = {}) {
  const source = path ? resolve(path) : defaultConfigPath(env);
  let raw = {}, errors = [], exists = existsSync(source);
  if (exists) {
    try { raw = JSON.parse(readFileSync(source, 'utf8')); }
    catch (e) { errors.push(`${source}: not valid JSON (${e.message})`); raw = {}; }
  } else if (path) {
    errors.push(`${source}: no such file`);
  }
  if (!errors.length) errors = [...validate(SCHEMA, raw), ...crossFieldErrors(applyDefaults(SCHEMA, raw))];
  const merged = applyDefaults(SCHEMA, errors.length ? {} : raw);
  for (const k of ['toolsDir', 'settings', 'hook', 'overlay']) if (overrides[k]) merged.paths[k] = overrides[k];
  return { config: resolvePaths(merged, env), raw, source, exists, errors };
}
