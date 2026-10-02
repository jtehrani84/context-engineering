// profile-build.test.mjs: profile-build.mjs writes one draft file and nothing else, never touches the network, and
// never prints sample text.
//
// The network is stubbed three ways: a sentinel TCP server on 127.0.0.1 that every proxy variable points at (any
// connection counts as a leak), a stand-in judge backend command that logs any call, and VOICE_LOCAL_ONLY_LOG, which
// records every network call the local-only guard refuses (so an empty log shows nothing even tried). A last test
// preloads a spy that tries the network inside profile-build and its child processes and checks each try is refused.
//
// Run: node --test onboarding/test/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeInstall, writeSamples, stubCommand, snapshot, diffSnapshots, evalIn, LOCAL_ONLY, HAVE_PYTHON } from './helpers.mjs';
import { consistentWriter } from './fixtures/synthetic-writer.mjs';

let sentinel, port, connections = 0;
before(async () => {
  sentinel = createServer((s) => { connections++; s.destroy(); });
  await new Promise((r) => sentinel.listen(0, '127.0.0.1', r));
  port = sentinel.address().port;
});
after(() => sentinel.close());

// Every environment variable a careless HTTP client would follow, pointed at the sentinel.
const trapEnv = () => {
  const url = `http://127.0.0.1:${port}`;
  return { HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url, NO_PROXY: '', no_proxy: '' };
};
// A config that would give a careless tool somewhere to send samples: two judges with a logging backend command.
const judgeConfig = (bin) => ({ judges: { mode: 'consensus', drafterLab: 'anthropic', allowed: [{ name: 'grok', lab: 'xai', command: bin }, { name: 'gpt', lab: 'openai', command: bin }], aiDraftsToJudges: true } });

const SAMPLES = consistentWriter(30, 11);
// Whole sentences from the samples: none may appear in anything profile-build prints.
const SENTENCES = [...new Set(SAMPLES.flatMap((t) => t.split(/(?<=\.)\s+/)).filter((s) => s.split(' ').length >= 6))];
const printsNoSampleText = (out) => { for (const s of SENTENCES) assert.ok(!out.includes(s), `printed sample text: ${s}`); };

function setup() {
  const judgeLog = 'judge-calls.log';
  const inst = makeInstall();
  const bin = stubCommand(join(inst.root, 'judge-bin', 'opencode'), join(inst.root, judgeLog), 'no answer');
  inst.writeConfig(judgeConfig(bin));
  writeSamples(join(inst.voice, 'samples'), SAMPLES);
  return { inst, judgeLog: join(inst.root, judgeLog), netLog: join(inst.root, 'net-refused.log'), env: { ...trapEnv(), OPENCODE_BIN: bin, VOICE_LOCAL_ONLY_LOG: join(inst.root, 'net-refused.log') } };
}

describe('profile-build', { concurrency: 3 }, () => {
  test('writes exactly one file, the draft at --out (and its new parent folders), and nothing else anywhere in HOME, TMPDIR or the working folder', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
    const { inst, env, judgeLog, netLog } = setup();
    try {
      const out = join(inst.root, 'drafts', 'new', 'voice-overlay.draft.mjs');
      const before = snapshot(inst.root), seen = connections;
      const r = inst.run('profile-build.mjs', ['--out', out], { env });
      assert.equal(r.code, 0, r.stderr);
      const d = diffSnapshots(before, snapshot(inst.root));
      assert.deepEqual(d, { added: ['drafts', 'drafts/new', 'drafts/new/voice-overlay.draft.mjs'], removed: [], changed: [] });
      assert.equal(connections, seen, 'a connection reached the sentinel server');
      assert.equal(existsSync(judgeLog), false, 'the judge backend command ran');
      assert.equal(existsSync(netLog), false, `the local-only guard refused a network call:\n${existsSync(netLog) ? readFileSync(netLog, 'utf8') : ''}`);
      printsNoSampleText(r.stdout + r.stderr);
      assert.match(r.stdout, /30 used \(0 skipped\): 21 tune, 9 held out/);
    } finally { inst.cleanup(); }
  });

  test('the draft loads, starts unreviewed, and records counts and statistics', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
    const { inst, env } = setup();
    try {
      const out = join(inst.voice, 'voice-overlay.draft.mjs');
      const r = inst.run('profile-build.mjs', ['--json'], { env });
      assert.equal(r.code, 0, r.stderr);
      const summary = JSON.parse(r.stdout);
      assert.equal(summary.out, out);
      assert.deepEqual(summary.samples, { read: 30, used: 30, skipped: 0, tune: 21, heldOut: 9 });
      printsNoSampleText(r.stdout);
      const m = evalIn(out, '({ reviewed: M.REVIEWED, calibrated: M.CALIBRATED, probe: M.PROBE, scan: M.scanVoice(`x ${M.PROBE}`).map((i) => i.type), register: M.REGISTER, samples: M.PROFILE.samples, median: M.PROFILE.stats.sentenceWords.median, notes: M.NOTES.length })', inst.env);
      assert.equal(m.reviewed, false);
      assert.equal(m.calibrated, false);
      assert.deepEqual(m.scan, ['voice-probe']);
      assert.deepEqual(m.samples, summary.samples);
      assert.ok(m.median >= 8 && m.median <= 20, `median sentence ${m.median}`);
      assert.ok(m.register.sentenceMedian && m.register.emDash, 'register bands from 21 tune samples');
      assert.ok(m.notes >= 3);
    } finally { inst.cleanup(); }
  });

  test('reads samples from stdin cut at ---8<--- lines, with the same split', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
    const { inst, env } = setup();
    try {
      const out = join(inst.root, 'stdin-draft.mjs');
      const r = inst.run('profile-build.mjs', ['--samples', '-', '--out', out, '--json', '--no-hook'], { env, input: SAMPLES.join('\n---8<---\n') });
      assert.equal(r.code, 0, r.stderr);
      const s = JSON.parse(r.stdout);
      assert.deepEqual(s.samples, { read: 30, used: 30, skipped: 0, tune: 21, heldOut: 9 });
      const fromDir = JSON.parse(inst.run('profile-build.mjs', ['--out', join(inst.root, 'dir-draft.mjs'), '--json', '--no-hook'], { env }).stdout);
      assert.equal(s.split.fingerprint, fromDir.split.fingerprint, 'the held-out split depends only on the sample texts');
    } finally { inst.cleanup(); }
  });

  test('refuses, and writes nothing, for the installed overlay, an existing draft, a URL, or too few samples', () => {
    const { inst, env } = setup();
    try {
      const existing = join(inst.root, 'existing.mjs');
      writeFileSync(existing, '// keep me\n');
      mkdirSync(join(inst.root, 'few'));
      writeSamples(join(inst.root, 'few'), SAMPLES.slice(0, 3));
      const before = snapshot(inst.root);
      const cases = [
        [['--out', inst.overlayPath], 1, /is the installed overlay/],
        [['--out', existing], 1, /exists; pass --force/],
        [['--out', join(inst.root, 'draft.txt')], 1, /must be a \.mjs file/],
        [['--samples', 'https://example.com/samples', '--out', join(inst.root, 'a.mjs')], 1, /looks like a URL/],
        [['--out', 'https://example.com/upload.mjs'], 1, /looks like a URL/],
        [['--samples', '//server/share', '--out', join(inst.root, 'b.mjs')], 1, /network path/],
        [['--samples', join(inst.root, 'few'), '--out', join(inst.root, 'c.mjs')], 2, /3 usable samples; need at least 4/],
        [['--samples', join(inst.root, 'missing'), '--out', join(inst.root, 'd.mjs')], 2, /can't read samples/],
        [['--bogus'], 1, /unknown argument/],
      ];
      for (const [args, code, rx] of cases) {
        const r = inst.run('profile-build.mjs', args, { env });
        assert.equal(r.code, code, `${args.join(' ')}: ${r.stderr}`);
        assert.match(r.stderr, rx);
      }
      assert.deepEqual(diffSnapshots(before, snapshot(inst.root)), { added: [], removed: [], changed: [] });
      assert.equal(readFileSync(existing, 'utf8'), '// keep me\n');
    } finally { inst.cleanup(); }
  });
});

// The code a test runs to try the network: one line per entry point, 'refused' or what happened instead.
const TRY_NETWORK = (port) => `
  const tries = {
    fetch: () => fetch('http://127.0.0.1:${port}/'),
    'http.request': () => require('http').request('http://127.0.0.1:${port}/').end(),
    'https.get': () => require('https').get('https://127.0.0.1:${port}/'),
    'net.connect': () => require('net').connect(${port}, '127.0.0.1'),
    'net.Socket.connect': () => new (require('net').Socket)().connect(${port}, '127.0.0.1'),
    'tls.connect': () => require('tls').connect(${port}, '127.0.0.1'),
    'dns.lookup': () => require('dns').lookup('example.com', () => {}),
    'dgram.createSocket': () => require('dgram').createSocket('udp4'),
  };
  const outcome = {};
  for (const [k, f] of Object.entries(tries)) {
    try { const r = f(); if (r && typeof r.on === 'function') r.on('error', () => {}); if (r && typeof r.catch === 'function') r.catch(() => {}); outcome[k] = 'not refused'; }
    catch (e) { outcome[k] = e.constructor.name === 'NetworkRefused' ? 'refused' : 'threw ' + e.constructor.name; }
  }`;

describe('the network stub', { concurrency: 2 }, () => {
  test('the local-only guard refuses every Node network entry point before it connects, and logs each try', () => {
    const { inst } = setup();
    try {
      const log = join(inst.root, 'refused.log'), seen = connections;
      const code = `const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);${TRY_NETWORK(port)}
  console.log(JSON.stringify(outcome));`;
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(LOCAL_ONLY).href, '--input-type=module', '-e', code], { env: { ...inst.env, VOICE_LOCAL_ONLY_LOG: log }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const outcome = JSON.parse(r.stdout.trim());
      for (const [k, v] of Object.entries(outcome)) assert.equal(v, 'refused', k);
      assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, Object.keys(outcome).length);
      assert.equal(connections, seen, 'a connection reached the sentinel server');
    } finally { inst.cleanup(); }
  });

  test('inside profile-build and every Node process it starts, a network call is refused', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
    const { inst, env } = setup();
    try {
      const spyLog = join(inst.root, 'spy.log'), spy = join(inst.root, 'spy.cjs'), seen = connections;
      // The spy is preloaded before profile-build's own code and tries the network as each process exits.
      writeFileSync(spy, `process.on('exit', () => {${TRY_NETWORK(port)}
  require('fs').appendFileSync(${JSON.stringify(spyLog)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(1, 2).map((a) => require('path').basename(a)), outcome }) + '\\n');
});\n`);
      const r = inst.run('profile-build.mjs', ['--out', join(inst.root, 'spied.mjs')], { env: { ...env, VOICE_LOCAL_ONLY_LOG: '', NODE_OPTIONS: `--require=${spy}` } });
      assert.equal(r.code, 0, r.stderr);
      const lines = readFileSync(spyLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const scripts = new Set(lines.flatMap((l) => l.argv));
      assert.ok(scripts.has('profile-build.mjs'), `the spy ran in: ${[...scripts].join(', ')}`);
      assert.ok(scripts.has('aiscore.mjs'), `the scorer child ran with the guard: ${[...scripts].join(', ')}`);
      for (const l of lines) for (const [k, v] of Object.entries(l.outcome)) assert.equal(v, 'refused', `${l.argv[0]} ${k}`);
      assert.equal(connections, seen, 'a connection reached the sentinel server');
    } finally { inst.cleanup(); }
  });
});
