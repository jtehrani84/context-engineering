// model-roles.test.mjs — callers name ROLES, never model ids. model-roster.mjs resolves a role to an id that
// `opencode models` lists now, using the patterns in model-roster.json, so a provider that moves to a new version is
// followed, and a role nothing serves is a loud error, never a silent pin or a different vendor. opencode-llm.mjs
// dispatches through the roster's runSpec; prose-gate.mjs judges name roles whose vendor matches the judge's; llm.mjs
// resolves a role against your endpoint's /models list; the rag-quality tools ask for roles.
// Hermetic: a fake opencode that lists made-up future ids and records its argv and OPENCODE_CONFIG_CONTENT, a loopback
// HTTP stub for llm.mjs, and a scratch cache. No model is called. Run: node --test model-roles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
for (const k of Object.keys(process.env)) if (k.startsWith('MODEL_ROSTER_') || k.startsWith('LLM_')) delete process.env[k];
const tmp = mkdtempSync(join(tmpdir(), 'model-roles-'));
const CACHE = join(tmp, 'cache');
process.env.MODEL_ROSTER_CACHE_DIR = CACHE;
const ROSTER = JSON.parse(readFileSync(join(HERE, 'model-roster.json'), 'utf8'));

// made-up future ids: none of these exist today, which is the point (nothing may be pinned)
const LISTING = [
  'openai/gpt-9', 'openai/gpt-9-mini', 'openai/gpt-8.5', 'openai/gpt-9-codex',
  'xai/grok-7', 'xai/grok-7-fast', 'xai/grok-6.5',
  'google/gemini-9-pro-preview', 'google/gemini-8.5-pro', 'google/gemini-9-flash', 'google/gemini-9-flash-lite',
  'anthropic/claude-opus-9-1', 'anthropic/claude-opus-9-1-20990101', 'anthropic/claude-opus-9',
  'anthropic/claude-sonnet-9-2', 'anthropic/claude-sonnet-9',
  'anthropic/claude-haiku-9-1-20990101',
].join('\n') + '\n';
const LOG = join(tmp, 'fake');
const fakeOpencode = (name, listing) => {
  const p = join(tmp, name);
  writeFileSync(p, `#!/bin/sh\nif [ "$1" = models ]; then printf '%s' '${listing}'; exit 0; fi\nprintf '%s\\n' "$@" > "${LOG}.args"\nprintf '%s' "$OPENCODE_CONFIG_CONTENT" > "${LOG}.env"\necho '> build · fake'\necho 'ok from fake'\n`, { mode: 0o755 });
  return p;
};
const FAKE = fakeOpencode('fake-opencode.sh', LISTING);
process.env.OPENCODE_BIN = FAKE;
const lastArgs = () => readFileSync(`${LOG}.args`, 'utf8').split('\n').slice(0, -1);
const lastConf = () => JSON.parse(readFileSync(`${LOG}.env`, 'utf8'));
const clearLog = () => { for (const s of ['.args', '.env']) rmSync(LOG + s, { force: true }); };

test('model-roster.json is provider-neutral: no policy file, no gateway config, no provider, every role via opencode', () => {
  assert.deepEqual(ROSTER.sources.policyFiles || [], []);
  assert.equal(ROSTER.sources.gatewayConfig, undefined);
  assert.equal(ROSTER.sources.provider ?? null, null);
  assert.deepEqual(ROSTER.sources.opencodeBins, ['opencode']);
  for (const [role, def] of Object.entries(ROSTER.roles)) {
    assert.equal(def.dispatch, 'opencode', `${role} must resolve from opencode models`);
    assert.ok(['openai', 'xai', 'google', 'anthropic'].includes(def.vendor), `${role}: vendor ${def.vendor}`);
    assert.doesNotThrow(() => new RegExp(def.family), `${role}: family is a valid regex`);
  }
});

test('each role resolves from `opencode models` to the newest id of its family, with no policy file and no error', async () => {
  const { resolveAll } = await import('./model-roster.mjs');
  const res = await resolveAll({ cacheDir: join(tmp, 'c1'), runOpencode: async () => LISTING });
  assert.deepEqual(res.errors, {});
  const got = Object.fromEntries(Object.values(res.roles).map((r) => [r.role, r.qualified]));
  assert.deepEqual(got, {
    gpt: 'openai/gpt-9', 'gpt-mini': 'openai/gpt-9-mini', grok: 'xai/grok-7',
    'gemini-pro': 'google/gemini-9-pro-preview', 'gemini-flash': 'google/gemini-9-flash',
    opus: 'anthropic/claude-opus-9-1', sonnet: 'anthropic/claude-sonnet-9-2', haiku: 'anthropic/claude-haiku-9-1-20990101',
  });
  for (const r of Object.values(res.roles)) assert.equal(r.source, 'opencode-models');
});

test('two providers serving one family is an error that names them; a configured provider settles it', async () => {
  const { resolve } = await import('./model-roster.mjs');
  const both = LISTING + 'router/claude-sonnet-9-3\n';
  await assert.rejects(resolve('sonnet', { cacheDir: join(tmp, 'c2'), runOpencode: async () => both }), (e) => /ambiguous/.test(e.message) && /anthropic/.test(e.message) && /router/.test(e.message));
  const r = await resolve('sonnet', { cacheDir: join(tmp, 'c2'), provider: 'router', runOpencode: async () => both });
  assert.equal(r.qualified, 'router/claude-sonnet-9-3');
});

test('a provider moving to a new version is logged as a change, and the new id is used', async () => {
  const { resolve } = await import('./model-roster.mjs');
  const dir = join(tmp, 'c3');
  await resolve('grok', { cacheDir: dir, runOpencode: async () => 'xai/grok-7\n' });
  const r = await resolve('grok', { cacheDir: dir, runOpencode: async () => 'xai/grok-8\n' });
  assert.equal(r.qualified, 'xai/grok-8');
  assert.equal(r.changed, true);
  assert.equal(r.previous, 'grok-7');
  assert.match(readFileSync(join(dir, 'changes.log'), 'utf8'), /\tgrok\tgrok-7 -> grok-8\topencode-models\n$/);
});

test('opencode-llm: a role resolves from the same binary it dispatches to and runs through runSpec', async () => {
  clearLog();
  const { llm } = await import('./opencode-llm.mjs');
  const out = await llm('Reply with the single word ok.', { role: 'gpt' });
  assert.equal(out, 'ok from fake');
  const a = lastArgs();
  assert.deepEqual(a.slice(0, 4), ['run', '--pure', '-m', 'openai/gpt-9']);
  assert.equal(a[a.length - 1], 'Reply with the single word ok.');
  assert.ok(lastConf().provider.openai.models['gpt-9'], 'the resolved id is declared at runtime for --pure');
});

test('opencode-llm: an old provider/model id is read as its role and follows what is listed, not the pin', async () => {
  clearLog();
  const { llm } = await import('./opencode-llm.mjs');
  await llm('Reply with the single word ok.', { model: 'openai/gpt-5' });
  assert.equal(lastArgs()[3], 'openai/gpt-9');
});

test('opencode-llm: with no role it uses sonnet', async () => {
  clearLog();
  const { llm, DEFAULT_ROLE } = await import('./opencode-llm.mjs');
  assert.equal(DEFAULT_ROLE, 'sonnet');
  await llm('Reply with the single word ok.');
  assert.equal(lastArgs()[3], 'anthropic/claude-sonnet-9-2');
});

test('opencode-llm: a role nothing lists fails loudly, names the role and what is listed, and calls nothing', async () => {
  const saved = process.env.OPENCODE_BIN;
  try {
    process.env.OPENCODE_BIN = fakeOpencode('fake-no-mini.sh', 'openai/gpt-9\nxai/grok-7\n');
    clearLog();
    const { llm } = await import('./opencode-llm.mjs');
    await assert.rejects(llm('Reply with the single word ok.', { role: 'gpt-mini' }), (e) => /role 'gpt-mini'/.test(e.message) && /openai\/gpt-9/.test(e.message) && /No fallback/.test(e.message));
    assert.equal(existsSync(`${LOG}.args`), false, 'no model was called');
    await assert.rejects(llm('x', { role: 'not-a-role' }), /unknown role 'not-a-role'/);
  } finally { process.env.OPENCODE_BIN = saved; }
});

test('prose-gate: every judge names a roster role from its own vendor, and no model id', async () => {
  const { JUDGES } = await import('./prose-gate.mjs');
  for (const [name, j] of Object.entries(JUDGES)) {
    assert.equal(j.model, undefined, `${name} still pins a model id`);
    assert.ok(ROSTER.roles[j.role], `${name}: '${j.role}' is not a roster role`);
    assert.equal(ROSTER.roles[j.role].vendor, j.vendor, `${name}: role vendor ${ROSTER.roles[j.role].vendor} != judge vendor ${j.vendor} (would break judge != drafter)`);
    assert.ok(j.calibratedOn === null || typeof j.calibratedOn === 'string', `${name}: calibratedOn is null or an id`);
  }
});

test('prose-gate: resolveJudge reports a judge with no calibration on this install as uncalibrated, and a matching one as calibrated', async () => {
  const { resolveJudge, JUDGES } = await import('./prose-gate.mjs');
  const saved = JUDGES.gpt.calibratedOn;
  try {
    JUDGES.gpt.calibratedOn = null;
    const r = await resolveJudge('gpt');
    assert.equal(r.qualified, 'openai/gpt-9');
    assert.equal(r.calibrated, false);
    assert.match(r.note, /openai\/gpt-9/);
    assert.match(r.note, /no calibration recorded/);
    JUDGES.gpt.calibratedOn = 'gpt-8.5';
    const s = await resolveJudge('gpt');
    assert.equal(s.calibrated, false);
    assert.match(s.note, /gpt-8\.5/);
    JUDGES.gpt.calibratedOn = 'gpt-9';
    const t = await resolveJudge('gpt');
    assert.equal(t.calibrated, true);
    assert.equal(t.note, undefined);
  } finally { JUDGES.gpt.calibratedOn = saved; }
});

// ── llm.mjs (the OpenAI-compatible endpoint shim): a role resolves against the endpoint's own /models list ──────────
const serve = (ids) => new Promise((res) => {
  const seen = [];
  const srv = createServer((req, rsp) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: req.url, body: body ? JSON.parse(body) : null });
      rsp.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/models') return rsp.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
      if (req.url === '/v1/chat/completions') return rsp.end(JSON.stringify({ choices: [{ message: { content: `answered by ${JSON.parse(body).model}` } }] }));
      rsp.statusCode = 404; rsp.end('{}');
    });
  });
  srv.listen(0, 'localhost', () => res({ srv, seen, base: `http://localhost:${srv.address().port}/v1` }));
});
const withEndpoint = async (ids, env, fn) => {
  const s = await serve(ids);
  const saved = { ...process.env };
  try { Object.assign(process.env, { LLM_BASE_URL: s.base, LLM_API_KEY: 'test-key', ...env }); return await fn(s); }
  finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); s.srv.close(); }
};

test('llm.mjs: a role picks the newest id of its family from the endpoint\'s /models list', async () => {
  const { llm } = await import('./llm.mjs');
  await withEndpoint(['gemini-8-flash', 'gemini-9-flash', 'gemini-9-flash-lite', 'gpt-9'], { LLM_MODEL: 'gpt-9' }, async (s) => {
    assert.equal(await llm('Reply with the single word ok.', { role: 'gemini-flash' }), 'answered by gemini-9-flash');
    assert.equal(s.seen.at(-1).body.model, 'gemini-9-flash');
  });
});

test('llm.mjs: LLM_MODEL_ALIASES names the id for a role; an explicit model wins over a role; no role uses LLM_MODEL', async () => {
  const { llm } = await import('./llm.mjs');
  await withEndpoint(['gemini-9-flash', 'gpt-9'], { LLM_MODEL: 'gpt-9', LLM_MODEL_ALIASES: '{"gemini-flash": "my-flash"}' }, async () => {
    assert.equal(await llm('x', { role: 'gemini-flash' }), 'answered by my-flash');
    assert.equal(await llm('x', { role: 'gemini-flash', model: 'pinned-by-caller' }), 'answered by pinned-by-caller');
    assert.equal(await llm('x'), 'answered by gpt-9');
  });
});

test('llm.mjs: a role the endpoint does not serve fails loudly with what it serves, and sends nothing', async () => {
  const { llm } = await import('./llm.mjs');
  await withEndpoint(['gpt-9'], { LLM_MODEL: 'gpt-9' }, async (s) => {
    await assert.rejects(llm('x', { role: 'grok' }), (e) => /role 'grok'/.test(e.message) && /gpt-9/.test(e.message) && /No fallback/.test(e.message) && /LLM_MODEL_ALIASES/.test(e.message));
    assert.ok(!s.seen.some((r) => r.url.endsWith('/chat/completions')), 'no chat call was made');
  });
});

test('rag-quality: the tools ask llm.mjs for roles, never a model id', () => {
  const dir = join(HERE, 'rag-quality');
  for (const f of readdirSync(dir).filter((x) => /^mk-.*\.mjs$/.test(x))) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\bmodel\s*:\s*['"`]/, `${f} pins a model id`);
    assert.doesNotMatch(src, /\bprovider\s*:\s*['"`]/, `${f} passes a provider llm.mjs ignores`);
    assert.match(src, /\brole\s*:\s*'[a-z-]+'/, `${f} names no role`);
    for (const m of src.matchAll(/\brole\s*:\s*'([a-z-]+)'/g)) assert.ok(ROSTER.roles[m[1]], `${f}: '${m[1]}' is not a roster role`);
  }
});

// ── found in the 2026-10-03 review of this port ─────────────────────────────────────────────────────────────────────
// Started through a symlinked path (macOS /tmp is a symlink, and so may be ~/.claude), the resolver's CLI and
// opencode-llm's CLI used to print nothing and exit 0: the main-module check compared argv[1] as typed with the
// module's resolved path.
const LINK = join(tmp, 'linked-tools');
symlinkSync(HERE, LINK);
const cleanEnv = (extra) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('MODEL_ROSTER_') || k.startsWith('LLM_') || k === 'OPENCODE_BIN') delete env[k];
  return { ...env, ...extra };
};
const runCli = (file, args, env) => spawnSync('node', [join(LINK, file), ...args], { encoding: 'utf8', env: cleanEnv(env), timeout: 30000 });

test('model-roster CLI: started through a symlinked path it resolves, prints, and --check still fails', () => {
  const a = runCli('model-roster.mjs', ['--all', '--check'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'cli1'), MODEL_ROSTER_OPENCODE_BIN: FAKE });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /openai\/gpt-9/);
  const b = runCli('model-roster.mjs', ['--all', '--check'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'cli2'), MODEL_ROSTER_OPENCODE_BIN: 'none', MODEL_ROSTER_POLICY: 'none' });
  assert.equal(b.status, 1);
  assert.match(b.stderr, /UNRESOLVED/);
});

test('opencode-llm CLI: started through a symlinked path it makes the call and prints the reply', () => {
  clearLog();
  const r = runCli('opencode-llm.mjs', ['Reply with the single word ok.', '--role', 'gpt'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'cli3'), OPENCODE_BIN: FAKE });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ok from fake');
  assert.equal(lastArgs()[3], 'openai/gpt-9');
});

// Review and fan-out callers go ahead with a new id, with a visible note; a stale cache id is visible too.
test('opencode-llm: a role whose id changed goes ahead with the new id and says so on stderr', () => {
  const cache = join(tmp, 'cli4');
  const v1 = fakeOpencode('fake-v1.sh', 'acme/gpt-6\n'), v2 = fakeOpencode('fake-v2.sh', 'acme/gpt-7\n');
  const a = runCli('opencode-llm.mjs', ['x', '--role', 'gpt'], { MODEL_ROSTER_CACHE_DIR: cache, OPENCODE_BIN: v1 });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stderr, '', 'a first sighting is not a change');
  const b = runCli('opencode-llm.mjs', ['x', '--role', 'gpt'], { MODEL_ROSTER_CACHE_DIR: cache, OPENCODE_BIN: v2 });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout.trim(), 'ok from fake');
  assert.match(b.stderr, /role 'gpt' is now acme\/gpt-7 \(was gpt-6\)/);
});

test('opencode-llm: an id taken from the last-known-good cache (opencode models failed) is flagged on stderr', () => {
  const cache = join(tmp, 'cli5');
  const v = fakeOpencode('fake-v3.sh', 'acme/gpt-7\n');
  assert.equal(runCli('opencode-llm.mjs', ['x', '--role', 'gpt'], { MODEL_ROSTER_CACHE_DIR: cache, OPENCODE_BIN: v }).status, 0);
  const broken = join(tmp, 'fake-models-broken.sh');
  writeFileSync(broken, `#!/bin/sh\nif [ "$1" = models ]; then echo 'models: unavailable' >&2; exit 3; fi\nprintf '%s\\n' "$@" > "${LOG}.args"\necho 'ok from fake'\n`, { mode: 0o755 });
  clearLog();
  const r = runCli('opencode-llm.mjs', ['x', '--role', 'gpt'], { MODEL_ROSTER_CACHE_DIR: cache, OPENCODE_BIN: broken });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lastArgs()[3], 'acme/gpt-7');
  assert.match(r.stderr, /role 'gpt'/);
  assert.match(r.stderr, /stale|last-known/i);
  assert.match(r.stderr, /acme\/gpt-7/);
  assert.equal(r.stderr.trim().split('\n').length, 1, 'the note is one line');
});

test('the session-start notice is documented where the kit says how to wire hooks', () => {
  assert.match(readFileSync(join(HERE, 'VOICE-SYSTEM.md'), 'utf8'), /model-roster\.mjs --notice/);
  assert.match(readFileSync(join(HERE, '..', 'settings.json.example'), 'utf8'), /model-roster\.mjs --notice/);
});

// llm.mjs resolves through the same resolve() as everything else: same ambiguity rule, same cache and change log.
test('llm.mjs: two providers listing one family is an ambiguity error, not the last one listed', async () => {
  const { modelForRole } = await import('./llm.mjs');
  await withEndpoint(['anthropic/claude-sonnet-9', 'router/claude-sonnet-9', 'gpt-9'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'llm1') }, async (s) => {
    await assert.rejects(modelForRole('sonnet', { base: s.base, key: 'k' }), (e) => /ambiguous/.test(e.message) && /router/.test(e.message) && /anthropic/.test(e.message));
  });
});

test('llm.mjs: a resolved role is cached and a changed id is logged, under its own scope', async () => {
  const { modelForRole } = await import('./llm.mjs');
  const dir = join(tmp, 'llm2');
  await withEndpoint(['gemini-9-flash'], { MODEL_ROSTER_CACHE_DIR: dir }, async (s) => { assert.equal(await modelForRole('gemini-flash', { base: s.base, key: 'k' }), 'gemini-9-flash'); });
  await withEndpoint(['vendor/gemini-10-flash'], { MODEL_ROSTER_CACHE_DIR: dir }, async (s) => { assert.equal(await modelForRole('gemini-flash', { base: s.base, key: 'k' }), 'vendor/gemini-10-flash'); });
  const cache = JSON.parse(readFileSync(join(dir, 'resolved.json'), 'utf8'));
  assert.equal(cache.roles['gemini-flash@llm-endpoint'].id, 'gemini-10-flash');
  assert.equal(cache.roles['gemini-flash'], undefined, 'kept apart from the opencode pick');
  assert.match(readFileSync(join(dir, 'changes.log'), 'utf8'), /\tgemini-flash@llm-endpoint\tgemini-9-flash -> gemini-10-flash\t/);
});

// A common public install lists each lab's own provider plus a router that re-serves several of them.
const PUBLIC_SETUP = ['anthropic/claude-opus-4-1', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-haiku-4-5', 'openai/gpt-5', 'openai/gpt-5-mini',
  'github-copilot/claude-sonnet-4.5', 'github-copilot/gpt-5', 'github-copilot/gpt-5-mini', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'xai/grok-4'].join('\n') + '\n';
test('a provider per role (MODEL_ROSTER_PROVIDERS) settles an install where a router re-serves several labs', () => {
  const fake = fakeOpencode('fake-public.sh', PUBLIC_SETUP);
  const a = runCli('model-roster.mjs', ['--all', '--check'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'pub1'), MODEL_ROSTER_OPENCODE_BIN: fake });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /sonnet .*ambiguous.*MODEL_ROSTER_PROVIDERS/);
  const b = runCli('model-roster.mjs', ['--all', '--check', '--json'], { MODEL_ROSTER_CACHE_DIR: join(tmp, 'pub2'), MODEL_ROSTER_OPENCODE_BIN: fake, MODEL_ROSTER_PROVIDERS: 'sonnet=anthropic,gpt=openai,gpt-mini=openai' });
  assert.equal(b.status, 0, b.stderr);
  const j = JSON.parse(b.stdout);
  assert.deepEqual(j.errors, {});
  assert.equal(j.roles.sonnet.qualified, 'anthropic/claude-sonnet-4-5');
  assert.equal(j.roles.gpt.qualified, 'openai/gpt-5');
  assert.equal(j.roles['gpt-mini'].qualified, 'openai/gpt-5-mini');
  assert.equal(j.roles.grok.qualified, 'xai/grok-4');
  assert.equal(j.roles['gemini-pro'].qualified, 'google/gemini-2.5-pro');
});

test('the vendored resolver gives only roles this kit defines as examples, and no @tag aliases', () => {
  const src = readFileSync(join(HERE, 'model-roster.mjs'), 'utf8');
  const m = /ROLE \(a name model-roster\.json defines, such as ([^)]*)\)/.exec(src.replace(/\n \* /g, ' '));
  assert.ok(m, 'the header names example roles');
  for (const r of m[1].split(/,\s*|\s+or\s+/).map((x) => x.trim()).filter(Boolean)) assert.ok(ROSTER.roles[r], `header example '${r}' is not a role in this kit`);
  assert.deepEqual(src.match(/@[a-z]+/gi) || [], [], 'no @tag examples in the resolver');
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
