// Regression test for aiscore.mjs's cadence-adjusted score (the number prose-gate rejects on at ≥ 40).
// Run:  node ~/.claude/tools/aiscore.test.mjs   (exit 0 = pass; local only, no network)
// Guards cadence staying out of the score by default (2026-10-01): CADENCE_POINTS is empty in the starter kit, so
// --cadence-weight adds nothing until an overlay's cadence types get weights.
// Also guards the AI-evidence score (ai-evidence.mjs): only categories that held up as AI evidence count, the
// rest still print, and every detector category is classified on purpose.
// The texts are synthetic, written for this test.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COUNTED, NOT_COUNTED } from './ai-evidence.mjs';

const AISCORE = join(dirname(fileURLToPath(import.meta.url)), 'aiscore.mjs');
const score = (text, ...flags) => JSON.parse(execFileSync('node', [AISCORE, '-', '--json', ...flags], { input: text, encoding: 'utf8' }));
const OV = await import('./voice-overlay.mjs');

// A plain, choppy work note: detector score 0, but low-flow + staccato-run fire (22 + 18 = 40 under the old
// weighting). Since 2026-10-01 cadence adds 0 points by default; --cadence-weight restores the capped weighting.
const CHOPPY = 'We moved the job on Monday. The old scheduler kept skipping runs. Nobody knew why at first. I read the config files. Most of them were stale. Two jobs pointed at a dead host. We fixed those first. Then the reports came back. The cache was cold for a day. After that it settled. The finance report now lands at six. The sales one lands at seven. I wrote a short page about it. It says who owns each job. It says how to change the schedule. It says what to check when a run fails. Nobody has asked a question since. The alerts are quieter now. On-call slept through the weekend. We turned off three unused jobs. That saved more time than the tuning did. I would do it again.';
// The same rhythm with slop vocabulary on top. The vocabulary (tier1) fires on human docs as often as on AI
// drafts, so it still prints but adds nothing to the evidence score: cadence alone keeps it under 40.
const SLOPPY = 'We leverage a robust, seamless platform to streamline the workflow. It works. It scales. It ships. We moved the job on Monday. The old scheduler kept skipping runs. Nobody knew why at first. I read the config files. Most of them were stale. Two jobs pointed at a dead host. We fixed those first. Then the reports came back. The cache was cold for a day. After that it settled. The finance report now lands at six. The sales one lands at seven. I wrote a short page about it. It says who owns each job. It says how to change the schedule. The alerts are quieter now. On-call slept through the weekend. We turned off three unused jobs. I would do it again.';

// The choppy note with two things the drafts did and human docs mostly didn't: unfilled placeholders and bold
// on every line. Those count as AI evidence; under the opt-in capped weighting, evidence plus cadence reaches the bar.
const EVIDENT = 'Hi [Recipient Name],\n\n**Owner:** finance ops. **Schedule:** six and seven. **Alerts:** quieter. **Runbook:** one page.\n\n' + CHOPPY + '\n\nBest,\n[Your Name]';
// Business-email closers fire the detector's chatbot category; they're common in human email, so they don't count.
const CLOSERS = 'Thanks for sending the schedule over this morning. I went through it with the finance team and we can move the review to Thursday at ten, after the quarter-end numbers are in. I hope this helps with the planning. Feel free to reach out if the room changes, and let me know if you need anything else for the board pack.';
// Normalization (text-normalize.mjs): ordinary writing must score exactly as it did, and typing a tell with
// lookalike characters must not hide it. ORDINARY covers markdown bold and bullets, curly quotes, em-dashes, an
// ellipsis, a non-breaking space and an emoji. OBFUSCATED is EVIDENT with fullwidth brackets and odd spaces.
const ORDINARY = [
  CHOPPY, SLOPPY, EVIDENT, CLOSERS,
  '**Owner:** finance ops. **Schedule:** six and seven.\n\n* first item\n* second item\n\nShe said “ship it” and he didn’t argue — the tests were green… mostly. The review is at 10\u00A0a.m. ✅ Done.',
];
const OBFUSCATED = EVIDENT.replace(/\[/g, '\uFF3B').replace(/\]/g, '\uFF3D').replace('Recipient Name', 'Recipient\u00A0Name').replace('Your Name', 'Your\u2007Name');
const DETECTOR = createRequire(import.meta.url)('./avoid-ai-writing/detector/patterns.js');
const W_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'avoid-ai-writing/detector/patterns.js'), 'utf8').match(/const ISSUE_WEIGHTS = (\{[\s\S]*?\n  \});/);
const WEIGHTS = W_SRC ? Function(`return (${W_SRC[1]});`)() : null;

const CASES = [
  ['choppy human-style note: cadence adds no points by default', () => { const j = score(CHOPPY); return j.score === 0 && j.cadencePenalty === 0 && j.adjustedScore === 0; }],
  ['slop vocabulary still prints but adds no AI evidence', () => { const j = score(SLOPPY); return j.score >= 8 && j.evidenceScore === 0 && j.issueTypes.tier1 > 0 && j.adjustedScore < 40; }],
  ['counted evidence is the adjusted score', () => { const j = score(EVIDENT); return j.evidenceScore >= 8 && j.adjustedScore === j.evidenceScore && j.cadencePenalty === 0; }],
  ['--cadence-weight adds nothing when no cadence type has a weight', () => { const j = score(CHOPPY, '--cadence-weight'); return j.cadencePenalty === 0 && j.adjustedScore === j.evidenceScore; }],
  ['--no-cadence-weight leaves the evidence score', () => { const j = score(EVIDENT, '--no-cadence-weight'); return j.adjustedScore === j.evidenceScore && j.cadencePenalty === 0; }],
  ['business-email closers print as chatbot but don\'t count', () => { const j = score(CLOSERS); return j.issueTypes.chatbot > 0 && j.score > 0 && j.evidenceScore === 0; }],
  ['ordinary text scores the same with and without normalization', () => ORDINARY.every((t) => { const a = score(t), b = score(t, '--no-normalize'); return ['score', 'evidenceScore', 'adjustedScore', 'issueTypes', 'voice'].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])); })],
  ['fullwidth brackets and odd spaces don\'t hide placeholders from the evidence score', () => { const a = score(EVIDENT), b = score(OBFUSCATED); return b.evidenceScore === a.evidenceScore && b.evidenceScore > 0 && score(OBFUSCATED, '--no-normalize').evidenceScore < a.evidenceScore; }],
  ['the report counts invisible and look-alike characters', () => { const j = score('the pre\u200Bview v\u0435rsion is'); return j.normalization.zeroWidth === 1 && j.normalization.lookalike === 1 && j.normalization.obfuscation === 2; }],
  ['every detector category is classified exactly once', () => { const all = Object.keys(DETECTOR.TYPE_LABELS); const c = new Set(Object.keys(COUNTED)), n = new Set(Object.keys(NOT_COUNTED)); return all.every((t) => c.has(t) !== n.has(t)) && [...c, ...n].every((t) => all.includes(t)); }],
  ['counted weights match patterns.js', () => WEIGHTS && Object.entries(COUNTED).every(([t, w]) => WEIGHTS[t] === w)],
  ['a full HTML document is reduced to its prose before scanning', () => { const j = score('<!doctype html><html><body><p>We moved the job.</p><p>Hi [Recipient Name], the plan is ready.</p></body></html>'); return j.htmlStripped === true && j.issueTypes['ai-placeholder'] > 0; }],
  ['the voice block holds the installed overlay\'s issues (its probe token is reported)', () => { if (typeof OV.PROBE !== 'string') return true; const j = score(`We moved the job. ${OV.PROBE}`); return Array.isArray(j.voice.issues) && typeof j.voice.hardBans === 'number' && j.voice.issues.some((i) => /-probe$/.test(i.type)); }],
];
// ── Linear-time HTML reduction (2026-10-02, verify item 19) ───────────────────────────────────────────────────────
// htmlToProse and looksLikeHtmlDoc used lazy and greedy regexes (<script[\s\S]*?<\/script>, <[^>]+>,
// <html[\s>][\s\S]*<\/html>) that rescan to the end of the text from every opener with no closer after it: 40,000
// unclosed <script> tags took about 3 s, growing with the square of the count, which could push the send hook past its
// 20 s scorer timeout. OLD below is the regex version, verbatim from ca26e8a, as the oracle: the linear version must give
// byte-identical output on generated tag soups (unclosed, nested, mixed case, attributes, comments, CDATA) and must be
// fast on the shapes that were slow. Every input here is generated.
const OLD_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#039;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&times;': '×', '&rarr;': '→' };
const OLD = {
  looksLikeHtmlDoc(t) {
    if (/<!doctype\s+html/i.test(t)) return true;
    if (/<html[\s>][\s\S]*<\/html>/i.test(t)) return true;
    if (/<body[\s>][\s\S]*<\/body>/i.test(t)) return true;
    const closings = (t.match(/<\/(?:div|p|span|section|li|td|tr|ul|ol|table|h[1-6]|a|nav|header|footer|main|article|body|html|head|script|style)>/gi) || []).length;
    return closings >= 8;
  },
  htmlToProse(html) {
    let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<\/(?:p|div|h[1-6]|li|td|th|tr|section|header|footer|blockquote|article|ul|ol|table|main|nav|aside|figure|figcaption)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, m => OLD_ENTITIES[m.toLowerCase()] ?? ' ');
    return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  },
};
const { htmlToProse, looksLikeHtmlDoc } = await import('./aiscore.mjs');
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SOUP = ['<script>', '<script', '<SCRIPT type="text/x">', '<ScRiPt', '</script>', '</SCRIPT>', '</script >', '</scrip', '<scripts>', '<script/>',
  '<style>', '<style media="a">', '</style>', '</STYLE>', '<head>', '<HEAD>', '<header>', '</head>', '</header>', '<!--', '-->', '<!-->', '--!>', '--',
  '<![CDATA[', ']]>', '<!doctype html>', '<!DOCTYPE HTML>', '<!doctype', '<html>', '<html lang="en">', '<html', '<HTML\n', '</html>', '<body>',
  '<body class="a">', '<body', '</body>', '<p>', '</p>', '</P>', '<div class="x y">', '</div>', '<br>', '<br/>', '<br />', '<BR\t>', '<br', '<span>',
  '</span>', '<a href="https://example.com/?a=1&b=2">', '</a>', '<li>', '</li>', '<td>', '</td>', '</th>', '<h1>', '</h2>', '<b>', '</b>', '<', '>',
  '<>', '< >', '<<', '>>', '</', '/>', '&amp;', '&AMP;', '&nbsp;', '&#39;', '&#039;', '&mdash;', '&rarr;', '&bogus;', '&', '&;', '&#x41;', ';',
  'the', 'short', 'version', 'is', 'We moved the job.', 'So', ' ', '  ', '\t', '\n', '\n\n\n', ' ', ' ', 'é', '“quoted”',
  '—', '…', 'x=1', '"', "'", '=', '/', 'a', '1'];
const soup = (r) => { let s = ''; for (let k = 1 + Math.floor(r() * 80); k > 0; k--) s += SOUP[Math.floor(r() * SOUP.length)]; return s; };
const elapsed = (f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
CASES.push(
  ['htmlToProse and looksLikeHtmlDoc match the old regexes on 6,000 generated tag soups', () => {
    const r = rng(20261002);
    for (let i = 0; i < 6000; i++) {
      const t = soup(r);
      if (htmlToProse(t) !== OLD.htmlToProse(t) || looksLikeHtmlDoc(t) !== OLD.looksLikeHtmlDoc(t)) { console.log(`   differs on ${JSON.stringify(t)}`); return false; }
    }
    return true;
  }],
  ['htmlToProse reduces 40,000 unclosed <script> tags in under 100 ms', () => { htmlToProse('<p>warm up</p>'); const t = '<script>'.repeat(40000); return elapsed(() => htmlToProse(t)) < 100; }],
  ['htmlToProse stays under 100 ms on other unclosed shapes: comments, <style, <head, bare "<", "<a", "<br"', () =>
    [['<!--', 40000], ['<style>', 40000], ['<head>', 40000], ['<', 120000], ['<a', 60000], ['<br', 60000]].every(([u, k]) => { const t = u.repeat(k); const ms = elapsed(() => htmlToProse(t)); if (ms >= 100) console.log(`   ${JSON.stringify(u)} x${k}: ${ms.toFixed(0)} ms`); return ms < 100; })],
  ['looksLikeHtmlDoc stays under 100 ms on 40,000 <html or <body openers with no closer', () =>
    ['<html ', '<body '].every((u) => { const t = u.repeat(40000); return elapsed(() => looksLikeHtmlDoc(t)) < 100; })],
  ['a page with 40,000 unclosed <script> tags scores in under 2 s, the same as the page without them', () => {
    const page = '<!doctype html><p>We moved the scheduler on Monday.</p><p>Hi [Recipient Name], nobody owned it.</p>';
    const t0 = Date.now(), a = score(page + '<script>'.repeat(40000)), ms = Date.now() - t0, b = score(page);
    if (ms >= 2000) console.log(`   took ${ms} ms`);
    delete a.file; delete b.file;
    return ms < 2000 && JSON.stringify(a) === JSON.stringify(b) && a.issueTypes['ai-placeholder'] > 0;
  }],
);

let fail = 0;
for (const [name, ok] of CASES) if (!ok()) { fail++; console.log(`✗ ${name}`); }
console.log(fail ? `\nFAIL: ${fail}/${CASES.length} cases failed` : `PASS: ${CASES.length}/${CASES.length} cases (AI-evidence score, cadence off by default, HTML reduction, the overlay block, linear-time HTML reduction)`);
process.exit(fail ? 1 : 0);
