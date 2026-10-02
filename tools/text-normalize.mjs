// text-normalize.mjs — canonical text for the voice system's pattern and cadence scans (2026-10-02).
//
// Why: every check in the overlay is a regex over characters. A zero-width space inside "hon\u200Best", a Cyrillic
// "е" in "version", a non-breaking space between words, a curly apostrophe where a pattern expects a straight
// one, or **bold** markers splitting a phrase all defeat a regex while the text reads the same on screen.
// These functions map such text to one canonical form before scanning, so a tell can't be hidden by typing it
// differently. They never touch plain ASCII text with no markdown emphasis.
//
// Two levels:
//   normalizeForScan(text)  Unicode only: strips every invisible character (HIDDEN: zero-width, bidi, tag, variation
//                           selectors and the other default-ignorable and format characters), NFKC
//                           (fullwidth, math-alphanumeric and ligature forms; "…" is kept as is), Latin look-alikes
//                           from Cyrillic, Greek, Armenian and IPA mapped to Latin, curly quotes to straight,
//                           hyphen and dash variants to "-" and "—", and every space variant to " ". Used for
//                           cadence and every pattern scan. Line structure and markdown markers are untouched,
//                           so cadence counts (bullets, bold labels, sentence splits) are the same as before.
//   stripEmphasis(text)     Additionally removes markdown and inline-HTML emphasis markers (**x**, __x__, *x*,
//                           _x_, sh**ort**, <b>x</b>). Used for word, phrase and structure scans only.
//   normalizeForDetector()  For the vendored detector (patterns.js), which strips zero-width characters and swaps
//                           common Cyrillic/Greek look-alikes itself and COUNTS them (its normalization-flag).
//                           So this leaves those for it, and handles only what it doesn't: bidi and other
//                           invisible format characters, NFKC compatibility forms, and the look-alikes missing
//                           from its table. Quotes, dashes, non-breaking spaces and markdown stay as they are,
//                           because the detector's punctuation and formatting checks read them (a non-breaking
//                           space counts toward its smart-punctuation signature).
//
//   renderedView(text)      What a reader sees, for the two checks that reject on their own (the pinned structural tell
//                           and the judge-directed-injection check): markup rendered, entities decoded, then
//                           normalizeForScan and stripEmphasis, then combining marks dropped and the remaining look-alike
//                           letters folded to ASCII. An extra view only; nothing else reads it.
//
// normalizationStats(text) counts what normalizeForScan changed, by kind, for the report.
//
//   canonicalForScan(text)  stripEmphasis(normalizeForScan(text)): exactly what the overlay's word, phrase and structure
//                           scans read. Also a CLI, for callers outside node (voice-tell-gate.py runs its banned-word
//                           list on it, 2026-10-02):
//                             node text-normalize.mjs < in.txt           canonical text on stdout
//                             node text-normalize.mjs --json < in.txt    {"canonical": "...", "rendered": "...", "inputCodePoints": n}
//                           n is the number of code points read, so a caller can check the whole input arrived. "rendered" is
//                           renderedView(text); the send hook runs its word list on it too (2026-10-02 verify: an entity, an
//                           inline tag or comment, a combining mark, small capitals or a confusable letter hid a banned word
//                           from the canonical text).

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/gu;                  // also stripped by patterns.js
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/gu;
const DETECTOR_INVISIBLE = /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180E\u2061-\u2064\u3164\uFFA0]/gu;
const OTHER_INVISIBLE = /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180E\u2061-\u2064\u3164\uFFA0\uFE00-\uFE0F]/gu; // + variation selectors
// Unicode tag characters (U+E0000-E007F) render as nothing, but a model can read them: the "ASCII smuggling" channel,
// where a whole instruction is spelled in invisible tag characters (2026-10-02). They're stripped from every scan, like
// the other invisibles, so an inserted one can't split a word; revealTags() decodes them so the injection check can read
// a smuggled payload; stripHidden() removes them, with the other invisibles, from the text a judge is shown. A lone
// emoji flag sequence (England, Scotland, Wales) also uses tag characters, which is why presence alone isn't a signal.
const TAGS = /[\u{E0000}-\u{E007F}]/gu;
export const revealTags = (text) => (text || '').replace(TAGS, (ch) => { const c = ch.codePointAt(0) - 0xE0000; return c >= 0x20 && c <= 0x7E ? String.fromCharCode(c) : ''; });
// Every character that renders as nothing (2026-10-02, verify pass): Unicode's Default_Ignorable_Code_Point set, which
// holds all of ZERO_WIDTH, BIDI, OTHER_INVISIBLE and TAGS plus the ones those lists missed (variation selectors
// U+E0100-E01EF, the U+206A-206F deprecated format controls, U+180F, the U+1D173 musical and U+1BCA0 shorthand format
// controls, U+FFF0-FFF8), and the interlinear-annotation and Egyptian format controls, which are invisible format
// characters Unicode doesn't list as ignorable. One U+E0100, U+206B, U+FFF9 or U+1D173 inside a word used to hide a
// pinned tell. The four lists above stay for normalizationStats and the detector path.
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\uFFF9-\uFFFB\u{13430}-\u{1343F}]/gu;
// The judged text with every invisible character removed. What a reader sees doesn't change; what a model could read
// but a reader can't is gone.
export const stripHidden = (text) => (text || '').replace(HIDDEN, '');

// Latin look-alikes. patterns.js maps the first group itself (and counts them); the second group it misses.
const LOOKALIKE_DETECTOR_KNOWS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'к': 'k', 'м': 'm', 'н': 'h', 'в': 'b', 'т': 't',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X', 'У': 'Y', 'К': 'K', 'М': 'M', 'Н': 'H', 'В': 'B', 'Т': 'T',
  'ο': 'o', 'Ο': 'O', 'α': 'a', 'Α': 'A', 'ρ': 'p', 'Ρ': 'P',
};
const LOOKALIKE_EXTRA = {
  // Cyrillic
  'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'ӏ': 'l', 'ɡ': 'g', 'ү': 'y',
  'І': 'I', 'Ј': 'J', 'Ѕ': 'S', 'Ԛ': 'Q', 'Ԝ': 'W', 'Ү': 'Y', 'Ӏ': 'I', 'Һ': 'H',
  // Greek
  'ν': 'v', 'ι': 'i', 'κ': 'k', 'υ': 'u', 'χ': 'x', 'ϲ': 'c', 'ϳ': 'j',
  'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'Ϲ': 'C',
  // Armenian
  'օ': 'o', 'ս': 'u', 'հ': 'h', 'ո': 'n',
  // Latin and IPA variants
  'ı': 'i', 'ȷ': 'j', 'ɑ': 'a', 'ɩ': 'i', 'ʏ': 'y', 'ɪ': 'i',
};
const LOOKALIKE_ALL = { ...LOOKALIKE_DETECTOR_KNOWS, ...LOOKALIKE_EXTRA };
const reFromKeys = (o) => new RegExp(`[${Object.keys(o).join('')}]`, 'gu');
const LOOKALIKE_ALL_RE = reFromKeys(LOOKALIKE_ALL), LOOKALIKE_EXTRA_RE = reFromKeys(LOOKALIKE_EXTRA);

const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/gu;             // “ ” „ ‟ ″ « » → "
const HYPHENS = /[\u2010\u2011\u2012\u2043\u2212\uFE63\uFF0D]/gu;                    // hyphen look-alikes → -
const DASHES = /[\u2015\uFE58\u2E3A\u2E3B\uFE31\uFE32]/gu;                           // em-dash look-alikes → —
const SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;                    // every space variant → " "
const NFKC_KEEP = new Set(['…', '‥']);                                     // "…" and "‥" stay (cadence reads them)
const nfkc = (s, keepSpaces = false) => s.replace(/[^\x00-\x7F]/gu, (ch) => (NFKC_KEEP.has(ch) || (keepSpaces && /\s/.test(ch)) ? ch : ch.normalize('NFKC')));

// Backticks are left alone: the cadence scan reads them as code spans.
const SINGLE_QUOTES_SCAN = /[\u2018\u2019\u201A\u201B\u02BC\u02BB\u2032\u00B4]/gu;

export function normalizeForScan(text) {
  if (!text || !/[^\x00-\x7F]/.test(text)) return text || '';
  return nfkc(text.replace(HIDDEN, ''))
    .replace(LOOKALIKE_ALL_RE, (c) => LOOKALIKE_ALL[c])
    .replace(SINGLE_QUOTES_SCAN, "'").replace(DOUBLE_QUOTES, '"')
    .replace(HYPHENS, '-').replace(DASHES, '—').replace(SPACES, ' ');
}

export function normalizeForDetector(text) {
  if (!text || !/[^\x00-\x7F]/.test(text)) return text || '';
  return nfkc(text.replace(TAGS, '').replace(BIDI, '').replace(DETECTOR_INVISIBLE, ''), true)   // NFKC would turn U+00A0 into a space
    .replace(LOOKALIKE_EXTRA_RE, (c) => LOOKALIKE_EXTRA[c]);
}

// text.replace(/<\/?(?:b|i|em|strong|u|mark|ins)\b[^>]*>/gi, ''), in one forward pass (2026-10-02, send-hook fix). The
// regex rescanned to the end of the text from every "<b" with no ">" after it: 40,000 "<strong " took about 19 s, and the send
// hook runs this twice per scan. A tag runs from its name to the first ">" after it, and once one has no ">" after it,
// none later does. text-normalize.test.mjs checks this against the regex on generated soups.
const EMPHASIS_TAG = /<\/?(?:b|i|em|strong|u|mark|ins)\b/iy;
function dropEmphasisTags(s) {
  let out = '', from = 0;
  for (let i = s.indexOf('<'); i !== -1; ) {
    EMPHASIS_TAG.lastIndex = i;
    if (!EMPHASIS_TAG.test(s)) { i = s.indexOf('<', i + 1); continue; }
    const j = s.indexOf('>', EMPHASIS_TAG.lastIndex);
    if (j === -1) break;
    out += s.slice(from, i);
    from = j + 1;
    i = s.indexOf('<', from);
  }
  return out + s.slice(from);
}
// Markdown and inline-HTML emphasis markers, removed so "the **short** version", "sh**ort**" and
// "<b>short</b>" read as the phrase they render as. Bullets ("* item" at a line start), arithmetic
// ("2 * 3") and snake_case are left alone.
export function stripEmphasis(text) {
  if (!text || !/[*_<]/.test(text)) return text || '';
  return dropEmphasisTags(text)
    .replace(/\*{2,}|_{2,}(?=\S)|(?<=\S)_{2,}/g, '')               // **, ***, __x__ (any position for *)
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/gm, '$1$2') // *x*
    .replace(/(?<=\w)\*+(?=\w)/g, '')                               // sh*ort
    .replace(/(^|[\s(["'])_(?=[^\s_])([^_\n]*?[^\s_])_(?=$|[\s.,;:!?)\]"'])/gm, '$1$2'); // _x_
}

// ── rendered view (2026-10-02, verify pass) ─────────────────────────────────────────────────────────────────────────
// A pinned tell and the injection check reject on their own, so they also run on what a reader sees. A verify pass
// crafted 24 spellings of a pinned overlay phrase and all 24 got past the scan above; the same tricks hid
// "ignore all previous instructions": one <span>, <wbr>, <br> or HTML comment inside or between the words, one &#101;,
// &shy; or &nbsp;, a markdown link on one word, a Braille blank (U+2800) or NEL (U+0085) for a space, a combining dot on
// the i of "version", "ѵersion", a Greek epsilon or a Coptic o for a Latin letter, or small capitals. This view renders
// markup (comments and <script>/<style>/<head>/<template> bodies removed, block tags and <br> read as a space, every other
// tag removed, markdown links and images read as their text, entities decoded), runs normalizeForScan and stripEmphasis,
// folds Latin small capitals and a few Greek and Cyrillic letters the tables above leave alone, drops combining marks,
// and folds every Unicode confusable whose prototype is one ASCII letter. It is used ONLY as an extra view: a pattern
// that already matched the scan text isn't reported twice, and word bans, lint, cadence and the detector never read it,
// so ordinary text scores exactly as before (calibration/human-fp-budget.mjs fails if the pinned tell or an injection
// pattern hits any human doc through it).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', shy: '\u00AD', zwj: '\u200D', zwnj: '\u200C', lrm: '\u200E',
  rlm: '\u200F', ensp: '\u2002', emsp: '\u2003', emsp13: '\u2004', emsp14: '\u2005', numsp: '\u2007', puncsp: '\u2008',
  thinsp: '\u2009', hairsp: '\u200A', MediumSpace: '\u205F', NoBreak: '\u2060', ZeroWidthSpace: '\u200B',
  NegativeVeryThinSpace: '\u200B', NegativeThinSpace: '\u200B', NegativeMediumSpace: '\u200B', NegativeThickSpace: '\u200B',
  af: '\u2061', ApplyFunction: '\u2061', it: '\u2062', InvisibleTimes: '\u2062', ic: '\u2063', InvisibleComma: '\u2063',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  sbquo: '\u201A', bdquo: '\u201E', laquo: '\u00AB', raquo: '\u00BB', hyphen: '\u2010', dash: '\u2010', minus: '\u2212',
  period: '.', comma: ',', colon: ':', semi: ';', excl: '!', quest: '?', lpar: '(', rpar: ')', lowbar: '_', ast: '*', num: '#',
  sol: '/', bsol: '\\', verbar: '|', lsqb: '[', rsqb: ']', lcub: '{', rcub: '}', grave: '`', Tab: '\t', NewLine: '\n',
};
const LEGACY_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'shy']);   // decoded without a ";" too, as browsers do
const decodeEntity = (m, dec, hex, name, semi) => {
  if (dec || hex) { const cp = parseInt(dec || hex, dec ? 10 : 16); return cp > 0 && cp <= 0x10FFFF && (cp < 0xD800 || cp > 0xDFFF) ? String.fromCodePoint(cp) : '\uFFFD'; }
  const v = NAMED_ENTITIES[name];
  return v !== undefined && (semi || LEGACY_ENTITIES.has(name)) ? v : m;
};
const BLOCK_TAGS = 'address|article|aside|blockquote|body|br|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|html|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul';
// <script>, <style>, <head> and <template> bodies go, in one forward pass so a page full of unclosed tags stays linear
// (a lazy [\s\S]*? regex rescans to the end for every unclosed one). An unclosed one hides the rest, as in a browser.
function dropBodies(text) {
  const open = /<(script|style|head|template)\b[^<>]*>/gi;
  let out = '', from = 0, m;
  while ((m = open.exec(text))) {
    out += text.slice(from, m.index) + ' ';
    const close = new RegExp(`<\\/${m[1]}\\s*>`, 'gi'); close.lastIndex = open.lastIndex;
    const c = close.exec(text);
    if (!c) return out;
    from = open.lastIndex = close.lastIndex;
  }
  return out + text.slice(from);
}
function renderMarkup(text) {
  if (!/[<&\[]/.test(text)) return text;
  return dropBodies(text.replace(/<!--[\s\S]*?(?:-->|$)/g, ''))                           // an unclosed comment hides the rest, as in a browser
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^<>]*>`, 'gi'), ' ')
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, '')                                   // inline tags: <span>, <a href>, <wbr>, <font>...
    .replace(/!?\[([^\]\n]{0,300})\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/g, '$1')       // [text](url) and ![alt](src)
    .replace(/\[([^\]\n]{0,300})\]\[[^\]\n]{0,100}\]/g, '$1')                                    // [text][ref]
    .replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}))(;)?/g, decodeEntity);
}
// Look-alikes the tables above leave alone: Latin small capitals (what "small caps" text generators emit) and a few
// Greek and Cyrillic letters whose Unicode confusable prototype isn't an ASCII letter.
const VIEW_FOLD = {
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n',
  'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ᴢ': 'z',
  'ε': 'e', 'ϵ': 'e', 'ɛ': 'e', 'є': 'e', 'τ': 't', 'ω': 'w', 'η': 'n', 'п': 'n',
};
// Unicode confusables (UTS #39 confusables.txt, version 18.0.0, 2026-08-06): every letter (\p{L}) outside ASCII whose
// prototype is a single ASCII letter, minus those NFKC already maps there; a capital whose prototype is "l" maps to "I".
// 572 pairs, each written as \u{source} then the ASCII letter. Regenerate from that file with the same filter.
const CONFUSABLE_PAIRS =
  '\u{fe}p\u{131}i\u{17f}f\u{184}b\u{18d}g\u{192}f\u{196}I\u{1a6}R\u{1bd}s\u{1bf}p\u{1c0}l\u{237}j\u{24c}R' +
  '\u{251}a\u{261}g\u{263}y\u{269}i\u{26a}i\u{26f}w\u{284}f\u{28b}u\u{28f}y\u{37f}J\u{391}A\u{392}B\u{395}E' +
  '\u{396}Z\u{397}H\u{399}I\u{39a}K\u{39c}M\u{39d}N\u{39f}O\u{3a1}P\u{3a4}T\u{3a5}Y\u{3a7}X\u{3b1}a\u{3b3}y' +
  '\u{3b9}i\u{3bd}v\u{3bf}o\u{3c1}p\u{3c3}o\u{3c5}u\u{3d2}Y\u{3dc}F\u{3ed}o\u{3f1}p\u{3f2}c\u{3f3}j\u{3f8}p' +
  '\u{3f9}C\u{3fa}M\u{405}S\u{406}I\u{408}J\u{410}A\u{412}B\u{415}E\u{41a}K\u{41c}M\u{41d}H\u{41e}O\u{420}P' +
  '\u{421}C\u{422}T\u{423}Y\u{425}X\u{42c}b\u{430}a\u{433}r\u{435}e\u{43e}o\u{440}p\u{441}c\u{443}y\u{445}x' +
  '\u{448}w\u{455}s\u{456}i\u{458}j\u{461}w\u{474}V\u{475}v\u{4ae}Y\u{4af}y\u{4ba}h\u{4bb}h\u{4bd}e\u{4c0}I' +
  '\u{4cf}l\u{501}d\u{50c}G\u{51a}Q\u{51b}q\u{51c}W\u{51d}w\u{54d}U\u{54f}S\u{555}O\u{561}w\u{563}q\u{566}q' +
  '\u{570}h\u{575}j\u{578}n\u{57c}n\u{57d}u\u{581}g\u{582}i\u{584}f\u{585}o\u{5d5}l\u{5d8}v\u{5df}l\u{5e1}o' +
  '\u{627}l\u{647}o\u{6be}o\u{6c1}o\u{6d5}o\u{7ca}l\u{7cb}o\u{7cc}Y\u{7d3}F\u{7d5}b\u{7e0}T\u{840}o\u{b20}O' +
  '\u{d1f}s\u{d20}o\u{1004}c\u{101d}o\u{105a}c\u{10b9}h\u{10bd}S\u{10cd}Z\u{10e7}y\u{10fd}S\u{10ff}o\u{110b}o' +
  '\u{11bc}o\u{1200}U\u{12d0}O\u{13a0}D\u{13a1}R\u{13a2}T\u{13a5}i\u{13a9}Y\u{13aa}A\u{13ab}J\u{13ac}E\u{13b3}W' +
  '\u{13b7}M\u{13bb}H\u{13bd}Y\u{13c0}G\u{13c2}h\u{13c3}Z\u{13cf}b\u{13d2}R\u{13d4}W\u{13d5}S\u{13d9}V\u{13da}S' +
  '\u{13de}L\u{13df}C\u{13e2}P\u{13e6}K\u{13e7}d\u{13f3}G\u{13f4}B\u{142f}V\u{144c}U\u{146d}P\u{146f}d\u{1472}b' +
  '\u{148d}J\u{14aa}L\u{1541}x\u{157c}H\u{157d}x\u{1587}R\u{15af}b\u{15b4}F\u{15c5}A\u{15de}D\u{15ea}D\u{15f0}M' +
  '\u{15f7}B\u{16b7}X\u{16c1}l\u{16d0}l\u{16d5}K\u{16d6}M\u{1763}x\u{1a45}o\u{1c82}o\u{1c83}c\u{1cbd}S\u{1cbf}O' +
  '\u{1cf5}X\u{1d04}c\u{1d0f}o\u{1d11}o\u{1d1c}u\u{1d20}v\u{1d21}w\u{1d22}z\u{1d26}r\u{1d83}g\u{1d8c}y\u{1e9d}f' +
  '\u{1eff}y\u{2110}I\u{2111}I\u{213d}y\u{2c6b}Z\u{2c6c}z\u{2c82}B\u{2c85}r\u{2c8c}Z\u{2c8d}z\u{2c8e}H\u{2c92}I' +
  '\u{2c93}i\u{2c94}K\u{2c98}M\u{2c9a}N\u{2c9e}O\u{2c9f}o\u{2ca2}P\u{2ca3}p\u{2ca4}C\u{2ca5}c\u{2ca6}T\u{2ca8}Y' +
  '\u{2ca9}y\u{2cac}X\u{2cbd}w\u{2cce}P\u{2ccf}p\u{2cd0}L\u{2d2d}z\u{2d38}V\u{2d39}E\u{2d4a}l\u{2d4f}l\u{2d54}O' +
  '\u{2d55}Q\u{2d5d}X\u{3112}T\u{311a}Y\u{3147}o\u{4e05}T\u{4e2b}Y\u{a4d0}B\u{a4d1}P\u{a4d2}d\u{a4d3}D\u{a4d4}T' +
  '\u{a4d6}G\u{a4d7}K\u{a4d9}J\u{a4da}C\u{a4dc}Z\u{a4dd}F\u{a4df}M\u{a4e0}N\u{a4e1}L\u{a4e2}S\u{a4e3}R\u{a4e6}V' +
  '\u{a4e7}H\u{a4ea}W\u{a4eb}X\u{a4ec}Y\u{a4ee}A\u{a4f0}E\u{a4f2}l\u{a4f3}O\u{a4f4}U\u{a50b}T\u{a557}B\u{a56f}l' +
  '\u{a576}S\u{a5cb}E\u{a647}i\u{a6c9}Z\u{a6df}V\u{a731}s\u{a781}l\u{a798}F\u{a799}f\u{a79f}u\u{a7ae}I\u{a7b2}J' +
  '\u{a7b3}X\u{a7b4}B\u{a7fa}w\u{a7fe}l\u{ab32}e\u{ab35}f\u{ab3d}o\u{ab47}r\u{ab48}r\u{ab4e}u\u{ab52}u\u{ab5a}y' +
  '\u{ab64}a\u{ab75}i\u{ab81}r\u{ab83}w\u{ab93}z\u{aba4}w\u{aba9}v\u{abaa}s\u{abaf}c\u{fba6}o\u{fba7}o\u{fba8}o' +
  '\u{fba9}o\u{fbaa}o\u{fbab}o\u{fbac}o\u{fbad}o\u{fe8d}l\u{fe8e}l\u{fee9}o\u{feea}o\u{feeb}o\u{feec}o\u{ff29}I' +
  '\u{ffb7}o\u{10282}B\u{10286}E\u{10287}F\u{1028a}l\u{10290}X\u{10292}O\u{10295}P\u{10296}S\u{10297}T\u{102a0}A' +
  '\u{102a1}B\u{102a2}C\u{102a5}F\u{102ab}O\u{102b0}M\u{102b1}T\u{102b2}Y\u{102b4}X\u{102cf}H\u{10301}B\u{10302}C' +
  '\u{10309}l\u{1030f}O\u{10311}M\u{10315}T\u{10317}X\u{1031c}b\u{10404}O\u{10415}C\u{1041b}L\u{10420}S\u{1042c}o' +
  '\u{1043d}c\u{10448}s\u{104b4}R\u{104c2}O\u{104ce}U\u{104ea}o\u{104f6}u\u{10507}Z\u{1050e}l\u{10513}N\u{10516}O' +
  '\u{10518}K\u{1051b}C\u{1051d}V\u{10525}F\u{10526}L\u{10527}X\u{10926}l\u{1092c}o\u{10c13}X\u{10c17}O\u{10c1f}V' +
  '\u{10c20}Y\u{10c21}M\u{10c3e}l\u{10c82}X\u{10ca5}I\u{10cc2}x\u{10d07}o\u{11124}o\u{11706}v\u{1170a}w\u{1170e}w' +
  '\u{1170f}w\u{118a0}V\u{118a2}F\u{118a3}L\u{118a4}Y\u{118a6}E\u{118a9}Z\u{118ae}E\u{118b2}L\u{118b5}O\u{118b8}U' +
  '\u{118bc}T\u{118c0}v\u{118c1}s\u{118c2}F\u{118c3}i\u{118c4}y\u{118c8}o\u{118d7}o\u{118d8}u\u{118dc}y\u{11abc}Z' +
  '\u{11abe}N\u{11dda}l\u{16a19}r\u{16ad6}S\u{16ae9}O\u{16d63}l\u{16eaa}I\u{16eb6}b\u{16f08}V\u{16f0a}T\u{16f16}L' +
  '\u{16f28}l\u{16f35}R\u{16f3a}S\u{16f40}A\u{16f42}U\u{16f43}Y\u{1d408}I\u{1d43c}I\u{1d470}I\u{1d4d8}I\u{1d540}I' +
  '\u{1d574}I\u{1d5a8}I\u{1d5dc}I\u{1d610}I\u{1d644}I\u{1d678}I\u{1d6a4}i\u{1d6a5}j\u{1d6a8}A\u{1d6a9}B\u{1d6ac}E' +
  '\u{1d6ad}Z\u{1d6ae}H\u{1d6b0}I\u{1d6b1}K\u{1d6b3}M\u{1d6b4}N\u{1d6b6}O\u{1d6b8}P\u{1d6bb}T\u{1d6bc}Y\u{1d6be}X' +
  '\u{1d6c2}a\u{1d6c4}y\u{1d6ca}i\u{1d6ce}v\u{1d6d0}o\u{1d6d2}p\u{1d6d4}o\u{1d6d6}u\u{1d6e0}p\u{1d6e2}A\u{1d6e3}B' +
  '\u{1d6e6}E\u{1d6e7}Z\u{1d6e8}H\u{1d6ea}I\u{1d6eb}K\u{1d6ed}M\u{1d6ee}N\u{1d6f0}O\u{1d6f2}P\u{1d6f5}T\u{1d6f6}Y' +
  '\u{1d6f8}X\u{1d6fc}a\u{1d6fe}y\u{1d704}i\u{1d708}v\u{1d70a}o\u{1d70c}p\u{1d70e}o\u{1d710}u\u{1d71a}p\u{1d71c}A' +
  '\u{1d71d}B\u{1d720}E\u{1d721}Z\u{1d722}H\u{1d724}I\u{1d725}K\u{1d727}M\u{1d728}N\u{1d72a}O\u{1d72c}P\u{1d72f}T' +
  '\u{1d730}Y\u{1d732}X\u{1d736}a\u{1d738}y\u{1d73e}i\u{1d742}v\u{1d744}o\u{1d746}p\u{1d748}o\u{1d74a}u\u{1d754}p' +
  '\u{1d756}A\u{1d757}B\u{1d75a}E\u{1d75b}Z\u{1d75c}H\u{1d75e}I\u{1d75f}K\u{1d761}M\u{1d762}N\u{1d764}O\u{1d766}P' +
  '\u{1d769}T\u{1d76a}Y\u{1d76c}X\u{1d770}a\u{1d772}y\u{1d778}i\u{1d77c}v\u{1d77e}o\u{1d780}p\u{1d782}o\u{1d784}u' +
  '\u{1d78e}p\u{1d790}A\u{1d791}B\u{1d794}E\u{1d795}Z\u{1d796}H\u{1d798}I\u{1d799}K\u{1d79b}M\u{1d79c}N\u{1d79e}O' +
  '\u{1d7a0}P\u{1d7a3}T\u{1d7a4}Y\u{1d7a6}X\u{1d7aa}a\u{1d7ac}y\u{1d7b2}i\u{1d7b6}v\u{1d7b8}o\u{1d7ba}p\u{1d7bc}o' +
  '\u{1d7be}u\u{1d7c8}p\u{1d7ca}F\u{1ee00}l\u{1ee24}o\u{1ee80}l\u{1ee84}o';
const pairMap = (s) => { const m = {}, cps = [...s]; for (let i = 0; i + 1 < cps.length; i += 2) m[cps[i]] = cps[i + 1]; return m; };
const CONFUSABLE = pairMap(CONFUSABLE_PAIRS);
const VIEW_FOLD_RE = reFromKeys(VIEW_FOLD), CONFUSABLE_RE = reFromKeys(CONFUSABLE);
const VIEW_SPACES = /[\u0085\u2028\u2029\u2800]/g;                                // NEL, line and paragraph separators, Braille blank
export function renderedView(text) {
  let t = stripEmphasis(normalizeForScan(renderMarkup(String(text || ''))));
  if (!/[^\x00-\x7F]/.test(t)) return t;
  t = t.replace(VIEW_FOLD_RE, (c) => VIEW_FOLD[c]).normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return t.replace(CONFUSABLE_RE, (c) => CONFUSABLE[c]).replace(VIEW_SPACES, ' ');
}

export function normalizationStats(text) {
  const c = (re) => ((text || '').match(re) || []).length;
  const s = { zeroWidth: c(ZERO_WIDTH), bidi: c(BIDI), invisible: 0, tag: c(TAGS), lookalike: c(LOOKALIKE_ALL_RE) };
  s.invisible = c(HIDDEN) - s.zeroWidth - s.bidi - s.tag;   // OTHER_INVISIBLE plus every other default-ignorable character
  s.compat = [...(text || '').replace(/[\x00-\x7F]/g, '')].filter((ch) => !NFKC_KEEP.has(ch) && !/\s/.test(ch) && ch.normalize('NFKC') !== ch).length;
  s.spaces = c(SPACES); s.quotes = c(SINGLE_QUOTES_SCAN) + c(DOUBLE_QUOTES); s.dashes = c(HYPHENS) + c(DASHES);
  s.obfuscation = s.zeroWidth + s.bidi + s.invisible + s.tag + s.lookalike;   // characters a person rarely types on purpose
  s.changed = normalizeForScan(text || '') !== (text || '');
  return s;
}

export const canonicalForScan = (text) => stripEmphasis(normalizeForScan(text));

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function cli() {
  const args = process.argv.slice(2);
  const bad = args.filter((a) => a !== '--json');
  if (bad.length) { process.stderr.write(`text-normalize: unknown argument ${bad[0]}\nusage: node text-normalize.mjs [--json] < text\n`); process.exit(1); }
  const text = readFileSync(0, 'utf8');
  const canonical = canonicalForScan(text);
  process.stdout.write(args.includes('--json') ? JSON.stringify({ canonical, rendered: renderedView(text), inputCodePoints: [...text].length }) + '\n' : canonical);
}
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) cli();
