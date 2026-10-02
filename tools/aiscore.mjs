#!/usr/bin/env node
// aiscore — score prose for AI-writing tells. Two layers:
//   1. generic avoid-ai-writing detector (0-100 AI score, MIT, local)
//   2. your personal overlay, voice-overlay.mjs (words, phrases and habits the generic detector misses; it ships
//      blank and /voice-setup installs your reviewed copy)
// 100% local (no network). The overlay lives outside the vendored detector, so a detector update never touches it.
//
// Usage:
//   node ~/.claude/tools/aiscore.mjs <file> [--json] [--technical] [--plain] [--no-overlay] [--raw] [--no-normalize]
//   echo "text" | node ~/.claude/tools/aiscore.mjs - [--json]
// HTML inputs are auto-reduced to visible prose before scanning (so CSS/script/class-names
// don't inflate cadence counts or fire false hard-bans). --raw disables that (score bytes as-is).
//
// Exit code = 0 always (it's a signal, not a verdict — per the skill's own stance).
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// The personal overlay, under the kit names (blank template: onboarding/templates/voice-overlay.template.mjs).
import { scanVoice, hardBanCount, cadenceCount } from './voice-overlay.mjs';
import { evidenceScore } from './ai-evidence.mjs';
import { normalizeForDetector, normalizationStats } from './text-normalize.mjs';
const require = createRequire(import.meta.url);
// Resolve the detector relative to THIS file (createRequire base = aiscore.mjs) so a clone runs
// wherever it lands; override with AVOID_AI_DETECTOR if the clone lives elsewhere.
const D = require(process.env.AVOID_AI_DETECTOR || './avoid-ai-writing/detector/patterns.js');


// Reduce a full HTML document to its visible prose before scanning. CSS rules, <script>/<style>
// bodies, class/id names, and tag attributes otherwise read as prose — inflating cadence counts
// and firing false hard-bans (a `.mcp-deep-dive` CSS class scored as a "deep-dive" ban ×4).
// Gated on HTML detection + off with --raw, so it is a STRICT no-op on markdown/plain prose
// (the eval corpus has no HTML docs → its scores are byte-identical → the self-gate is unaffected).
// Detect a real HTML *document*, not prose that merely mentions a tag in backticks (common in
// technical docs — this very tool's spec discusses `<script>`/`<style>`). Fire on a doctype, a
// full <html>/<body> wrapper, or a high density of closing block/inline tags; a lone tag mention
// in prose stays prose (so a markdown doc about HTML is scored as prose, not stripped).
//
// Linear time (2026-10-02, verify item 19). These steps used to be lazy or greedy regexes (`<script[\s\S]*?<\/script>`,
// `<html[\s>][\s\S]*<\/html>`, `<[^>]+>`), which rescan to the end of the text from every opener that has no closer
// after it: 40,000 unclosed <script> tags took 2.8 s in htmlToProse and 40,000 "<html " openers 14 s in looksLikeHtmlDoc,
// growing with the square of the count, enough to push the send hook past its 20 s scorer timeout. The helpers below
// compute exactly what those regexes computed, in one forward pass. aiscore.test.mjs checks them against the regex
// versions on generated tag soups; the output was byte-identical on every local corpus doc (VOICE-SYSTEM.md history,
// 2026-10-02 hook fix).
// /<open[\s\S]*<\/close>/i.test(t): an opener, then a closer anywhere after it. The first opener leaves the most room.
function openerThenCloser(t, open, close) {
  const m = open.exec(t);
  if (!m) return false;
  close.lastIndex = m.index + m[0].length;
  return close.test(t);
}
export function looksLikeHtmlDoc(t) {
  if (/<!doctype\s+html/i.test(t)) return true;
  if (openerThenCloser(t, /<html[\s>]/i, /<\/html>/gi)) return true;
  if (openerThenCloser(t, /<body[\s>]/i, /<\/body>/gi)) return true;
  const closings = (t.match(/<\/(?:div|p|span|section|li|td|tr|ul|ol|table|h[1-6]|a|nav|header|footer|main|article|body|html|head|script|style)>/gi) || []).length;
  return closings >= 8;
}
const HTML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#039;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&times;': '×', '&rarr;': '→' };
// s.replace(/<open[\s\S]*?close/g, ' '): each opener up to the first closer after it becomes a space. Once one opener
// has no closer after it, no later one does, so the rest of the text is kept as is.
function dropSpans(s, open, close) {
  let out = '', from = 0;
  for (let m; (m = open.exec(s)); ) {
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(s);
    if (!c) break;
    out += s.slice(from, m.index) + ' ';
    from = open.lastIndex = c.index + c[0].length;
  }
  return out + s.slice(from);
}
// s.replace(/<[^>]+>/g, ' '): a "<", at least one character, then the first ">" after it. "<>" isn't a tag. A "<" with
// no ">" anywhere after it ends the scan, because no later "<" has one either.
function dropTags(s) {
  let out = '', from = 0;
  for (let i = s.indexOf('<'); i !== -1; ) {
    const j = s.indexOf('>', i + 1);
    if (j === -1) break;
    if (j === i + 1) { i = s.indexOf('<', j); continue; }
    out += s.slice(from, i) + ' ';
    from = j + 1;
    i = s.indexOf('<', from);
  }
  return out + s.slice(from);
}
export function htmlToProse(html) {
  let s = dropSpans(html, /<!--/g, /-->/g);
  s = dropSpans(s, /<script/gi, /<\/script>/gi);
  s = dropSpans(s, /<style/gi, /<\/style>/gi);
  s = dropSpans(s, /<head/gi, /<\/head>/gi);
  // block boundaries → newline so sentence segmentation survives tag removal
  s = s.replace(/<\/(?:p|div|h[1-6]|li|td|th|tr|section|header|footer|blockquote|article|ul|ol|table|main|nav|aside|figure|figcaption)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  s = dropTags(s)                                                    // remaining tags → space
    .replace(/&[a-z#0-9]+;/gi, m => HTML_ENTITIES[m.toLowerCase()] ?? ' ');
  return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── cadence weighting (added 2026-09-29, off by default since 2026-10-01) ──────────────────────────────────────
// With --cadence-weight, each overlay cadence issue whose type is in CADENCE_POINTS adds its points to adjustedScore,
// capped at CADENCE_CAP. The weights were set for one writer's cadence checks; the blank overlay template defines no
// weighted cadence checks, so the map ships empty and --cadence-weight adds 0 until you add your own overlay's types.
// The raw detector `score` is never changed.
export const CADENCE_POINTS = {};
// Cap (2026-10-01): cadence can raise a score but can't reach the reject bar (40) on its own; the detector has to
// contribute at least 8. Short sentences are common in real writing: with an earlier cap of 60, the cadence checks put
// hundreds of human documents over 40. The cadence flags still print as must-fix.
export const CADENCE_CAP = 32;
// Out of the score by default (2026-10-01, the AI-evidence classification): cadence checks describe one writer's
// habits, not evidence that a model wrote the text. Added one at a time to the evidence score, most of them lowered the
// held-out ranking of AI drafts over same-length human documents. With no cadence points the human reject count stayed
// at 0 and the held-out AUC went up. The flags still print and stay must-fix. --cadence-weight restores the capped
// weighting above, for calibration comparisons only; --no-cadence-weight is accepted and is the default.

// scoreText (2026-10-02): the whole scoring core as a function, so calibration (calibration/human-fp-budget.mjs)
// scores thousands of documents in one process with the same code the CLI runs. Options mirror the CLI flags.
// markdown-aware by default (masks frontmatter/comments); --plain to disable
// Canonicalize before scanning (text-normalize.mjs, 2026-10-02) so invisible characters, look-alike letters,
// space variants and (for the overlay) emphasis markers can't hide a tell. --no-normalize scans the bytes as given.
export function scoreText(text, { technical = false, plain = false, overlay = true, raw = false, normalize = true, cadenceWeight = false } = {}) {
  const contextMode = technical ? 'technical' : 'general';
  const sourceMode = plain ? 'plain' : 'rendered-markdown';
  const useOverlay = overlay;
  const htmlStripped = !raw && looksLikeHtmlDoc(text);
  const scanText = htmlStripped ? htmlToProse(text) : text;

  // The detector strips zero-width characters and swaps common look-alikes itself, and counts them for its
  // normalization-flag, so it gets the lighter normalizeForDetector (see text-normalize.mjs).
  const r = D.analyzeText(normalize ? normalizeForDetector(scanText) : scanText, { contextMode, sourceMode });
  // `rendered`: the pinned tell also runs on the original text's rendered view (a <span> inside a word survives
  // htmlToProse as a space, so the view starts from the text as given).
  const voiceIssues = useOverlay ? scanVoice(scanText, { normalize, rendered: text }) : [];
  const normalization = normalizationStats(scanText);
  const voiceHardBans = hardBanCount(voiceIssues);

  let cadencePenalty = 0;
  if (cadenceWeight) for (const i of voiceIssues) cadencePenalty += CADENCE_POINTS[i.type] || 0;
  cadencePenalty = Math.min(CADENCE_CAP, cadencePenalty);
  // AI-evidence score (2026-10-01): adjustedScore starts from the detector categories that held up as AI evidence
  // against human documents (the public corpora plus private sets; ai-evidence.mjs), not from the raw total. 41 weighted categories no longer count:
  // 20 fired on human docs at least as often as on same-length AI drafts (tier1 vocabulary, transitions, low TTR
  // and others), 2 are style rules (em-dash, wordiness), and 19 hit human docs but no draft (untested). They still
  // print below as tells. Raw `score` is unchanged.
  const aiEvidence = evidenceScore(r);
  const adjustedScore = Math.min(100, aiEvidence + cadencePenalty);

  const types = {};
  for (const i of r.issues) types[i.type] = (types[i.type] || 0) + 1;
  const voiceTypes = {};
  for (const i of voiceIssues) voiceTypes[i.type] = (voiceTypes[i.type] || 0) + 1;
  const json = {
    score: r.score,
    evidenceScore: aiEvidence,
    adjustedScore,
    cadencePenalty,
    label: r.label,
    classification: r.document_classification,
    class_probabilities: r.class_probabilities,
    confidence: r.confidence_category,
    issueCount: r.issues.length,
    issueTypes: types,
    voice: { hardBans: voiceHardBans, cadenceFlags: cadenceCount(voiceIssues), issueTypes: voiceTypes, issues: voiceIssues },
    wordCount: r.stats?.wordCount,
    htmlStripped,
    normalization,
  };
  return { json, r, voiceIssues, voiceHardBans, normalization, aiEvidence, adjustedScore, cadencePenalty, useOverlay };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
function cli() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const target = args.find(a => !a.startsWith('--'));
  const asJson = flags.has('--json');
  const text = !target || target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
  const s = scoreText(text, { technical: flags.has('--technical'), plain: flags.has('--plain'), overlay: !flags.has('--no-overlay'), raw: flags.has('--raw'), normalize: !flags.has('--no-normalize'), cadenceWeight: flags.has('--cadence-weight') && !flags.has('--no-cadence-weight') });
  const { r, voiceIssues, voiceHardBans, normalization, aiEvidence, adjustedScore, cadencePenalty, useOverlay } = s;
  if (asJson) { console.log(JSON.stringify({ file: target || '(stdin)', ...s.json })); process.exit(0); }

  // human-readable report
  const bar = '─'.repeat(56);
  console.log(bar);
  console.log(`  ${target || '(stdin)'}`);
  console.log(`  AI score ${r.score}/100  ·  AI evidence ${aiEvidence}/100${cadencePenalty ? `  ·  cadence-adjusted ${adjustedScore}/100 (+${cadencePenalty})` : ''}   ${r.label}   ${r.document_classification}   conf:${r.confidence_category}`);
  if (useOverlay) {
    const verdict = voiceHardBans === 0 ? 'CLEAN' : `${voiceHardBans} hard-ban${voiceHardBans > 1 ? 's' : ''}`;
    const cad = cadenceCount(voiceIssues);
    console.log(`  voice overlay: ${verdict}${cad ? `  ·  ${cad} cadence flag${cad > 1 ? 's' : ''}` : ''}`);
  }
  if (normalization.obfuscation) console.log(`  normalized before scanning: ${normalization.zeroWidth} zero-width, ${normalization.bidi} bidi, ${normalization.invisible} other invisible, ${normalization.lookalike} look-alike characters`);
  console.log(bar);

  // overlay issues first: your own words, phrases and habits
  if (voiceIssues.length) {
    console.log('  ▸ VOICE OVERLAY ISSUES (fix these first)');
    for (const i of voiceIssues) {
      console.log(`      [${i.type}] ${i.text}`);
      if (i.fix) console.log(`         → ${i.fix}`);
    }
    console.log(bar);
  }

  // generic AI tells
  if (!r.issues.length) {
    console.log('  generic AI detector: no tells flagged.');
  } else {
    console.log('  ▸ GENERIC AI TELLS');
    const byType = {};
    for (const i of r.issues) (byType[i.type] ||= []).push(i);
    const ordered = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);
    for (const [type, list] of ordered) {
      console.log(`      ${type} ×${list.length}`);
      for (const i of list.slice(0, 3)) {
        const q = (i.text || '').replace(/\s+/g, ' ').trim().slice(0, 56);
        console.log(`          "${q}"${i.text && i.text.length > 56 ? '…' : ''}`);
      }
      if (list.length > 3) console.log(`          … +${list.length - 3} more`);
    }
  }
  console.log(bar);
  console.log('  signal, not proof — pair with context before acting.');
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) cli();
