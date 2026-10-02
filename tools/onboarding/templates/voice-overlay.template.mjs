// voice-overlay.mjs: a personal voice overlay for the voice engine.
//
// Drafted by onboarding/profile-build.mjs from onboarding/templates/voice-overlay.template.mjs. The engine runs a
// generic AI-writing detector on everything it scores; this file adds what is personal to one writer:
//   APPROVED_LINES  lines you really write that a check flags; this overlay's own checks never flag text inside them
//   REGISTER        your measured habits (sentence length, contractions, em dashes); a draft far outside them is
//                   listed as must-fix by the scorer and the gate, never blocked (the send hook doesn't read it)
//   TEAM_WORDS      words you never use, flagged as high; the scorer and the gate count them (empty until you add some)
//   TEAM_PHRASES    phrases you would never write, flagged as critical, which the send hook blocks (empty until you add some)
//
// Review it before it is used. Read every APPROVED_LINES entry and every REGISTER value, delete what isn't yours,
// add TEAM_WORDS and TEAM_PHRASES if you want them, then set REVIEWED = true. voice-doctor fails until you do,
// and the engine treats an unreviewed overlay as uncalibrated (CALIBRATED = REVIEWED).
//
// Privacy. A filled-in copy holds short phrases taken from your own writing. Keep it on this machine: don't paste
// it into a chat, an AI session or an issue tracker. The onboarding tools print counts, never these phrases.
//
// Interface contract (the engine imports these names; keep them and their shapes):
//   scanVoice(text) -> [{ type, text, severity, fix }]   type is `${ISSUE_PREFIX}-word|phrase|struct-*|cadence-*|probe`
//   hardBanCount(issues), cadenceCount(issues)           counts by type
//   CALIBRATED, VERDICT_STRUCT_TYPES, EXEMPTIONS         flags and lists the engine reads
//   measureDoc(text)                                     the measurements profile-build used, so a check and its
//                                                        threshold always share one definition

import { pathToFileURL } from 'node:url';

// Set to true after you have reviewed this file.
export const REVIEWED = /*@REVIEWED*/false/*@END*/;

// Issue-type prefix. Engines and hooks group issues by `${ISSUE_PREFIX}-struct-*`, `-cadence-*` and so on.
export const ISSUE_PREFIX = /*@ISSUE_PREFIX*/'voice'/*@END*/;

// A random token. voice-doctor scores a text containing it and checks that the engine reports a probe issue, which
// shows the engine reads this file and not some other overlay. No real text contains it.
export const PROBE = /*@PROBE*/'voice-probe-0000000000000000'/*@END*/;

// Exact lines to never flag with this overlay's checks: a sign-off you really use, a quote you repeat. Matching
// ignores case. The generic detector and the send hook's own word list don't read this list today;
// calibrate-user.mjs says so when one of those is what fired.
export const APPROVED_LINES = /*@APPROVED_LINES*/[]/*@END*/;

// Words you never use and phrases you would never write. Leave empty if you don't have any.
export const TEAM_WORDS = /*@TEAM_WORDS*/[]/*@END*/;
export const TEAM_PHRASES = /*@TEAM_PHRASES*/[]/*@END*/;

// Measured habits. A null field turns its check off. Bands are widened from your tune samples, so your own
// writing should sit inside them; calibrate-user.mjs tests that on samples this file was not built from.
export const REGISTER = /*@REGISTER*/{
  judgeRegister: 'internal',
  sentenceMedian: null,
  contractions: null,
  emDash: null,
}/*@END*/;

// Types that reject a draft on their own in the gate (prose-gate.mjs). Only add one that fires on none of your
// samples. Empty by default.
export const VERDICT_STRUCT_TYPES = /*@VERDICT_STRUCT_TYPES*/[]/*@END*/;

// Optional: an overlay the engine ships. When set, its issues are included and the same approved lines apply.
export const BASE_OVERLAY = /*@BASE_OVERLAY*/null/*@END*/;

// What profile-build measured and when: statistics, plus the phrases you repeat most (taken from your writing,
// which is one more reason this file stays on this machine).
export const PROFILE = /*@PROFILE*/null/*@END*/;

// Notes from profile-build for your review.
export const NOTES = /*@NOTES*/[]/*@END*/;

// ── engine interface (no edits needed below) ─────────────────────────────────────────────────────────────────
export const EXEMPTIONS = APPROVED_LINES;
export const CALIBRATED = REVIEWED === true;

// Light canonicalization: compatibility forms, format characters (zero-width and similar), curly quotes.
export function normalize(text = '') {
  return String(text).normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\r\n?/g, '\n');
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|approx|incl|a\.m|p\.m)\./gi;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
export const words = (s) => s.match(WORD) || [];

// Sentences: each line is at least one sentence (chat messages often have no final period), split further after
// . ! ? or an ellipsis. Code, links, list markers and heading marks are removed first.
export function sentences(text) {
  const t = normalize(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' code ')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/^\s*(?:[-*+\u2022]|\d+[.)])\s+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(ABBREV, (m) => m.replace(/\./g, ''));
  const out = [];
  for (const line of t.split('\n')) {
    for (const s of line.split(/(?<=[.!?\u2026])["')\]]*\s+/)) if (words(s).length) out.push(s.trim());
  }
  return out;
}

const CONTRACTION = /\b\p{L}+(?:n't|'re|'ve|'ll|'d|'m)\b|\b(?:it|that|there|here|what|who|where|when|how|let|he|she|everyone|nobody|someone|something|nothing)'s\b/giu;
const count = (s, rx) => (s.match(rx) || []).length;

export function measureDoc(text) {
  const n = normalize(text);
  const sents = sentences(text);
  return {
    words: words(n).length,
    sentenceLengths: sents.map((s) => words(s).length),
    contractions: count(n, CONTRACTION),
    emDash: count(n, /\u2014/g),
    doubleHyphen: count(n, /\s--\s/g),
    enDashSpaced: count(n, /\s\u2013\s/g),
    ellipsis: count(n, /\u2026|\.{3,}/g),
    semicolons: count(n, /;/g),
    colons: count(n, /:(?!\/\/)/g),
    questions: sents.filter((s) => /\?["')\]]*$/.test(s)).length,
    exclamations: sents.filter((s) => /!["')\]]*$/.test(s)).length,
    lowercaseStarts: sents.filter((s) => /^\p{Ll}/u.test(s)).length,
  };
}

export const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const per1k = (k, w) => (w ? (k * 1000) / w : 0);
const round1 = (x) => Math.round(x * 10) / 10;

function registerIssues(m, P) {
  const out = [];
  const r = REGISTER || {};
  const sm = r.sentenceMedian;
  if (sm && m.sentenceLengths.length >= (sm.minSentences ?? 8)) {
    const med = median(m.sentenceLengths);
    if (med < sm.low || med > sm.high) out.push({ type: `${P}-cadence-sentence-length`, severity: 'medium', text: `median sentence ${med} words, your range ${sm.low}-${sm.high}`, fix: med > sm.high ? 'split the longest sentences' : 'join some short sentences' });
  }
  const c = r.contractions;
  if (c && c.minPer1k > 0 && m.words >= (c.minWords ?? 150)) {
    const rate = per1k(m.contractions, m.words);
    if (rate < c.minPer1k) out.push({ type: `${P}-cadence-contractions`, severity: 'medium', text: `${round1(rate)} contractions per 1,000 words, you use at least ${c.minPer1k}`, fix: 'write the way you talk: it\'s, don\'t, we\'re' });
  }
  const d = r.emDash;
  if (d && d.maxPer1k != null && m.words >= (d.minWords ?? 100) && m.emDash >= 2) {
    const rate = per1k(m.emDash, m.words);
    if (rate > d.maxPer1k) out.push({ type: `${P}-cadence-em-dash`, severity: 'medium', text: `${m.emDash} em dashes (${round1(rate)} per 1,000 words), you use at most ${d.maxPer1k}`, fix: 'use the punctuation you normally use: a comma, a period, parentheses' });
  }
  return out;
}

const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Spans of the approved lines in the lowered text, as [start, end) pairs.
function approvedSpans(lower) {
  const spans = [];
  for (const line of APPROVED_LINES) {
    const l = normalize(line).toLowerCase().trim();
    if (!l) continue;
    for (let i = lower.indexOf(l); i !== -1; i = lower.indexOf(l, i + 1)) spans.push([i, i + l.length]);
  }
  return spans;
}
// An issue is exempt when every occurrence of its matched text sits inside an approved line.
function exempt(issue, lower, spans) {
  const t = normalize(issue.text || '').toLowerCase().trim();
  if (!t || !spans.length) return false;
  let any = false;
  for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
    any = true;
    if (!spans.some(([a, b]) => i >= a && i + t.length <= b)) return false;
  }
  return any;
}

let base = null;
if (BASE_OVERLAY) {
  try {
    const m = await import(BASE_OVERLAY.startsWith('file:') ? BASE_OVERLAY : pathToFileURL(BASE_OVERLAY).href);
    base = Object.entries(m).find(([k, v]) => /^scan\w*Voice$/.test(k) && typeof v === 'function')?.[1] || null;
  } catch (e) {
    throw new Error(`voice overlay: BASE_OVERLAY ${BASE_OVERLAY} doesn't load (${e.message})`);
  }
}

export function scanVoice(text = '', opts = {}) {
  const P = ISSUE_PREFIX;
  const n = normalize(text);
  const lower = n.toLowerCase();
  const issues = [];
  for (const w of TEAM_WORDS) {
    const m = n.match(new RegExp(`(?<![\\p{L}\\p{N}])${escRx(normalize(w))}(?![\\p{L}\\p{N}])`, 'giu'));
    if (m) issues.push({ type: `${P}-word`, severity: 'high', text: m[0], fix: `a word you don't use: "${w}"` });
  }
  for (const p of TEAM_PHRASES) {
    const l = normalize(p).toLowerCase();
    const i = l ? lower.indexOf(l) : -1;
    if (i !== -1) issues.push({ type: `${P}-phrase`, severity: 'critical', text: n.slice(i, i + l.length), fix: 'a phrase you would never write' });
  }
  issues.push(...registerIssues(measureDoc(text), P));
  if (PROBE && n.includes(PROBE)) issues.push({ type: `${P}-probe`, severity: 'low', text: PROBE, fix: 'voice-doctor probe' });
  if (base) for (const i of base(text, opts) || []) issues.push({ ...i, text: String(i.text ?? '') });
  const spans = approvedSpans(lower);
  return issues.filter((i) => !exempt(i, lower, spans));
}

export const hardBanCount = (issues = []) => issues.filter((i) => /-(word|phrase)$|-struct-/.test(i.type)).length;
export const cadenceCount = (issues = []) => issues.filter((i) => /-cadence-/.test(i.type)).length;
