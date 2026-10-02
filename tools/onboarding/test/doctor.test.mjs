// doctor.test.mjs: voice-doctor.mjs catches each failure it claims to catch.
//
// Every check in voice-doctor.mjs lists the failures it catches (CHECKS[].catches, printed by --list). FIXTURES below
// has one broken install per listed failure; each test builds that install, runs the doctor on the one check, and
// asserts the status it must report. A coverage test fails when a listed failure has no fixture or a fixture names a
// failure the doctor no longer lists, so the list and the tests can't drift apart.
//
// Run: node --test onboarding/test/   (or node --test onboarding/test/doctor.test.mjs)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, appendFileSync, existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { engineModules, enginePaths, runScorer } from '../lib/engine.mjs';
import { spawnSync } from 'node:child_process';
import { makeInstall, writeGoodReport, overlaySource, binDir, stubCommand, evalIn, readJson, snapshot, diffSnapshots, ONBOARDING, SRC_TOOLS, HAVE_PYTHON } from './helpers.mjs';

const DOCTOR = join(ONBOARDING, 'voice-doctor.mjs');
const HOOK_LIB = join(ONBOARDING, 'lib', 'hook.mjs');
const tool = (inst, name, body) => writeFileSync(join(inst.tools, name), `${body}\n`);
const settingsBlock = (inst) => readJson(inst.settingsPath);
const hookCommand = (inst) => settingsBlock(inst).hooks.PreToolUse[0].hooks[0].command;
const detectorPatterns = join(SRC_TOOLS, 'avoid-ai-writing', 'detector', 'patterns.js');
// A stand-in CLI that reads stdin and prints `json(input)`.
const echoJson = (fn) => `let s = ''; process.stdin.on('data', (d) => { s += d; }).on('end', () => { console.log(JSON.stringify((${fn})(s))); });`;

// One fixture per listed failure. setup(inst) breaks the install and may return { env, args, install }.
// `install` options (passed to makeInstall) go in `install`, run before setup.
export const FIXTURES = [
  // runtime
  { check: 'runtime', catches: 'Node.js older than 18', unit: true },
  { check: 'runtime', catches: 'python3 missing', expect: 'FAIL', match: /python3 is not on PATH/,
    setup: (inst) => ({ env: { PATH: binDir(join(inst.root, 'bin-no-python'), { python: false }) } }) },
  // config
  { check: 'config', catches: 'config that is not valid JSON', expect: 'FAIL', match: /not valid JSON/, setup: (inst) => inst.writeConfig('{ "version": 1,') },
  { check: 'config', catches: 'config that breaks the schema', expect: 'FAIL', match: /detBar/, setup: (inst) => inst.writeConfig({ strictness: { detBar: 500 } }) },
  { check: 'config', catches: 'a judge from the drafter\'s lab', expect: 'FAIL', match: /drafter's lab/,
    setup: (inst) => inst.writeConfig({ judges: { mode: 'single', drafterLab: 'anthropic', allowed: [{ name: 'claude', lab: 'anthropic' }] } }) },
  { check: 'config', catches: 'a config that lets samples leave the machine', expect: 'FAIL', match: /samplesLeaveMachine/,
    setup: (inst) => inst.writeConfig({ data: { samplesLeaveMachine: true } }) },
  // engine
  { check: 'engine', catches: 'a missing scorer, gate or normalizer', expect: 'FAIL', match: /missing in .*prose-gate\.mjs/, setup: (inst) => rmSync(join(inst.tools, 'prose-gate.mjs')) },
  // detector
  { check: 'detector', catches: 'detector missing', expect: 'FAIL', match: /no detector at/,
    setup: (inst) => ({ env: { AVOID_AI_DETECTOR: join(inst.root, 'no-detector', 'detector', 'patterns.js') } }) },
  { check: 'detector', catches: 'detector that does not load', expect: 'FAIL', match: /doesn't load or has no analyzeText/,
    setup: (inst) => { const p = join(inst.root, 'bad-detector', 'detector', 'patterns.js'); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'module.exports = {'); return { env: { AVOID_AI_DETECTOR: p } }; } },
  // detector-pin
  { check: 'detector-pin', catches: 'detector at another commit', expect: 'FAIL', match: /checkout is at [0-9a-f]{7}, the tested commit is 58a95fc/,
    setup: (inst) => {
      const repo = join(inst.root, 'detector-git'), p = join(repo, 'detector', 'patterns.js');
      mkdirSync(join(repo, 'detector'), { recursive: true }); copyFileSync(detectorPatterns, p);
      const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
      git('init', '-q'); git('add', '.'); const c = git('commit', '-q', '-m', 'same bytes, other commit');
      assert.equal(c.status, 0, c.stderr);
      return { env: { AVOID_AI_DETECTOR: p } };
    } },
  { check: 'detector-pin', catches: 'detector with edited patterns', expect: 'FAIL', match: /patterns\.js sha256 is [0-9a-f]{12}, the tested file is 00618b876e04/,
    setup: (inst) => { const p = join(inst.root, 'detector-edited', 'detector', 'patterns.js'); mkdirSync(join(p, '..'), { recursive: true }); copyFileSync(detectorPatterns, p); appendFileSync(p, '\n// one local edit\n'); return { env: { AVOID_AI_DETECTOR: p } }; } },
];

FIXTURES.push(
  // scorer
  { check: 'scorer', catches: 'scorer that crashes', expect: 'FAIL', match: /fails on a plain sentence: scorer exited 1/, setup: (inst) => tool(inst, 'aiscore.mjs', "throw new Error('stand-in: the scorer crashed');") },
  { check: 'scorer', catches: 'scorer that prints no usable JSON', expect: 'FAIL', match: /printed no JSON/, setup: (inst) => tool(inst, 'aiscore.mjs', "console.log('score 3, looks fine');") },
  { check: 'scorer', catches: 'scorer that flags nothing on a known-AI probe', expect: 'FAIL', match: /flags almost nothing/,
    setup: (inst) => tool(inst, 'aiscore.mjs', echoJson('() => ({ score: 0, issueCount: 0, issueTypes: {}, voice: { issues: [] } })')) },
  { check: 'scorer', catches: 'scorer slower than half the hook budget', expect: 'WARN', match: /took \d+ ms on one sentence/, setup: () => ({ env: { VOICE_DOCTOR_SCORER_WARN_MS: '1' } }) },
  // normalizer
  { check: 'normalizer', catches: 'normalizer CLI that crashes or prints no JSON', expect: 'FAIL', match: /didn't print its JSON/, setup: (inst) => tool(inst, 'text-normalize.mjs', "throw new Error('stand-in: the normalizer crashed');") },
  { check: 'normalizer', catches: 'normalizer that leaves zero-width, look-alike or tag characters', expect: 'FAIL', match: /still has a zero-width, look-alike or tag character/,
    setup: (inst) => tool(inst, 'text-normalize.mjs', echoJson('(s) => ({ canonical: s, inputCodePoints: [...s].length })')) },
  { check: 'normalizer', catches: 'normalizer that miscounts its input', expect: 'FAIL', match: /inputCodePoints is 3/,
    setup: (inst) => tool(inst, 'text-normalize.mjs', echoJson("() => ({ canonical: 'preview code cafe A', inputCodePoints: 3 })")) },
  // gate
  { check: 'gate', catches: 'gate that crashes', expect: 'FAIL', match: /got ERROR/, setup: (inst) => tool(inst, 'prose-gate.mjs', "throw new Error('stand-in: the gate crashed');") },
  { check: 'gate', catches: 'gate that ADMITs with no judge', expect: 'FAIL', match: /a plain sentence got ADMIT/, setup: (inst) => tool(inst, 'prose-gate.mjs', echoJson("() => ({ verdict: 'ADMIT' })")) },
  { check: 'gate', catches: 'gate that misses judge-directed injection', expect: 'FAIL', match: /addressed to a grader got INCONCLUSIVE/, setup: (inst) => tool(inst, 'prose-gate.mjs', echoJson("() => ({ verdict: 'INCONCLUSIVE' })")) },
  // overlay
  { check: 'overlay', catches: 'overlay missing', expect: 'FAIL', match: /no overlay at/, setup: (inst) => rmSync(inst.overlayPath) },
  { check: 'overlay', catches: 'overlay that does not load', expect: 'FAIL', match: /overlay doesn't load/, setup: (inst) => writeFileSync(inst.overlayPath, 'export const = ;\n') },
  { check: 'overlay', catches: 'overlay missing scanVoice, hardBanCount or cadenceCount', expect: 'FAIL', match: /missing scanVoice, hardBanCount or cadenceCount/, setup: (inst) => writeFileSync(inst.overlayPath, 'export const REVIEWED = true;\n') },
  { check: 'overlay', catches: 'draft overlay not reviewed yet', expect: 'FAIL', match: /is a draft: REVIEWED is false/, setup: (inst) => writeFileSync(inst.overlayPath, overlaySource({ REVIEWED: false })) },
  { check: 'overlay', catches: 'engine reading a different overlay', expect: 'FAIL', match: /doesn't read .*other-overlay\.mjs/,
    setup: (inst) => { const p = join(inst.voice, 'other-overlay.mjs'); writeFileSync(p, overlaySource()); inst.writeConfig({ paths: { overlay: p } }); } },
);

const flatSettings = (inst) => { const c = hookCommand(inst); return { hooks: { PreToolUse: [{ matcher: settingsBlock(inst).hooks.PreToolUse[0].matcher, command: c }], PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', command: c }] } }; };
const withMatchers = (inst, pre, post) => { const c = hookCommand(inst); return { hooks: { PreToolUse: [{ matcher: pre, hooks: [{ type: 'command', command: c }] }], PostToolUse: [{ matcher: post, hooks: [{ type: 'command', command: c }] }] } }; };

FIXTURES.push(
  // hook-wiring
  { check: 'hook-wiring', catches: 'settings.json that is not valid JSON', expect: 'FAIL', match: /settings\.json: not valid JSON/, setup: (inst) => inst.writeSettings('{"hooks": ') },
  { check: 'hook-wiring', catches: 'voice hook not wired', expect: 'FAIL', match: /isn't wired/, setup: (inst) => inst.writeSettings({}) },
  { check: 'hook-wiring', catches: 'a flat hook entry Claude Code does not run', expect: 'FAIL', match: /flat form/, setup: (inst) => inst.writeSettings(flatSettings(inst)) },
  { check: 'hook-wiring', catches: 'a send matcher that misses an MCP send tool (an exact-name list never matches mcp__server__tool)', expect: 'FAIL', match: /PreToolUse matcher \(exact names\) misses 31 of 31 send tools[\s\S]*list of exact tool names/,
    setup: (inst) => inst.writeSettings(withMatchers(inst, 'slack_send_message|send_gmail_message', 'Write|Edit|MultiEdit')) },
  { check: 'hook-wiring', catches: 'a write matcher that misses Write, Edit or MultiEdit', expect: 'FAIL', match: /no PostToolUse entry covers Edit, MultiEdit/,
    setup: (inst) => inst.writeSettings(withMatchers(inst, settingsBlock(inst).hooks.PreToolUse[0].matcher, 'Write')) },
  { check: 'hook-wiring', catches: 'hook script missing', expect: 'FAIL', match: /no hook script at/, setup: (inst) => rmSync(inst.hookPath) },
  { check: 'hook-wiring', catches: 'a hook that does not treat a configured send tool as a send', expect: 'FAIL', match: /doesn't treat 30 of the configured send tools as sends/,
    setup: () => ({ env: { FAKE_HOOK_SEND: 'slack_send_message' } }) },
  { check: 'hook-wiring', catches: 'a hook that scores with a different engine', expect: 'FAIL', match: /the hook scores with .*other-tools\/aiscore\.mjs/,
    setup: (inst) => ({ env: { VOICE_AISCORE: join(inst.root, 'other-tools', 'aiscore.mjs') } }) },
  { check: 'hook-wiring', catches: 'a hook timeout shorter than the scorer budget', expect: 'WARN', match: /timeout 10 s/,
    setup: (inst) => { const s = settingsBlock(inst); for (const ev of ['PreToolUse', 'PostToolUse']) s.hooks[ev][0].hooks[0].timeout = 10; inst.writeSettings(s); } },
  // hook-controls
  { check: 'hook-controls', catches: 'a hook that denies a clean send', expect: 'FAIL', match: /denies a plain message/, setup: () => ({ env: { FAKE_HOOK_MODE: 'deny-all' } }) },
  { check: 'hook-controls', catches: 'a hook that lets an obvious tell through', expect: 'FAIL', match: /let "seamless \.\.\. streamline \.\.\. synergy" through/, setup: () => ({ env: { FAKE_HOOK_MODE: 'ignore-tells' } }) },
  // send-fails-closed
  { check: 'send-fails-closed', catches: 'a broken scorer that lets a send through', expect: 'FAIL', match: /fails open: a scorer that throws an error: the send was allowed/, setup: () => ({ env: { FAKE_HOOK_MODE: 'fail-open' } }) },
  { check: 'send-fails-closed', catches: 'a broken normalizer that lets a send through', expect: 'FAIL', match: /fails open: a normalizer that throws an error/, setup: () => ({ env: { FAKE_HOOK_MODE: 'normalizer-open' } }) },
  { check: 'send-fails-closed', catches: 'a hook that ignores VOICE_AISCORE (older than the fail-closed hook)', expect: 'FAIL', match: /ignores VOICE_AISCORE/, setup: () => ({ env: { FAKE_HOOK_MODE: 'no-env' } }) },
  // write-warns
  { check: 'write-warns', catches: 'a broken scorer that leaves a file write silent', expect: 'FAIL', match: /broken scorer, silent write: \*\*\/\*\.md /, setup: () => ({ env: { FAKE_HOOK_MODE: 'fail-open' } }) },
  { check: 'write-warns', catches: 'a nudge glob the hook ignores', expect: 'FAIL', match: /silent write: \*\*\/\*\.mdx[\s\S]*\*\*\/\*\.txt/, setup: () => ({ env: { FAKE_HOOK_EXT: '.md' } }) },
  { check: 'write-warns', catches: 'a hook that never nudges a tell in a written file', expect: 'FAIL', match: /written file with .* got no nudge/, setup: () => ({ env: { FAKE_HOOK_MODE: 'ignore-tells' } }) },
);

const judgesConfig = (allowed, mode = 'single') => ({ judges: { mode, drafterLab: 'anthropic', allowed } });
const editBudget = (inst, fn) => { const p = join(inst.tools, 'calibration', 'human-fp-budget.json'); const b = readJson(p); fn(b); writeFileSync(p, JSON.stringify(b, null, 2)); };

FIXTURES.push(
  // judges (optional: a problem is a WARN, because the gate then runs det-only)
  { check: 'judges', catches: 'a judge name the gate does not know', expect: 'WARN', match: /nosuch: not in the gate's judge registry/, setup: (inst) => inst.writeConfig(judgesConfig([{ name: 'nosuch', lab: 'xai' }])) },
  { check: 'judges', catches: 'a judge whose lab differs from the gate\'s registry', expect: 'WARN', match: /grok: the config says lab openai, the gate's registry says xai/, setup: (inst) => inst.writeConfig(judgesConfig([{ name: 'grok', lab: 'openai' }])) },
  { check: 'judges', catches: 'a missing judge backend (the gate then runs det-only)', expect: 'WARN', match: /grok: no backend command/, setup: (inst) => inst.writeConfig(judgesConfig([{ name: 'grok', lab: 'xai' }])) },
  // engine-calibration
  { check: 'engine-calibration', catches: 'no engine calibration record', expect: 'FAIL', match: /no engine calibration record/, setup: (inst) => rmSync(join(inst.tools, 'calibration'), { recursive: true, force: true }) },
  { check: 'engine-calibration', catches: 'a record with rejects on human writing', expect: 'FAIL', match: /rejects on human writing/,
    setup: (inst) => editBudget(inst, (b) => { const k = Object.keys(b.sets)[0]; b.sets[k].rejects = 2; }) },
  { check: 'engine-calibration', catches: 'no corpus manifest to re-run the budget', expect: 'WARN', match: /no corpus manifest/, setup: (inst) => rmSync(join(inst.tools, 'calibration', 'public-corpora.sha256')) },
  // user-calibration
  { check: 'user-calibration', catches: 'no calibration report', expect: 'FAIL', match: /no calibration report at/ },
  { check: 'user-calibration', catches: 'held-out samples that failed', expect: 'FAIL', match: /2 of 9 held-out samples failed/, setup: (inst) => writeGoodReport(inst, { heldOut: { failed: 2 } }) },
  { check: 'user-calibration', catches: 'a report made with an older overlay, scorer, gate or hook', expect: 'FAIL', match: /the report is stale: overlay changed since the report/,
    setup: (inst) => { writeGoodReport(inst); appendFileSync(inst.overlayPath, '// edited after calibration\n'); } },
);

// Run the doctor on one check of a broken install: { result, run }.
function runFixture(fx) {
  const inst = makeInstall(fx.install || {});
  try {
    const extra = (fx.setup && fx.setup(inst)) || {};
    const run = inst.doctor(['--only', fx.check, ...(extra.args || [])], { env: extra.env || {} });
    return { result: run.byId[fx.check], run };
  } finally { inst.cleanup(); }
}
const show = (run) => `exit ${run.code}\nstdout: ${run.stdout.slice(0, 2000)}\nstderr: ${run.stderr.slice(0, 1000)}`;

describe('voice-doctor catches each failure it lists', { concurrency: 6 }, () => {
  for (const fx of FIXTURES.filter((f) => !f.unit)) {
    test(`${fx.check}: ${fx.catches}`, { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
      const { result, run } = runFixture(fx);
      assert.ok(result, `no ${fx.check} result\n${show(run)}`);
      assert.equal(result.status, fx.expect, `${fx.check} said ${result.status}: ${result.summary}\n${result.details.join('\n')}`);
      assert.match([result.summary, ...result.details].join('\n'), fx.match);
      assert.equal(run.code, fx.expect === 'FAIL' ? 1 : 0, `exit code\n${show(run)}`);
      if (fx.expect === 'FAIL') assert.ok(result.fix || fx.check === 'gate' || fx.check === 'scorer', 'a FAIL should say how to fix it');
    });
  }
});

test('runtime: Node.js older than 18', () => {
  assert.deepEqual(evalIn(DOCTOR, "M.runtimeProblems({ node: '22.4.0', python: 'Python 3.12.1' })"), []);
  assert.match(evalIn(DOCTOR, "M.runtimeProblems({ node: '16.20.2', python: 'Python 3.12.1' })").join(';'), /Node\.js 16\.20\.2 is older than 18/);
  assert.match(evalIn(DOCTOR, "M.runtimeProblems({ node: '22.4.0', python: null })").join(';'), /python3 is not on PATH/);
});

test('every failure the doctor lists has a fixture, and every fixture is still listed', () => {
  const list = JSON.parse(spawnSync(process.execPath, [DOCTOR, '--list', '--json'], { encoding: 'utf8' }).stdout);
  const listed = list.flatMap((c) => c.catches.map((x) => `${c.id}: ${x}`));
  const covered = FIXTURES.map((f) => `${f.check}: ${f.catches}`);
  assert.deepEqual(listed.filter((x) => !covered.includes(x)), [], 'listed failures without a fixture');
  assert.deepEqual(covered.filter((x) => !listed.includes(x)), [], 'fixtures for failures the doctor no longer lists');
  assert.equal(new Set(covered).size, covered.length, 'duplicate fixtures');
});

describe('voice-doctor on a working install', { concurrency: 4 }, () => {
  test('a calibrated install is GREEN: every check passes, judges report det-only mode, exit 0', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
    const inst = makeInstall();
    try {
      writeGoodReport(inst);
      const before = snapshot(inst.root);
      const run = inst.doctor();
      assert.equal(run.code, 0, show(run));
      for (const r of run.json.results) assert.equal(r.status, r.id === 'judges' ? 'INFO' : 'PASS', `${r.id}: ${r.summary}`);
      assert.match(run.byId.judges.summary, /det-only mode/);
      assert.equal(run.json.results.length, 16);
      // It never changes the user's files: the whole install (HOME, TMPDIR, cwd) is byte-identical afterwards.
      assert.deepEqual(diffSnapshots(before, snapshot(inst.root)), { added: [], removed: [], changed: [] });
      const text = inst.run('voice-doctor.mjs', ['--skip', 'send-fails-closed,write-warns']);
      assert.equal(text.code, 0);
      assert.match(text.stdout, /^PASS  runtime /m);
      assert.match(text.stdout, /^GREEN  13 pass, 0 fail, 0 warn, 1 info \(a subset of the checks\)$/m);
    } finally { inst.cleanup(); }
  });

  test('a FAIL turns the summary RED with exit 1, and a usage error exits 2', () => {
    const inst = makeInstall();
    try {
      const run = inst.run('voice-doctor.mjs', ['--only', 'config,user-calibration']);
      assert.equal(run.code, 1);
      assert.match(run.stdout, /^FAIL  user-calibration +no calibration report/m);
      assert.match(run.stdout, /^ {6}fix: run calibrate-user\.mjs/m);
      assert.match(run.stdout, /^RED  1 pass, 1 fail, 0 warn, 0 info/m);
      assert.equal(inst.run('voice-doctor.mjs', ['--only', 'no-such-check']).code, 2);
      assert.equal(inst.run('voice-doctor.mjs', ['--bogus']).code, 2);
    } finally { inst.cleanup(); }
  });

  test('judges: an allowed judge with a backend command passes without being called', () => {
    const inst = makeInstall();
    try {
      const log = join(inst.root, 'judge-calls.log');
      const bin = stubCommand(join(inst.root, 'judge-bin', 'opencode'), log, 'no answer');
      inst.writeConfig({ judges: { mode: 'consensus', drafterLab: 'anthropic', allowed: [{ name: 'grok', lab: 'xai', command: bin }, { name: 'gpt', lab: 'openai', command: bin }] } });
      const run = inst.doctor(['--only', 'judges']);
      assert.equal(run.byId.judges.status, 'PASS', run.byId.judges.summary);
      assert.match(run.byId.judges.summary, /consensus: grok, gpt configured \(not called/);
      assert.equal(existsSync(log), false, 'the judge backend was called without --live-judges');
    } finally { inst.cleanup(); }
  });

  test('--print-hooks: the send matcher reaches every send tool under any MCP server, the write matcher every file tool', () => {
    const inst = makeInstall();
    try {
      const block = JSON.parse(inst.run('voice-doctor.mjs', ['--print-hooks']).stdout);
      const pre = block.hooks.PreToolUse[0].matcher, post = block.hooks.PostToolUse[0].matcher;
      assert.match(block.hooks.PreToolUse[0].hooks[0].command, /^python3 ~\/\.claude\/hooks\/scripts\/voice-tell-gate\.py$/);
      const m = (matcher, name) => evalIn(HOOK_LIB, `M.matcherMatches(${JSON.stringify(matcher)}, ${JSON.stringify(name)})`);
      for (const name of ['mcp__slack__slack_send_message', 'mcp__plugin_mail-tools_server__send_gmail_message', 'mcp__github__create_pull_request']) assert.equal(m(pre, name), true, name);
      for (const name of ['mcp__slack__slack_read_channel', 'Write', 'Bash']) assert.equal(m(pre, name), false, name);
      for (const name of ['Write', 'Edit', 'MultiEdit']) assert.equal(m(post, name), true, name);
      // Claude Code reads a plain word list as exact names, so a bare tool suffix never matches an MCP tool.
      assert.equal(m('slack_send_message', 'mcp__slack__slack_send_message'), false);
      assert.equal(m('.*slack_send_message', 'mcp__slack__slack_send_message'), true);
    } finally { inst.cleanup(); }
  });
});

// The shipped hook (VOICE_HOOK, else hook/voice-tell-gate.py in this repo), copied into a throwaway install. Set
// VOICE_HOOK=~/.claude/hooks/scripts/voice-tell-gate.py to check the installed copy. The original is only read.
const REAL_HOOK = process.env.VOICE_HOOK || join(ONBOARDING, '..', 'hook', 'voice-tell-gate.py');
test('the shipped voice hook passes the wiring and fail-closed checks', { skip: (!existsSync(REAL_HOOK) || !HAVE_PYTHON) && `no hook at ${REAL_HOOK}` }, () => {
  const inst = makeInstall({ hook: REAL_HOOK });
  try {
    const run = inst.doctor(['--only', 'hook-wiring,hook-controls,send-fails-closed,write-warns']);
    for (const id of ['hook-wiring', 'hook-controls', 'send-fails-closed', 'write-warns']) {
      const r = run.byId[id];
      assert.ok(r, `${id} missing\n${show(run)}`);
      assert.equal(r.status, 'PASS', `${id}: ${r.summary}\n${r.details.join('\n')}`);
    }
  } finally { inst.cleanup(); }
});

test('merge-hooks.mjs fixes a miswired settings.json, keeps every other hook, backs the file up, and is idempotent', { skip: !HAVE_PYTHON && 'python3 is required' }, () => {
  const inst = makeInstall();
  try {
    const c = hookCommand(inst);
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/.claude/hooks/scripts/other-guard.py' }] };
    const broken = { model: 'keep-me', hooks: { PreToolUse: [other, { matcher: 'slack_send_message', hooks: [{ type: 'command', command: c }] }], PostToolUse: [{ matcher: 'Write', command: c }] } };
    inst.writeSettings(broken);
    assert.equal(inst.doctor(['--only', 'hook-wiring']).byId['hook-wiring'].status, 'FAIL');
    const dry = inst.run('merge-hooks.mjs', ['--dry-run']);
    assert.equal(dry.code, 0, dry.stderr);
    assert.deepEqual(readJson(inst.settingsPath), broken, '--dry-run changed the file');
    const r = inst.run('merge-hooks.mjs');
    assert.equal(r.code, 0, r.stderr);
    const backup = r.stdout.match(/the original is (\S+)\)/)[1];
    assert.deepEqual(readJson(backup), broken);
    const s = readJson(inst.settingsPath);
    assert.equal(s.model, 'keep-me');
    assert.deepEqual(s.hooks.PreToolUse[0], other);
    assert.equal(JSON.stringify(s).split('voice-tell-gate.py').length - 1, 2, 'one PreToolUse and one PostToolUse voice entry');
    assert.equal(inst.doctor(['--only', 'hook-wiring']).byId['hook-wiring'].status, 'PASS');
    const again = inst.run('merge-hooks.mjs');
    assert.match(again.stdout, /already wires the voice hook/);
    inst.writeSettings('{"hooks": ');
    assert.equal(inst.run('merge-hooks.mjs').code, 1);
    assert.equal(readFileSync(inst.settingsPath, 'utf8'), '{"hooks": ');
  } finally { inst.cleanup(); }
});

// The engine's overlay file is ./voice-overlay.mjs with the kit interface (2026-10-02 fix: it imported a per-person
// file under per-person names, so a kit overlay copied to voice-overlay.mjs was never read and copying it over the
// imported file broke the scorer). A plain copy of the engine modules plus a kit overlay at voice-overlay.mjs must
// read that overlay, and the engine's module list must not reach any other overlay file.
test('the engine reads a kit overlay installed at voice-overlay.mjs, and its module list holds no other overlay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-engine-plain-'));
  try {
    const mods = engineModules(SRC_TOOLS);
    assert.ok(mods.includes('voice-overlay.mjs'), `the engine doesn't import ./voice-overlay.mjs (modules: ${mods.join(', ')})`);
    assert.deepEqual(mods.filter((m) => /overlay/.test(m) && m !== 'voice-overlay.mjs'), [], 'the engine module list reaches another overlay file');
    for (const f of mods) if (f !== 'voice-overlay.mjs') copyFileSync(join(SRC_TOOLS, f), join(dir, f));
    symlinkSync(join(SRC_TOOLS, 'avoid-ai-writing'), join(dir, 'avoid-ai-writing'));
    const probe = 'voice-probe-00c0ffee00c0ffee';
    writeFileSync(join(dir, 'voice-overlay.mjs'), overlaySource({ PROBE: probe }));
    const r = runScorer(enginePaths(dir), `Probe sentence ${probe}.`);
    assert.ok(r.ok, r.error);
    assert.ok(r.issues.some((i) => /-probe$/.test(i.type) && i.text === probe), 'the engine did not read the overlay at voice-overlay.mjs');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
