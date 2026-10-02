#!/usr/bin/env node
// merge-hooks.mjs: wire the voice hook into Claude Code settings the way voice-doctor.mjs checks it.
//
// Reads the settings file (paths.settings[0] in the config, or --settings), removes every entry that runs the voice
// hook (nested or flat), adds the block voice-doctor --print-hooks prints for this config, and writes the file after
// copying the original to <file>.bak-<timestamp>. Every other hook, and every other setting, is kept as it was. With
// --dry-run it prints the hooks section it would write and changes nothing.
//
// Usage: node merge-hooks.mjs [--settings <file>] [--config <file>] [--dry-run]
// Exit: 0 written or already wired, 1 refused (settings file isn't valid JSON, or the config can't be used), 2 usage.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { hooksBlock } from './voice-doctor.mjs';

const runsHook = (cmd, name) => typeof cmd === 'string' && cmd.includes(name);

// The settings object with every voice-hook entry removed and `block` added. Pure; exported for the tests.
export function mergeHooks(settings, block, hookName) {
  const out = { ...settings, hooks: { ...(settings.hooks || {}) } };
  for (const [event, entries] of Object.entries(out.hooks)) {
    if (!Array.isArray(entries)) continue;
    out.hooks[event] = entries.flatMap((e) => {
      if (!e || typeof e !== 'object') return [e];
      if (runsHook(e.command, hookName)) return [];
      if (!Array.isArray(e.hooks)) return [e];
      const kept = e.hooks.filter((h) => !(h && runsHook(h.command, hookName)));
      return kept.length ? [{ ...e, hooks: kept }] : [];
    });
  }
  for (const [event, add] of Object.entries(block.hooks)) out.hooks[event] = [...(out.hooks[event] || []), ...add];
  return out;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--settings' || a === '--config') { if (i + 1 >= argv.length) { console.error(`merge-hooks: ${a} needs a value`); return 2; } f[a.slice(2)] = argv[++i]; }
    else if (a === '--dry-run') f.dryRun = true;
    else if (a === '--help' || a === '-h') { console.log('usage: node merge-hooks.mjs [--settings <file>] [--config <file>] [--dry-run]'); return 0; }
    else { console.error(`merge-hooks: unknown argument ${a}`); return 2; }
  }
  const { config, errors } = loadConfig({ path: f.config, env, overrides: { settings: f.settings ? [f.settings] : undefined } });
  if (errors.length) { console.error(`merge-hooks: the config can't be used:\n  ${errors.join('\n  ')}`); return 1; }
  const file = resolve(config.paths.settings[0]);
  let settings = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`merge-hooks: ${file} is not valid JSON (${e.message}); nothing written`); return 1; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { console.error(`merge-hooks: ${file} is not a JSON object; nothing written`); return 1; }
  }
  const block = hooksBlock(config, env);
  const merged = mergeHooks(settings, block, basename(config.paths.hook));
  if (JSON.stringify(merged) === JSON.stringify(settings)) { console.log(`merge-hooks: ${file} already wires the voice hook this way; nothing written`); return 0; }
  if (f.dryRun) { console.log(JSON.stringify({ hooks: merged.hooks }, null, 2)); return 0; }
  mkdirSync(dirname(file), { recursive: true });
  let backup = null;
  if (existsSync(file)) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    copyFileSync(file, backup);
  }
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  console.log(`merge-hooks: wired the voice hook in ${file}${backup ? ` (the original is ${backup})` : ''}`);
  console.log(`  PreToolUse  ${block.hooks.PreToolUse[0].matcher}`);
  console.log(`  PostToolUse ${block.hooks.PostToolUse[0].matcher}`);
  return 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exit(main());
