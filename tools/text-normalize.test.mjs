// text-normalize.test.mjs: tests for text-normalize.mjs and its CLI (local only, no network; every text is made up).
// Run:  node ~/.claude/tools/text-normalize.test.mjs   (exit 0 = pass)
// What it holds the normalizer to:
//   - a phrase typed with invisible characters, look-alike letters, odd spaces, emphasis or markup reads as the phrase
//     in the rendered view (the view a pinned tell and the injection check read), and the canonical text drops
//     invisible and tag characters
//   - text that only mentions the words (in a link target, an href, a near miss) does not read as the phrase
//   - ordinary text comes through canonicalForScan unchanged
//   - stripEmphasis gives the old regex's answers and runs in linear time
//   - the CLI prints the canonical text, its --json output reports both views and the code points it read
import * as TN from './text-normalize.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0, fail = 0;
const check = (name, ok) => { n++; let pass = false; try { pass = typeof ok === 'function' ? ok() : ok; } catch (e) { console.log('   (' + name + ': ' + e.message + ')'); } if (!pass) { fail++; console.log('✗ ' + name); } };
const flat = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const reads = (text) => flat(TN.renderedView(text)).includes('the short version is');

const PHRASE_OBFUSCATED = [
  ['So the sh​ort version is this.', 'zero-width space inside a word'],
  ['So the​ short‌ version⁠ is this.', 'zero-width space, non-joiner and word joiner between words'],
  ['So the sh­ort ver﻿sion is this.', 'soft hyphen and BOM inside words'],
  ['So the short‎ version‮ is this.', 'bidi controls'],
  ['So the short vеrsion is this.', 'Cyrillic e in "version"'],
  ['So the shоrt version is this.', 'Cyrillic o in "short"'],
  ['So thе shοrt vеrsiօn іs this.', 'Cyrillic, Greek and Armenian look-alikes mixed'],
  ['So the short version is this.', 'non-breaking spaces'],
  ['So the short version　is this.', 'narrow, figure and ideographic spaces'],
  ['So the **short** version is this.', '**bold** around one word'],
  ['So the short **version is** this.', '**bold** across the end of the phrase'],
  ['So **the short version is** this.', 'the whole phrase in **bold**'],
  ['So the sh**ort** version is this.', 'a **bold** split inside a word'],
  ['So the *short* version is this.', '*italic*'],
  ['So the _short_ version is this.', '_italic_'],
  ['So <b>the short</b> version is this.', 'inline HTML bold'],
  ['So ｔｈｅ ｓｈｏｒｔ ｖｅｒｓｉｏｎ ｉｓ this.', 'fullwidth letters'],
  ['So the \u{1D42C}\u{1D421}\u{1D428}\u{1D42B}\u{1D42D} version is this.', 'math-bold letters'],
  ['So the sh\u{E0078}ort version is this.', 'an inserted Unicode tag character'],
  ['So the sh\u{E0100}ort version is this.', 'a supplementary variation selector (U+E0100)'],
  ['So the sh⁫ort version is this.', 'a deprecated format control (U+206B)'],
  ['So the sh￹ort version is this.', 'an interlinear annotation anchor (U+FFF9)'],
  ['So the sh\u{1D173}ort version is this.', 'a musical format control (U+1D173)'],
  ['So the short⠀version⠀is this.', 'Braille blanks for spaces'],
  ['So the short\u0085version is this.', 'a NEL for a space'],
  ['So the short versi̇on is this.', 'a combining dot above on the i'],
  ['So the shoṟt version is this.', 'a combining macron below'],
  ['So thε short version is this.', 'Greek epsilon for e'],
  ['So the short ѵersion is this.', 'Cyrillic izhitsa for v'],
  ['So the shⲟrt version is this.', 'Coptic o'],
  ['So ᴛʜᴇ ꜱʜᴏʀᴛ ᴠᴇʀꜱɪᴏɴ ɪꜱ this.', 'small-capital letters'],
  ['So the sh&#111;rt version is this.', 'an HTML numeric entity for one letter'],
  ['So the&nbsp;short&nbsp;version is this.', '&nbsp; entities between words'],
  ['So the sh&shy;ort version is this.', 'an &shy; entity inside a word'],
  ['So the sh<span>ort</span> version is this.', 'a <span> splitting a word'],
  ['So the sh<!-- -->ort version is this.', 'an HTML comment inside a word'],
  ['So the sh<wbr>ort version is this.', 'a <wbr> inside a word'],
  ['So the short<br>version is this.', 'a <br> between words'],
  ['So the [short](#) version is this.', 'a markdown link on one word'],
  ['So the <a href="#">short</a> version is this.', 'an <a> tag on one word'],
];
for (const [text, why] of PHRASE_OBFUSCATED) check('the rendered view reads the phrase through ' + why, () => reads(text));
check('the plain phrase reads as itself', () => reads('So the short version is this: the cache never warmed.'));
const VIEW_SILENT = [
  ['See [the notes](https://example.com/the-short-version-is) before Friday.', 'the phrase only in a link target'],
  ['<a href="/blog/the-short-version-is">Read the post</a> when you have a minute.', 'the phrase only in an href'],
  ['The short versions issue is closed; the short vérsion was a typo.', 'near misses with an accent'],
  ['So the sh ort version is this.', 'a real space inside a word'],
];
for (const [text, why] of VIEW_SILENT) check('the rendered view does not read the phrase in ' + why, () => !reads(text));

const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤﻿­\u{E0000}-\u{E007F}]/u;
check('canonicalForScan drops zero-width, bidi, soft hyphen, BOM and tag characters', () => typeof TN.canonicalForScan === 'function' && !HIDDEN_CHARS.test(TN.canonicalForScan('a​b‎c‮d­e﻿f\u{E0041}g')));
check('canonicalForScan folds look-alike letters', () => flat(TN.canonicalForScan('seаmless synergу utιlize')) === 'seamless synergy utilize');

const ORDINARY = [
  'We moved the nightly job onto the new scheduler after the old one kept skipping runs. The migration took a week.',
  'She said "ship it" and he did not argue. The tests were green. Then 2010 to 2014 came back.',
  'Set max_retries to 3 and timeout_ms to 2 * 1500; the init hook stays as is.',
  'Plain note.\nSecond line with a_b and 2 * 3.',
];
for (const t of ORDINARY) check('ordinary text is unchanged by canonicalForScan: ' + JSON.stringify(t.slice(0, 40)), () => TN.canonicalForScan(t) === t);

// stripEmphasis against the regex version it replaced (the regex took time in the square of the input), on generated soups.
const OLD_STRIP_EMPHASIS = (text) => {
  if (!text || !/[*_<]/.test(text)) return text || '';
  return text
    .replace(/<\/?(?:b|i|em|strong|u|mark|ins)\b[^>]*>/gi, '')
    .replace(/\*{2,}|_{2,}(?=\S)|(?<=\S)_{2,}/g, '')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/gm, '$1$2')
    .replace(/(?<=\w)\*+(?=\w)/g, '')
    .replace(/(^|[\s(["'])_(?=[^\s_])([^_\n]*?[^\s_])_(?=$|[\s.,;:!?)\]"'])/gm, '$1$2');
};
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const EMPH_TOKENS = ['<b', '<b>', '</b>', '<B class="x">', '<bold>', '<br>', '<i', '<i>', '</i >', '<ins>', '<input>', '<em', '<em>', '</EM>', '<strong>', '<strong x="1"', '<u>', '<mark>', '</mark>', '<', '>', '</', '<<', '*', '**', '***', '_', '__', 'a', 'w', ' ', '\n', 'x_y', '2 * 3'];
const soup = (r, tokens, max) => { let s = ''; for (let k = 1 + Math.floor(r() * max); k > 0; k--) s += tokens[Math.floor(r() * tokens.length)]; return s; };
const elapsed = (f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
check('stripEmphasis matches the old regexes on 6,000 generated emphasis soups', () => {
  const r = rng(20261002);
  for (let i = 0; i < 6000; i++) { const t = soup(r, EMPH_TOKENS, 60); if (TN.stripEmphasis(t) !== OLD_STRIP_EMPHASIS(t)) { console.log('   differs on ' + JSON.stringify(t)); return false; } }
  return true;
});
check('stripEmphasis takes under 100 ms on 40,000 "<b ", 40,000 "</em " and 20,000 "<strong " with no ">"', () =>
  [['<b ', 40000], ['</em ', 40000], ['<strong ', 20000]].every(([u, k]) => { const t = u.repeat(k); const ms = elapsed(() => TN.stripEmphasis(t)); if (ms >= 100) console.log('   ' + JSON.stringify(u) + ' x' + k + ': ' + ms.toFixed(0) + ' ms'); return ms < 100; }));
check('renderedView takes under 1 s on 40,000 unclosed "<!--", "<script>", "<strong " and "[x](" each', () =>
  ['<!--', '<script>', '<strong ', '[x]('].every((u) => { const t = 'Our note. ' + u.repeat(40000); return elapsed(() => TN.renderedView(t)) < 1000; }));

// The CLI the send hook calls.
const TN_PATH = join(HERE, 'text-normalize.mjs');
const cli = (input, ...args) => spawnSync('node', [TN_PATH, ...args], { input, encoding: 'utf8' });
const HIDDEN_WORDS = 'Our seаmless sea​mless ｓｅａｍｌｅｓｓ synergу utιlize cοrnerstone sea**m**less rollout.';
const RENDERED_WORDS = 'Our seam&#108;ess seam<span>less</span> seam<!-- x -->less uti̇lize ꜱʏɴᴇʀɢʏ seamlεss ꓢeamless table⠀stakes rollout.';
check('the CLI prints the canonical text', () => { const p = cli(HIDDEN_WORDS); return p.status === 0 && p.stdout === TN.canonicalForScan(HIDDEN_WORDS); });
check('the canonical text of hidden spellings reads as the plain words', () => { const c = flat(cli(HIDDEN_WORDS).stdout); return ['seamless', 'synergy', 'utilize', 'cornerstone'].every((w) => c.includes(w)) && (c.match(/seamless/g) || []).length === 4; });
check('the CLI --json reports the canonical text, the rendered view and the code points it read', () => { const t = HIDDEN_WORDS + '\u{1F600}'; const p = cli(t, '--json'); if (p.status !== 0) return false; const j = JSON.parse(p.stdout); return j.canonical === TN.canonicalForScan(t) && typeof j.rendered === 'string' && j.inputCodePoints === [...t].length; });
check('the CLI --json rendered view reads entities, inline tags, comments, combining marks and confusables as plain words', () => { const p = cli(RENDERED_WORDS, '--json'); if (p.status !== 0) return false; const r = flat(JSON.parse(p.stdout).rendered); return (r.match(/seamless/g) || []).length === 5 && r.includes('utilize') && r.includes('synergy') && r.includes('table stakes'); });
check('the CLI leaves plain ASCII byte for byte, CRLF and trailing newline included', () => { const t = 'Plain note.\r\nSecond line with a_b and 2 * 3.\n'; const p = cli(t); return p.status === 0 && p.stdout === t; });
check('the CLI rejects an unknown argument with exit 1', () => cli('x', '--bogus').status === 1);
check('the CLI is linear: 40,000 unclosed "<strong " in under 2 s end to end', () => { const t = '<strong '.repeat(40000); const t0 = Date.now(); const p = cli(t); return p.status === 0 && p.stdout === t && Date.now() - t0 < 2000; });
check('the CLI --json is linear on unclosed markup: 40,000 "<!--", "<script>", "<strong " and "[x](" in under 2 s each', () => ['<!--', '<script>', '<strong ', '[x]('].every((u) => { const t = 'Our note. ' + u.repeat(40000); const t0 = Date.now(); const p = cli(t, '--json'); return p.status === 0 && Date.now() - t0 < 2000; }));

console.log(fail ? '\nFAIL: ' + fail + '/' + n + ' cases failed' : 'PASS: ' + n + '/' + n + ' cases (rendered view, canonical text, ordinary text, stripEmphasis, CLI)');
process.exit(fail ? 1 : 0);
