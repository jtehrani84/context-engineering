#!/usr/bin/env node
/**
 * scrub.test.mjs - proof for the leak-scan gate. Exit 1 on any failure.
 * Fixtures are assembled from fragments so this file does not trip the scanner it tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanTree, loadDenylist } from './scrub.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));

const has = (hits, kind) => hits.some(h => h.startsWith(kind + ':'));

// generic detectors fire on the shapes they claim, and stay quiet on clean prose
ok(has(scanText('host at ' + ['10', '0', '0', '7'].join('.')), 'dotted-ip'), 'IP address flagged');
ok(has(scanText('key ' + ['1234abcd', '12ab', '34cd', '56ef', '1234567890ab'].join('-')), 'uuid-or-key'), 'UUID-shaped key flagged');
ok(has(scanText('token ' + 'sk-' + 'A'.repeat(24)), 'api-key'), 'sk- API key shape flagged');
ok(has(scanText('-----BEGIN ' + 'PRIVATE KEY-----'), 'private-key'), 'private key header flagged');
ok(has(scanText('mail ' + 'someone' + '@' + 'example.org'), 'email'), 'email flagged');
ok(has(scanText('path /' + 'Users' + '/jdoe/project'), 'abs-home'), 'absolute home path flagged');
ok(has(scanText('a $' + '2.4M deal'), 'deal-$'), 'deal amount flagged');
ok(scanText('Plain prose about guards, with 3 tests and version 1.2 only.').length === 0, 'clean prose -> no hits');

// denylist terms + patterns; whole-word, case-insensitive; empty denylist flags nothing extra
ok(has(scanText('We met Example Widgets yesterday', { terms: ['example widgets'] }), 'deny'), 'denylist term flagged (case-insensitive)');
ok(!has(scanText('We met Example Widgetsville yesterday', { terms: ['Example Widgets'] }), 'deny'), 'term is whole-word (no partial match)');
ok(has(scanText('see proj-ab12cd here', { patterns: ['proj-[a-z0-9]{6}'] }), 'deny-pattern'), 'denylist pattern flagged');
ok(scanText('nothing here', { terms: [], patterns: [] }).length === 0, 'empty denylist flags nothing');

// tier: your publicTerms are only gated in the "anyone" tier
ok(scanText('built on Widgetron Cloud', { publicTerms: ['Widgetron'] }).length === 0, 'default tier does not flag publicTerms');
ok(has(scanText('built on Widgetron Cloud', { tier: 'anyone', publicTerms: ['Widgetron'] }), 'public-term'), 'anyone tier flags publicTerms');

// the shipped example denylist is EMPTY
const ex = loadDenylist(path.join(HERE, 'denylist.example.json'));
ok(ex.terms.length === 0 && ex.patterns.length === 0, 'shipped denylist.example.json is empty (never ships real terms)');
ok(!fs.existsSync(path.join(HERE, 'denylist.local.json')), 'no denylist.local.json is shipped');

// tree scan + CLI exit codes
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-'));
fs.mkdirSync(path.join(tmp, 'node_modules'));
fs.writeFileSync(path.join(tmp, 'clean.md'), 'All clear here.\n');
fs.writeFileSync(path.join(tmp, 'node_modules', 'skipped.md'), 'host ' + ['10', '0', '0', '7'].join('.'));
let r = scanTree(tmp);
ok(r.scanned === 1 && r.flagged.length === 0, 'tree scan: clean tree, ignored dirs skipped');
let cli = spawnSync(process.execPath, [path.join(HERE, 'scrub.mjs'), tmp], { encoding: 'utf8' });
ok(cli.status === 0 && /CLEAN/.test(cli.stdout), 'CLI exits 0 on a clean tree');

fs.writeFileSync(path.join(tmp, 'leak.md'), 'Call Example Widgets at ' + ['10', '0', '0', '7'].join('.') + '\n');
const denyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-deny-'));
const denyFile = path.join(denyDir, 'my-denylist.json'); // outside the scanned tree
fs.writeFileSync(denyFile, JSON.stringify({ terms: ['Example Widgets'], patterns: [] }));
cli = spawnSync(process.execPath, [path.join(HERE, 'scrub.mjs'), tmp, '--denylist', denyFile, '--json'], { encoding: 'utf8' });
const j = JSON.parse(cli.stdout);
ok(cli.status === 1 && j.flaggedCount === 1 && j.flagged[0].hits.some(h => h === 'deny:Example Widgets'), 'CLI exits 1 and reports the denylist hit + the IP');
cli = spawnSync(process.execPath, [path.join(HERE, 'scrub.mjs'), tmp, '--json'], { encoding: 'utf8', env: { ...process.env, SCRUB_DENYLIST: denyFile } });
ok(cli.status === 1 && JSON.parse(cli.stdout).denylistEntries === 1, 'SCRUB_DENYLIST env var is honored');
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(denyDir, { recursive: true, force: true });

console.log(`scrub.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
