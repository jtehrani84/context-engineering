#!/usr/bin/env node
// opencode-llm.mjs: send one prompt to a model through the opencode CLI and return its reply. prose-gate.mjs uses it
// as the judge backend, one call per juror.
//
// Callers name a ROLE, not a model id: gpt, gpt-mini, grok, gemini-pro, gemini-flash, opus, sonnet or haiku (the
// list and each role's id pattern are in model-roster.json). model-roster.mjs resolves the role to an id that
// `opencode models` lists now, so when a provider moves to a new version the calls follow it instead of breaking on
// a pinned id. An old provider/model id (openai/gpt-5) is read as its role, with a note on stderr. A role nothing
// lists throws, naming the role and what is listed; there is no fallback to another model or vendor.
// The call goes ahead with a new id, but never silently: stderr gets one line when a role's id changed since the last
// resolve (also logged to ~/.cache/model-roster/changes.log), and one when `opencode models` failed and the id came
// from the last-known-good cache (STALE: it may have been removed since).
//
// It runs `opencode run --pure -m <provider/id> <prompt>`, built by the roster's runSpec. --pure turns off opencode's
// plugins and MCP tools: the judge needs no tools, and a session's tool list can make a provider reject the call.
// runSpec also declares the resolved id on its provider in OPENCODE_CONFIG_CONTENT, for an id that only a plugin
// defines (--pure skips plugins); no config file is touched. The CLI is OPENCODE_BIN, else `opencode` on PATH, and
// the role list comes from the same binary unless MODEL_ROSTER_OPENCODE_BIN names another.
//
// DATA NOTE: the prompt goes to that model's provider. Send only text you are allowed to send there.
// Usage:  import { llm } from './opencode-llm.mjs';  await llm(prompt, { role: 'sonnet', timeout })
//         node opencode-llm.mjs "prompt" --role sonnet

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolveRole, runSpec } from './model-roster.mjs';

const OPENCODE = () => process.env.OPENCODE_BIN || 'opencode';
export const DEFAULT_ROLE = 'sonnet';
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

// role (or an old model name or id) → the roster's resolution: { role, id, qualified, source, changed, ... }
export async function target(opts = {}) {
  const name = opts.role || opts.model || DEFAULT_ROLE;
  const ro = process.env.MODEL_ROSTER_OPENCODE_BIN === undefined ? { runOpencode: () => listModels(OPENCODE()) } : {};
  const r = await resolveRole(name, ro);
  if (r.deprecatedName && !warned.has(r.deprecatedName)) { warned.add(r.deprecatedName); console.error(`opencode-llm: '${r.deprecatedName}' is an old model name; ask for role '${r.role}' (resolved to ${r.qualified})`); }
  const note = notice(r);
  if (note && !warned.has(note)) { warned.add(note); console.error(note); }
  return r;
}
// the visible note for a changed or stale resolution ('' when there is nothing to say). Exported for prose-gate.
export function notice(r) {
  if (r?.changed) return `opencode-llm: role '${r.role}' is now ${r.qualified} (was ${r.previous}); going ahead with the new id`;
  if (r?.stale) return `opencode-llm: role '${r.role}' uses ${r.qualified}, the last-known id from ${r.resolvedAt} (STALE: ${(r.unavailable || []).join('; ').replace(/\s+/g, ' ').trim() || 'no live model list'}); it may have been removed since`;
  return '';
}
const warned = new Set();
function listModels(bin) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['models'], { encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    child.stdin?.end();
  });
}

// Async on purpose (2026-09-30): the old execFileSync blocked the event loop, so prose-gate's
// Promise.all ran its judges one after another. A slow juror plus one retry each could take ~600s,
// past the 400s wrappers that call the gate, which then printed nothing at all. execFile lets the
// judges overlap; the timeout kills the child so a stuck call can't hang the gate.
export async function llm(prompt, opts = {}) {
  const t = opts.resolved || await target(opts);
  if (!t?.qualified) throw new Error(`no provider/id for role '${t?.role}'`);
  const spec = runSpec(t.qualified, prompt);
  const timeout = opts.timeout || 150000;
  const out = await new Promise((resolve, reject) => {
    // execFileSync closed the child's stdin for us; async execFile leaves it open and opencode run
    // waits on it forever, so close it explicitly (child.stdin.end() below).
    const child = execFile(OPENCODE(), spec.args, {
      encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...spec.env },
    }, (err, stdout) => {
      if (err) return reject(err.killed ? new Error(`${t.qualified} timed out after ${timeout}ms`) : err);
      resolve(stdout);
    });
    child.stdin?.end();
  });
  // default format: a "> build · <model>" header line, then the model's response. Strip ANSI + header.
  return stripAnsi(out).split('\n').filter((l) => !/^\s*>\s*build\s*[·.]/.test(l)).join('\n').trim();
}

// main-module check that holds through a symlinked path (macOS /tmp, a symlinked ~/.claude), where argv[1] as typed
// differs from the module's URL (a plain compare made the CLI a silent exit-0 no-op), and under `node -e`
const isMain = (() => {
  if (typeof import.meta.main === 'boolean') return import.meta.main;   // Node 22.18+ / 24.2+
  if (process.execArgv.some((a) => /^(-e|-p|--eval|--print)(=|$)/.test(a))) return false;   // node -e: argv[1] is an argument
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const argv = process.argv.slice(2); const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--role') flags.role = argv[++i]; else if (argv[i] === '--model') flags.model = argv[++i]; else if (argv[i] === '--max') flags.max = +argv[++i]; else rest.push(argv[i]); }
  llm(rest.join(' ') || 'Reply with exactly the two letters: OK', flags).then((x) => console.log(x)).catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
