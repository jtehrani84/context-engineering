#!/usr/bin/env node
// merge-hooks.mjs: wire the voice hooks into Claude Code settings the way voice-doctor.mjs checks them.
//
// Reads the settings file (paths.settings[0] in the config, or --settings), removes every entry that runs the voice
// hook or the draft gate (nested or flat, on any event), adds the block voice-doctor --print-hooks prints for this
// config (the send hook on PreToolUse and PostToolUse, the draft gate voice-draft-gate.py on Stop), and writes the
// file after copying the original to <file>.bak-<timestamp>. Every other hook, and every other setting, is kept as it
// was (byte for byte when the file's own layout can be reproduced; otherwise the file is rewritten as 2-space JSON and
// merge-hooks says so); a re-run with nothing to change writes nothing. A timeout set on an old voice entry is carried
// to the new one, and tool names an old exact-name send matcher listed that the new matcher doesn't cover are printed.
// With --dry-run it prints the hooks section it would write and changes nothing. With --remove it takes every voice
// entry out (the send hook and the draft gate, on any event) and adds nothing, the same way: backup first, everything
// else kept.
//
// CHANGE NOTE 2026-10-03 (review of the hook holes, N3). A Stop hook that runs python3 on a missing file exits 2, and
// exit 2 on Stop blocks the stop, so a draft-gate entry whose script isn't installed could refuse every reply and trap
// the session. (Claude Code 2.1.286 happens to read python3's and sh's missing-file errors as non-blocking: in a
// headless check on 2026-10-03 the stop went through with "Stop hook error occurred", while the same exit 2 with other
// stderr blocked. Nothing here depends on that.) Two layers now:
//   (a) When voice-draft-gate.py isn't next to the send hook (the path the Stop entry would run), merge-hooks doesn't
//       add the Stop entry. It prints "skipped the Stop entry" on stderr with the cp that installs the script, still
//       wires the send hook, removes any old draft-gate entry, and exits 0 (so a setup script that runs it goes on, and
//       the send hook, which fails closed, is wired either way). The doctor's draft-gate-wiring check fails until the
//       script is installed and merge-hooks runs again.
//   (b) The Stop command it writes checks for the script first (lib/hook.mjs draftGateCommand): if the file later
//       disappears, the reply ends with a "draft not checked" note instead of being blocked. The doctor warns about a
//       Stop command without that guard.
//
// Usage: node merge-hooks.mjs [--settings <file>] [--config <file>] [--dry-run] [--remove]
// Exit: 0 written or already wired (also when the Stop entry was skipped because the draft gate script isn't installed;
// the warning is on stderr), 1 refused (settings file isn't valid JSON, or the config can't be used), 2 usage.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { hooksBlock } from './voice-doctor.mjs';
import { DRAFT_HOOK_NAME, matcherMatches, matcherKind } from './lib/hook.mjs';

const runsHook = (cmd, names) => typeof cmd === 'string' && names.some((n) => cmd.includes(n));

// How a settings file is written, so the merged file keeps its bytes outside the voice entries. Claude Code writes
// settings.json the Go way (<, >, & and U+2028/U+2029 as \u escapes, 2-space indent, no final newline); editors and
// other tools write plain JSON with 2 or 4 spaces or tabs. styleOf() returns the first style that reproduces `text`
// exactly, else the default (2 spaces, final newline), with exact: false.
const GO_ESCAPE = /[<>&\u2028\u2029]/g;
const goEscape = (s) => s.replace(GO_ESCAPE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export function styleOf(text, value) {
  for (const indent of [2, 4, '\t']) for (const escape of [false, true]) for (const newline of ['\n', '']) {
    const style = { indent, escape, newline };
    if (formatJson(value, style) === text) return { ...style, exact: true };
  }
  return { indent: 2, escape: false, newline: '\n', exact: false };
}
export function formatJson(value, { indent = 2, escape = false, newline = '\n' } = {}) {
  const out = JSON.stringify(value, null, indent);
  return (escape ? goEscape(out) : out) + newline;
}

// The settings object with every entry that runs one of `hookNames` (a name or a list) removed and `block` added.
// Pure; exported for the tests.
export function mergeHooks(settings, block, hookNames) {
  const hookName = [].concat(hookNames);
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

// Every voice entry in the settings: [{ event, name, matcher, timeout }] (name = which script it runs).
export function voiceEntries(settings, hookNames) {
  const names = [].concat(hookNames), out = [];
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const one = (cmd, timeout) => { const name = names.find((n) => typeof cmd === 'string' && cmd.includes(n)); if (name) out.push({ event, name, matcher: e.matcher ?? '', timeout: timeout ?? null }); };
      one(e.command, e.timeout);
      if (Array.isArray(e.hooks)) for (const h of e.hooks) if (h) one(h.command, h.timeout);
    }
  }
  return out;
}

// The block with each old entry's timeout carried over (same event, same script), and the tool names an old
// exact-name matcher listed on that event that the new matcher covers under no MCP server.
export function carryOver(block, old) {
  const out = { hooks: {} }, dropped = [];
  for (const [event, entries] of Object.entries(block.hooks)) {
    out.hooks[event] = entries.map((e) => ({ ...e, hooks: e.hooks.map((h) => {
      const prev = old.find((o) => o.event === event && h.command.includes(o.name) && Number.isFinite(o.timeout));
      return prev ? { ...h, timeout: prev.timeout } : h;
    }) }));
    for (const o of old.filter((o) => o.event === event && matcherKind(o.matcher) === 'exact names')) {
      for (const n of o.matcher.split(/[|,]/).map((x) => x.trim()).filter(Boolean)) {
        const covered = entries.some((e) => matcherMatches(e.matcher, n) || matcherMatches(e.matcher, `mcp__any__${n}`));
        if (!covered && !dropped.includes(`${event} ${n}`)) dropped.push(`${event} ${n}`);
      }
    }
  }
  return { block: out, dropped };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--settings' || a === '--config') { if (i + 1 >= argv.length) { console.error(`merge-hooks: ${a} needs a value`); return 2; } f[a.slice(2)] = argv[++i]; }
    else if (a === '--dry-run') f.dryRun = true;
    else if (a === '--remove') f.remove = true;
    else if (a === '--help' || a === '-h') { console.log('usage: node merge-hooks.mjs [--settings <file>] [--config <file>] [--dry-run] [--remove]'); return 0; }
    else { console.error(`merge-hooks: unknown argument ${a}`); return 2; }
  }
  const { config, errors } = loadConfig({ path: f.config, env, overrides: { settings: f.settings ? [f.settings] : undefined } });
  if (errors.length) { console.error(`merge-hooks: the config can't be used:\n  ${errors.join('\n  ')}`); return 1; }
  const file = resolve(config.paths.settings[0]);
  let settings = {}, original = null;
  if (existsSync(file)) {
    original = readFileSync(file, 'utf8');
    try { settings = JSON.parse(original); } catch (e) { console.error(`merge-hooks: ${file} is not valid JSON (${e.message}); nothing written`); return 1; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { console.error(`merge-hooks: ${file} is not a JSON object; nothing written`); return 1; }
  }
  const names = [basename(config.paths.hook), DRAFT_HOOK_NAME];
  const old = voiceEntries(settings, names);
  const want = hooksBlock(config, env);
  // (a) No Stop entry for a draft gate that isn't installed: it could block every reply (CHANGE NOTE 2026-10-03).
  const draftScript = join(dirname(resolve(config.paths.hook)), DRAFT_HOOK_NAME);
  const skipStop = !f.remove && !existsSync(draftScript);
  if (skipStop) {
    delete want.hooks.Stop;
    const shipped = join(config.paths.toolsDir, 'hook', DRAFT_HOOK_NAME);
    console.error(`merge-hooks: skipped the Stop entry: no draft gate script at ${draftScript}. A Stop hook whose script is missing exits 2, which can block every reply, so the draft gate is not wired${old.some((o) => o.name === DRAFT_HOOK_NAME) ? ' and the old draft-gate entry is removed' : ''}. Install it with cp ${shipped} ${draftScript}, then run merge-hooks again.`);
  }
  const { block, dropped } = f.remove ? { block: { hooks: {} }, dropped: [] } : carryOver(want, old);
  const merged = mergeHooks(settings, block, names);
  if (f.remove) for (const ev of Object.keys(merged.hooks)) {
    if (Array.isArray(merged.hooks[ev]) && !merged.hooks[ev].length && settings.hooks?.[ev]?.length) delete merged.hooks[ev];
  }
  if (JSON.stringify(merged) === JSON.stringify(settings)) {
    console.log(f.remove ? `merge-hooks: ${file} has no voice hook entries; nothing written` : `merge-hooks: ${file} already wires the voice hooks this way; nothing written`);
    return 0;
  }
  if (f.dryRun) { console.log(JSON.stringify({ hooks: merged.hooks }, null, 2)); return 0; }
  mkdirSync(dirname(file), { recursive: true });
  let backup = null;
  if (existsSync(file)) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    copyFileSync(file, backup);
  }
  const style = original === null ? { indent: 2, escape: false, newline: '\n', exact: true } : styleOf(original, settings);
  writeFileSync(file, formatJson(merged, style));
  if (f.remove) {
    console.log(`merge-hooks: removed ${old.length} voice hook entr${old.length === 1 ? 'y' : 'ies'} from ${file}${backup ? ` (the original is ${backup})` : ''}`);
    if (!style.exact) console.log('  the file was reformatted as 2-space JSON (its own layout could not be reproduced); every value is kept');
    return 0;
  }
  console.log(`merge-hooks: wired the voice hooks in ${file}${backup ? ` (the original is ${backup})` : ''}`);
  if (!style.exact) console.log('  the file was reformatted as 2-space JSON (its own layout could not be reproduced); every value is kept');
  for (const d of dropped) console.log(`  dropped from the old matcher: ${d} (the new matcher doesn't cover it; add it to sendTools in the voice config to keep it gated)`);
  for (const o of old.filter((o) => Number.isFinite(o.timeout))) if (block.hooks[o.event]) console.log(`  kept timeout ${o.timeout} on ${o.event} ${o.name}`);
  console.log(`  PreToolUse  ${block.hooks.PreToolUse[0].matcher}`);
  console.log(`  PostToolUse ${block.hooks.PostToolUse[0].matcher}`);
  console.log(block.hooks.Stop ? `  Stop        ${DRAFT_HOOK_NAME} (${block.hooks.Stop[0].hooks[0].command})` : `  Stop        skipped (no draft gate script at ${draftScript})`);
  return 0;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exit(main());
