#!/usr/bin/env node
/**
 * scrub.mjs - the LEAK-SCAN GATE for anything you are about to publish.
 *
 * Scans a tree for internal markers and exits non-zero if any are found. Run it as a pre-commit,
 * pre-push or CI check on every package you emit; nothing ships until it passes clean. Read-only.
 *
 * Two layers:
 *   1. Generic detectors (built in, value-agnostic): IP addresses, Slack channel IDs,
 *      UUID-shaped keys, common API-key shapes, private-key headers, email addresses, dollar figures,
 *      and absolute home-directory paths.
 *   2. YOUR denylist (private, never committed): customer names, account names, internal hostnames,
 *      project IDs, codenames, people. Put them in a JSON file:
 *        { "terms": ["Example Customer", "internal-host.example"], "patterns": ["proj-[a-z0-9]{6}"],
 *          "publicTerms": ["Your Company", "Internal Product Name"] }
 *      "terms" match as whole words, case-insensitive. "patterns" are regular-expression sources.
 *      "publicTerms" are names that are fine inside your company but must not reach a public audience;
 *      they are only gated in the "anyone" tier.
 *      The kit ships ONLY an empty example (denylist.example.json). Copy it to denylist.local.json
 *      (gitignored) or point at your own file with --denylist or SCRUB_DENYLIST.
 *
 * Usage:
 *   node scrub.mjs <dir>                       scan a tree (default: the current directory)
 *   node scrub.mjs <dir> --denylist my.json    use a specific denylist file
 *   node scrub.mjs <dir> --tier anyone         also flag your publicTerms (for content meant for people
 *                                              outside your company)
 *   node scrub.mjs <dir> --json                machine-readable output
 *
 * Exit codes: 0 clean, 1 markers found.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// generic infra / secret / id detectors (value-agnostic)
export const DETECTORS = [
  ['dotted-ip',    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ['slack-id',     /\bC0[A-Z0-9]{8,10}\b/],
  ['uuid-or-key',  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/],
  ['api-key',      /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/],
  ['private-key',  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['email',        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['deal-$',       /\$\s?\d[\d,.]*\s?[MBK]\b/],
  ['abs-home',     /\/(?:Users|home)\/[a-z0-9._-]+/i],
];

/** scanText(text, {terms, patterns, publicTerms, tier}) -> array of "kind:match" hit strings (deduped).
 *  publicTerms (your company and product names) are only gated in the "anyone" tier. */
export function scanText(text, { terms = [], patterns = [], publicTerms = [], tier = 'internal' } = {}) {
  const hits = [];
  for (const [name, re] of DETECTORS) { const m = text.match(re); if (m) hits.push(`${name}:${m[0]}`); }
  for (const t of terms) { if (new RegExp('\\b' + esc(t) + '\\b', 'i').test(text)) hits.push(`deny:${t}`); }
  for (const p of patterns) { const m = text.match(new RegExp(p, 'i')); if (m) hits.push(`deny-pattern:${m[0]}`); }
  if (tier === 'anyone') for (const t of publicTerms) { if (new RegExp('\\b' + esc(t) + '\\b', 'i').test(text)) hits.push(`public-term:${t}`); }
  return [...new Set(hits)];
}

const IGNORE = /(^|\/)(\.git|node_modules|reports|dist|build|denylist\.local\.json)(\/|$)/;
const TEXT = /\.(md|py|mjs|js|ts|json|sh|txt|html|yml|yaml|xml|plist|sql|toml|ini|cfg|csv)$/i;
function walk(dir, out = []) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (IGNORE.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

export function loadDenylist(file) {
  if (!file || !fs.existsSync(file)) return { terms: [], patterns: [], publicTerms: [] };
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { terms: d.terms || [], patterns: d.patterns || [], publicTerms: d.publicTerms || [] };
  } catch (e) { console.error('denylist parse error:', e.message); process.exit(2); }
}

export function scanTree(target, opts = {}) {
  const files = walk(target);
  const flagged = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const hits = scanText(text, opts);
    if (hits.length) flagged.push({ file: path.relative(target, f), hits });
  }
  return { scanned: files.length, flagged };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const jsonOut = argv.includes('--json');
  const tier = opt('--tier') || 'internal';
  const denyFile = opt('--denylist') || process.env.SCRUB_DENYLIST || path.join(HERE, 'denylist.local.json');
  const valueFlags = new Set(['--tier', '--denylist']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
  const target = path.resolve(positional[0] || process.cwd());

  const deny = loadDenylist(denyFile);
  const { scanned, flagged } = scanTree(target, { ...deny, tier });
  const denyCount = deny.terms.length + deny.patterns.length + deny.publicTerms.length;

  if (jsonOut) {
    console.log(JSON.stringify({ target, tier, scanned, denylistEntries: denyCount, flaggedCount: flagged.length, flagged }, null, 2));
  } else {
    console.log(`LEAK-SCAN GATE  ·  tier=${tier}  ·  ${target}`);
    console.log(`scanned ${scanned} text files · denylist ${denyCount} entries${denyCount === 0 ? ' (EMPTY - only the generic detectors ran; add your own terms)' : ''}${tier === 'anyone' ? ' + SF-term block' : ''}`);
    console.log('─'.repeat(64));
    if (!flagged.length) console.log('CLEAN - no internal markers found.');
    else {
      console.log(`BLOCKED - ${flagged.length} file(s) carry internal markers:\n`);
      for (const f of flagged) console.log(`  ${f.file}\n      ${f.hits.join(' · ')}`);
    }
  }
  process.exit(flagged.length ? 1 : 0);
}

// main-module check that holds through a symlinked path (macOS /tmp, a symlinked ~/.claude), where argv[1] as typed
// differs from the module's URL, and under `node -e`, where argv[1] is just an argument
const isMain = (() => {
  if (typeof import.meta.main === 'boolean') return import.meta.main;   // Node 22.18+ / 24.2+
  if (process.execArgv.some((a) => /^(-e|-p|--eval|--print)(=|$)/.test(a))) return false;   // node -e: argv[1] is an argument
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main();
