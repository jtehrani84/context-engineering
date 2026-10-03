#!/usr/bin/env node
/**
 * model-roster.mjs — role → model id. Callers ask for a ROLE (sol, terra, luna, grok, gemini-pro,
 * gemini-flash, opus, sonnet, haiku), never a model id; this resolves the role to whatever id the current
 * sources serve, so a gateway moving from one version to the next doesn't break the callers.
 *
 * Why it exists (2026-10-03): a review failed because code pinned one gateway id after the gateway moved
 * on to the next version. Pinned ids go stale silently; a role resolved at call time doesn't.
 *
 * Data lives in model-roster.json next to this file (or MODEL_ROSTER_CONFIG): per role a vendor, tier,
 * dispatch path, a `family` regex over served ids (capture 1 = version, capture 2 = optional suffix) and
 * `prefer` ordering rules (version-desc: highest version first; plain-first: no suffix before -1M/-preview).
 *
 * Sources, in order:
 *   dispatch 'opencode' roles: (a) the provider policy file (parsed as text, never executed: the
 *     `const policy = {...}` object's providerID + models), (b) `opencode models` (provider/id lines),
 *   dispatch 'native' roles: the gateway's OpenAI-compatible /models listing (endpoint from an opencode
 *     config file),
 *   then (c) the last-known-good cache (~/.cache/model-roster/resolved.json), ONLY when every live source is
 *     unavailable. A live source that answers but no longer serves the role is an error, never a cache hit:
 *     a removed id is never kept in use silently.
 * Provider id: the `provider` option, else MODEL_ROSTER_PROVIDER, else the json's sources.provider, else the
 * policy's providerID, else the only provider whose ids match the role (two or more = an error, not a guess).
 *
 * Change detection: each live resolve is compared to the cache. A new id for a role appends
 * `<iso>\t<role>\t<old> -> <new>\t<source>` to changes.log and returns changed:true + previous. Callers that
 * hold eval-verified picks must treat a changed id as a new, unverified model.
 *
 * Fails loudly: an unresolvable role throws RosterError naming the role and what the source does serve.
 * There is no fallback to a different vendor or role.
 *
 * Dispatch: runSpec(qualified, prompt) is the one way an opencode role is run (the probe, harness-ask and
 * harness-run all use it): `run --pure -m <provider/id>` plus the id declared at runtime in OPENCODE_CONFIG_CONTENT.
 *
 * Provider-neutral on purpose: no vendor or gateway names in this file; paths and the provider come from
 * the json. Vendored byte-identical into other repos; each copy has a drift test against the canonical hash.
 *
 * CLI:  node model-roster.mjs [role ...|--all] [--json] [--check] [--refresh] [--probe] [--notice]
 *   --check   exit 1 when any requested role doesn't resolve
 *   --refresh live sources only (no cache fallback); rewrites the cache
 *   --probe   one tiny live call per resolved role, prompt "Reply with the single word ok." (synthetic only)
 *   --notice  session-start line: prints changes logged since the last notice; reads the cache dir only,
 *             never blocks, always exits 0
 * Env: MODEL_ROSTER_CONFIG, MODEL_ROSTER_POLICY, MODEL_ROSTER_OPENCODE_BIN, MODEL_ROSTER_GATEWAY_CONFIG
 *      (each 'none' disables that source), MODEL_ROSTER_PROVIDER, MODEL_ROSTER_CACHE_DIR.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROBE_PROMPT = 'Reply with the single word ok.';

export class RosterError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'RosterError'; Object.assign(this, extra); }
}

// run a command with stdin CLOSED: `opencode run` reads stdin to EOF when it isn't a TTY, so an open pipe hangs it
// until the timeout (seen live 2026-10-03). Resolves stdout on exit 0; rejects with the stderr tail otherwise.
function runCmd(bin, args, timeoutMs, env = process.env) {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(rej, new Error(`timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 4 * 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', d => { err = (err + d).slice(-2000); });
    child.on('error', e => finish(rej, e));
    child.on('close', code => (code === 0 ? finish(res, out) : finish(rej, new Error(`exit ${code}: ${errSummary(err + '\n' + out)}`))));
  });
}

// a readable one-liner from a failed command's output: a JSON error's name + message if present, else the last
// line with letters in it (a bare closing brace isn't a diagnosis)
function errSummary(text) {
  const t = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  const name = /"name"\s*:\s*"([^"]+)"/.exec(t)?.[1];
  const msg = /"message"\s*:\s*"([^"]+)"/.exec(t)?.[1];
  if (name || msg) return [name, msg].filter(Boolean).join(': ');
  return t.split('\n').map(l => l.trim()).filter(l => /[A-Za-z]/.test(l)).pop() || 'no output';
}

const expandHome = (p) => (typeof p === 'string' && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const envOff = (v) => v === 'none' || v === '';

// ---- roster data ----
export function loadRoster(src) {
  if (src && typeof src === 'object') return src;
  const path = src || process.env.MODEL_ROSTER_CONFIG || join(HERE, 'model-roster.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export const ROLE_NAMES = (roster = loadRoster()) => Object.keys(roster.roles);

// name → { role, deprecated, from? }. Accepts a role, a legacy name (gpt, @luna, an old pinned-id key, a friendly id),
// or a served id (optionally provider-qualified) that matches a role family. Unknown → null.
export function normalizeRole(name, roster = loadRoster()) {
  if (name === undefined || name === null) return null;
  const s = String(name).trim();
  if (!s) return null;
  if (Object.hasOwn(roster.roles, s)) return { role: s, deprecated: false };
  const legacy = roster.legacy || {};
  const hit = legacy[s] ?? legacy[s.toLowerCase()];
  if (hit && Object.hasOwn(roster.roles, hit)) return { role: hit, deprecated: true, from: s };
  const id = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  for (const [role, def] of Object.entries(roster.roles)) {
    if (new RegExp(def.family).test(id)) return { role, deprecated: true, from: s };
  }
  return null;
}

// ---- ordering ----
const versionKey = (v) => String(v || '').split(/[.-]/).map(Number).map(n => (Number.isFinite(n) ? n : 0));
function cmpVersion(a, b) {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
function suffixRank(suffix, order = []) {
  if (!suffix) return 0;
  const norm = /^-\d{8}$/.test(suffix) ? '-date' : suffix;
  const i = order.indexOf(norm);
  return i < 0 ? 99 : i + 1;
}
// ids → the preferred id for this role, or null
export function pickId(def, ids, roster = loadRoster()) {
  const re = new RegExp(def.family);
  const cands = [];
  for (const id of ids) { const m = re.exec(id); if (m) cands.push({ id, version: m[1], suffix: m[2] || '' }); }
  const rules = def.prefer || ['version-desc', 'plain-first'];
  cands.sort((a, b) => {
    for (const r of rules) {
      let d = 0;
      if (r === 'version-desc') d = cmpVersion(b.version, a.version);
      else if (r === 'version-asc') d = cmpVersion(a.version, b.version);
      else if (r === 'plain-first') d = suffixRank(a.suffix, roster.suffixOrder) - suffixRank(b.suffix, roster.suffixOrder);
      if (d) return d;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return cands.length ? cands[0].id : null;
}

// ---- parsers (text only; nothing is executed) ----
export function parsePolicy(text) {
  if (typeof text !== 'string') return null;
  const m = /\bpolicy\s*=\s*\{/.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        const p = JSON.parse(text.slice(start, i + 1));
        if (!p || typeof p.providerID !== 'string' || !Array.isArray(p.models)) return null;
        return { providerID: p.providerID, models: p.models.filter(x => typeof x === 'string'), defaultModel: p.defaultModel ?? null };
      } catch { return null; }
    }
  }
  return null;
}
export function parseOpencodeModels(stdout) {
  const out = [];
  for (const raw of String(stdout || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^([A-Za-z0-9._-]+)\/(\S+)$/.exec(line);
    if (m) out.push({ provider: m[1], id: m[2] });
  }
  return out;
}

// ---- default (live) sources; every one is injectable ----
function readPolicyText(cfg, opts) {
  if (opts.policyText !== undefined) return { text: opts.policyText, where: 'injected' };
  const env = process.env.MODEL_ROSTER_POLICY;
  if (env !== undefined && envOff(env)) return { text: null, where: 'disabled' };
  const paths = env ? [env] : (cfg.sources?.policyFiles || []);
  for (const p of paths) { try { return { text: readFileSync(expandHome(p), 'utf8'), where: p }; } catch { /* next */ } }
  return { text: null, where: paths.length ? `not found (${paths.join(', ')})` : 'none configured' };
}
function opencodeBin(cfg) {
  const env = process.env.MODEL_ROSTER_OPENCODE_BIN;
  if (env !== undefined) return envOff(env) ? null : expandHome(env);
  for (const b of cfg.sources?.opencodeBins || ['opencode']) {
    const p = expandHome(b);
    if (!isAbsolute(p) || existsSync(p)) return p;
  }
  return null;
}
async function defaultRunOpencode(cfg) {
  const bin = opencodeBin(cfg);
  if (!bin) throw new Error('opencode binary disabled or not found');
  return runCmd(bin, ['models'], cfg.sources?.opencodeTimeoutMs || 15000);
}
function gatewayEndpoint(cfg, opts) {
  const env = process.env.MODEL_ROSTER_GATEWAY_CONFIG;
  if (env !== undefined && envOff(env)) throw new Error('gateway source disabled');
  const file = expandHome(env || cfg.sources?.gatewayConfig);
  if (!file) throw new Error('no gateway config configured');
  const conf = JSON.parse(readFileSync(file, 'utf8'));
  const providers = Object.entries(conf.provider || {}).filter(([, v]) => v?.options?.baseURL);
  const want = opts.provider || process.env.MODEL_ROSTER_PROVIDER || cfg.sources?.provider;
  const chosen = want ? providers.find(([k]) => k === want) : (providers.length === 1 ? providers[0] : null);
  if (!chosen) throw new Error(want ? `provider '${want}' not in the gateway config` : `gateway config has ${providers.length} providers; set the provider`);
  const [provider, v] = chosen;
  let key = String(v.options.apiKey || '').trim();
  const f = /^\{file:(.+)\}$/.exec(key); const e = /^\{env:(.+)\}$/.exec(key);
  if (f) { try { key = readFileSync(expandHome(f[1]), 'utf8').trim(); } catch { key = ''; } }
  else if (e) key = process.env[e[1]] || '';
  return { provider, base: String(v.options.baseURL).replace(/\/$/, ''), key };
}
async function defaultFetchGateway(cfg, opts) {
  const { provider, base, key } = gatewayEndpoint(cfg, opts);
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(cfg.sources?.gatewayTimeoutMs || 10000) });
  if (!res.ok) throw new Error(`gateway /models HTTP ${res.status}`);
  const body = await res.json();
  return { provider, ids: (body.data || []).map(m => m?.id).filter(Boolean) };
}

// ---- cache ----
const cacheDirOf = (opts) => opts.cacheDir || process.env.MODEL_ROSTER_CACHE_DIR || join(homedir(), '.cache', 'model-roster');
function readJson(path, dflt) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return dflt; } }
function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

// ---- resolution ----
function makeCtx(opts) {
  const cfg = loadRoster(opts.roster || opts.rosterPath);
  const memo = {};
  const once = (k, fn) => (memo[k] ??= fn().then(v => ({ ok: true, v }), err => ({ ok: false, err })));
  return {
    cfg, opts,
    policy: () => once('policy', async () => { const { text, where } = readPolicyText(cfg, opts); const p = text == null ? null : parsePolicy(text); if (!p) throw new Error(text == null ? `policy file ${where}` : `policy file unparseable (${where})`); return p; }),
    opencode: () => once('opencode', async () => parseOpencodeModels(await (opts.runOpencode ? opts.runOpencode() : defaultRunOpencode(cfg)))),
    gateway: () => once('gateway', async () => (opts.fetchGateway ? opts.fetchGateway() : defaultFetchGateway(cfg, opts))),
  };
}
const configuredProvider = (ctx) => ctx.opts.provider || process.env.MODEL_ROSTER_PROVIDER || ctx.cfg.sources?.provider || null;
const servedList = (ids) => (ids.length ? ids.join(', ') : '(nothing)');

// → { id, provider, source } from a live source, or { unavailable: [reasons] }. Throws RosterError when a live
// source answered but serves nothing in the role's family (a removed id must not come back from the cache).
async function liveResolve(role, def, ctx) {
  const notes = [];
  const fam = def.family;
  if (def.dispatch === 'native') {
    const g = await ctx.gateway();
    if (!g.ok) return { unavailable: [`gateway models: ${g.err.message}`] };
    const provider = configuredProvider(ctx) || g.v.provider || null;
    const id = pickId(def, g.v.ids, ctx.cfg);
    if (!id) throw new RosterError(`model-roster: role '${role}' did not resolve: the gateway listing serves no id matching ${fam}. It serves: ${servedList(g.v.ids)}. No fallback to another model.`, { role, served: g.v.ids });
    return { id, provider, source: 'gateway-models' };
  }
  const p = await ctx.policy();
  if (p.ok) {
    const provider = configuredProvider(ctx) || p.v.providerID;
    const id = pickId(def, p.v.models, ctx.cfg);
    if (!id) throw new RosterError(`model-roster: role '${role}' did not resolve: the provider policy (${provider}) allows no id matching ${fam}. It allows: ${servedList(p.v.models)}. No fallback to another model.`, { role, served: p.v.models });
    return { id, provider, source: 'policy' };
  }
  notes.push(p.err.message);
  const o = await ctx.opencode();
  if (!o.ok) { notes.push(`opencode models: ${o.err.message}`); return { unavailable: notes }; }
  const want = configuredProvider(ctx);
  const rows = want ? o.v.filter(r => r.provider === want) : o.v;
  const re = new RegExp(fam);
  const providers = [...new Set(rows.filter(r => re.test(r.id)).map(r => r.provider))];
  if (providers.length > 1) throw new RosterError(`model-roster: role '${role}' is ambiguous: providers ${providers.join(', ')} all serve it. Set the provider (MODEL_ROSTER_PROVIDER or sources.provider).`, { role, providers });
  const served = rows.map(r => `${r.provider}/${r.id}`);
  if (!providers.length) throw new RosterError(`model-roster: role '${role}' did not resolve: \`opencode models\`${want ? ` (provider ${want})` : ''} lists no id matching ${fam}. It lists: ${servedList(served)}. No fallback to another model.`, { role, served });
  const id = pickId(def, rows.filter(r => r.provider === providers[0]).map(r => r.id), ctx.cfg);
  return { id, provider: providers[0], source: 'opencode-models' };
}

async function resolveWith(name, ctx, cache, changes) {
  const cfg = ctx.cfg;
  const n = normalizeRole(name, cfg);
  if (!n) throw new RosterError(`model-roster: unknown role '${name}'. Known roles: ${Object.keys(cfg.roles).join(', ')}.`, { role: name });
  const { role } = n;
  const def = cfg.roles[role];
  const now = (ctx.opts.now ? ctx.opts.now() : new Date()).toISOString();
  const base = { role, vendor: def.vendor, tier: def.tier, dispatch: def.dispatch };
  if (n.deprecated) base.deprecatedName = n.from;
  const live = await liveResolve(role, def, ctx);
  if (live.unavailable) {
    const hit = !ctx.opts.refresh && cache.roles?.[role];
    if (hit?.id) return { ...base, id: hit.id, provider: hit.provider ?? null, qualified: hit.qualified ?? null, source: 'cache', cachedFrom: hit.source, resolvedAt: hit.resolvedAt, stale: true, changed: false, unavailable: live.unavailable };
    throw new RosterError(`model-roster: role '${role}' did not resolve: no live source available (${live.unavailable.join('; ')})${ctx.opts.refresh ? ' and --refresh skips the cache' : ' and no cached id'}.`, { role, unavailable: live.unavailable });
  }
  const qualified = live.provider ? `${live.provider}/${live.id}` : live.id;
  const prev = cache.roles?.[role]?.id;
  const changed = !!prev && prev !== live.id;
  if (changed) changes.push(`${now}\t${role}\t${prev} -> ${live.id}\t${live.source}`);
  cache.roles = cache.roles || {};
  cache.roles[role] = { id: live.id, provider: live.provider, qualified, source: live.source, resolvedAt: now };
  cache.dirty = true;
  return { ...base, id: live.id, provider: live.provider, qualified, source: live.source, resolvedAt: now, changed, ...(changed ? { previous: prev } : {}) };
}
function flush(dir, cache, changes) {
  if (changes.length) { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, 'changes.log'), changes.join('\n') + '\n'); }
  if (cache.dirty) { delete cache.dirty; cache.schema = 'model-roster.cache.v1'; cache.updatedAt = new Date().toISOString(); writeJsonAtomic(join(dir, 'resolved.json'), cache); }
}

export async function resolve(name, opts = {}) {
  const ctx = makeCtx(opts);
  const dir = cacheDirOf(opts);
  const cache = readJson(join(dir, 'resolved.json'), { roles: {} });
  const changes = [];
  try { return await resolveWith(name, ctx, cache, changes); }
  finally { flush(dir, cache, changes); }
}

// → { roles: {role: result}, errors: {role: message} }. Never throws for an unresolvable role.
export async function resolveAll(opts = {}) {
  const ctx = makeCtx(opts);
  const names = opts.roles || Object.keys(ctx.cfg.roles);
  const dir = cacheDirOf(opts);
  const cache = readJson(join(dir, 'resolved.json'), { roles: {} });
  const changes = [];
  const roles = {}, errors = {};
  for (const name of names) {
    try { const r = await resolveWith(name, ctx, cache, changes); roles[r.role] = r; }
    catch (e) { errors[name] = e.message; }
  }
  flush(dir, cache, changes);
  return { roles, errors };
}

// ---- dispatch spec: the ONE way an opencode role is run (probe and every caller use it) ----
// `--pure` keeps external plugins out of the session (no synced tool servers handed to an outside model). It also
// skips the generated provider plugin, which is where ids that exist only in the policy are defined, so the
// resolved id is declared on its provider at runtime through OPENCODE_CONFIG_CONTENT (merged into an existing
// value; no config file is touched). Seen live 2026-10-03: --pure alone → "Unexpected server error" for a
// policy-only id; --pure + this entry → answered.
export function runSpec(qualified, prompt, { format, baseEnv = process.env } = {}) {
  const q = String(qualified || '');
  const slash = q.indexOf('/');
  if (slash <= 0 || slash === q.length - 1) throw new RosterError(`model-roster: '${q}' is not provider/id; resolve the role first.`);
  const provider = q.slice(0, slash), id = q.slice(slash + 1);
  let conf = {};
  try { const p = JSON.parse(baseEnv?.OPENCODE_CONFIG_CONTENT || '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) conf = p; } catch { /* unparseable → replaced */ }
  conf.provider = conf.provider && typeof conf.provider === 'object' ? conf.provider : {};
  const prov = conf.provider[provider] = conf.provider[provider] && typeof conf.provider[provider] === 'object' ? conf.provider[provider] : {};
  prov.models = prov.models && typeof prov.models === 'object' ? prov.models : {};
  prov.models[id] ??= {};
  return { args: ['run', '--pure', '-m', q, ...(format ? ['--format', format] : []), prompt], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(conf) } };
}

// ---- probe: one synthetic call per role ----
async function defaultCallOpencode(cfg, qualified, prompt, timeoutMs) {
  const bin = opencodeBin(cfg);
  if (!bin) throw new Error('opencode binary disabled or not found');
  const spec = runSpec(qualified, prompt);
  return runCmd(bin, spec.args, timeoutMs, { ...process.env, ...spec.env });
}
async function defaultCallGateway(cfg, id, prompt, opts, timeoutMs) {
  const { base, key } = gatewayEndpoint(cfg, opts);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: id, messages: [{ role: 'user', content: prompt }], max_tokens: 16 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return String(body?.choices?.[0]?.message?.content ?? '');
}
export async function probe(opts = {}) {
  const cfg = loadRoster(opts.roster || opts.rosterPath);
  const roles = opts.roles || (await resolveAll(opts)).roles;
  const out = {};
  const timeoutMs = opts.probeTimeoutMs || cfg.sources?.probeTimeoutMs || 120000;
  for (const [role, r] of Object.entries(roles)) {
    const t0 = Date.now();
    try {
      const reply = r.dispatch === 'native'
        ? await (opts.callGateway ? opts.callGateway(r.id, PROBE_PROMPT) : defaultCallGateway(cfg, r.id, PROBE_PROMPT, opts, timeoutMs))
        : await (opts.callOpencode ? opts.callOpencode(r.qualified, PROBE_PROMPT) : defaultCallOpencode(cfg, r.qualified, PROBE_PROMPT, timeoutMs));
      const text = String(reply).replace(/\x1b\[[0-9;]*m/g, '').trim();
      out[role] = { role, id: r.id, qualified: r.qualified, reachable: /\bok\b/i.test(text), ms: Date.now() - t0, reply: text.slice(-40) };
      if (!out[role].reachable) out[role].error = 'answered without "ok"';
    } catch (e) {
      out[role] = { role, id: r.id, qualified: r.qualified, reachable: false, ms: Date.now() - t0, error: String(e?.message || e).split('\n')[0].slice(0, 200) };
    }
  }
  try { writeJsonAtomic(join(cacheDirOf(opts), 'probe.json'), { probedAt: new Date().toISOString(), prompt: PROBE_PROMPT, results: out }); } catch { /* best effort */ }
  return out;
}

// ---- session-start notice: cache dir only, never throws ----
export function notice(opts = {}) {
  try {
    const dir = cacheDirOf(opts);
    const logPath = join(dir, 'changes.log');
    if (!existsSync(logPath)) return '';
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    const stampPath = join(dir, 'notice.stamp');
    const seen = Number(readJson(stampPath, { seen: 0 }).seen) || 0;
    const fresh = lines.slice(seen);
    if (!fresh.length) return '';
    const latest = new Map();
    for (const l of fresh) {
      const [, role, change] = l.split('\t');
      const m = /^(.*) -> (.*)$/.exec(change || '');
      if (!role || !m) continue;
      const first = latest.get(role)?.old ?? m[1];
      latest.set(role, { old: first, now: m[2] });
    }
    writeJsonAtomic(stampPath, { seen: lines.length, at: new Date().toISOString() });
    if (!latest.size) return '';
    return 'model roster: ' + [...latest].map(([r, v]) => `${r} is now ${v.now} (was ${v.old})`).join('; ');
  } catch { return ''; }
}

// ---- CLI ----
async function cli(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  if (flags.has('--notice')) { const line = notice(); if (line) console.log(line); return 0; }
  const named = argv.filter(a => !a.startsWith('--'));
  const opts = { refresh: flags.has('--refresh') };
  if (named.length && !flags.has('--all')) opts.roles = named;
  const res = await resolveAll(opts);
  if (flags.has('--probe')) res.probe = await probe({ ...opts, roles: res.roles });
  if (flags.has('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    for (const r of Object.values(res.roles)) {
      const note = [r.changed ? `CHANGED (was ${r.previous})` : '', r.stale ? 'STALE cache' : '', r.deprecatedName ? `deprecated name '${r.deprecatedName}'` : ''].filter(Boolean).join(' · ');
      const pr = res.probe?.[r.role];
      console.log(`${r.role.padEnd(13)} ${String(r.qualified).padEnd(32)} ${r.source.padEnd(15)}${pr ? (pr.reachable ? ` reachable ${pr.ms}ms` : ` UNREACHABLE: ${pr.error}`) : ''}${note ? '  ' + note : ''}`);
    }
    for (const [role, msg] of Object.entries(res.errors)) console.error(`${role.padEnd(13)} UNRESOLVED  ${msg}`);
  }
  if (flags.has('--json') && Object.keys(res.errors).length) for (const msg of Object.values(res.errors)) console.error(msg);
  return flags.has('--check') && Object.keys(res.errors).length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(String(e?.message || e)); process.exit(process.argv.includes('--notice') ? 0 : 1); });
}
