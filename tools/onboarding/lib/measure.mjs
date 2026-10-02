// measure.mjs: turn per-document measurements into a writing profile, derive the REGISTER bands for the overlay,
// and find recurring phrases and approved-line candidates. Per-document measurement is the template's measureDoc,
// so the profile and the checks in the rendered overlay share one definition of a sentence, a contraction, a dash.

const round1 = (x) => Math.round(x * 10) / 10;
const per1k = (k, w) => (w ? (k * 1000) / w : 0);

export function dist(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const q = (p) => { const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
  return { n: a.length, min: a[0], p10: round1(q(0.1)), p25: round1(q(0.25)), median: round1(q(0.5)), mean: round1(mean), p75: round1(q(0.75)), p90: round1(q(0.9)), max: a[a.length - 1], stdev: round1(sd) };
}

// The writing profile of a set of documents (statistics only, no text).
export function profileOf(texts, measureDoc, median) {
  const ms = texts.map((t) => measureDoc(t));
  const words = ms.reduce((s, m) => s + m.words, 0);
  const lengths = ms.flatMap((m) => m.sentenceLengths);
  const sum = (k) => ms.reduce((s, m) => s + m[k], 0);
  const sentencesN = lengths.length;
  const rates = (k, minWords) => dist(ms.filter((m) => m.words >= minWords).map((m) => per1k(m[k], m.words)));
  return {
    docs: ms.length,
    words,
    sentences: sentencesN,
    sentenceWords: { ...dist(lengths), shareUpTo4: round1((100 * lengths.filter((l) => l <= 4).length) / (sentencesN || 1)), shareUpTo6: round1((100 * lengths.filter((l) => l <= 6).length) / (sentencesN || 1)), share30Plus: round1((100 * lengths.filter((l) => l >= 30).length) / (sentencesN || 1)) },
    docMedianSentence: dist(ms.filter((m) => m.sentenceLengths.length >= 5).map((m) => median(m.sentenceLengths))),
    per1kWords: Object.fromEntries(['contractions', 'emDash', 'doubleHyphen', 'enDashSpaced', 'ellipsis', 'semicolons', 'colons'].map((k) => [k, round1(per1k(sum(k), words))])),
    perDocPer1k: { contractions: rates('contractions', 150), emDash: rates('emDash', 100), ellipsis: rates('ellipsis', 100) },
    percentOfSentences: { questions: round1((100 * sum('questions')) / (sentencesN || 1)), exclamations: round1((100 * sum('exclamations')) / (sentencesN || 1)), lowercaseStarts: round1((100 * sum('lowercaseStarts')) / (sentencesN || 1)) },
  };
}

// REGISTER bands for the overlay, widened from the tune profile so the same writer's other documents sit inside.
// Each band is null when there isn't enough data to set it; notes say why.
export function registerFrom(profile, { judgeRegister = 'internal' } = {}) {
  const notes = [];
  const reg = { judgeRegister, sentenceMedian: null, contractions: null, emDash: null };
  const dm = profile.docMedianSentence;
  if (dm.n >= 3) {
    reg.sentenceMedian = { low: Math.max(1, Math.floor(dm.min * 0.75)), high: Math.ceil(dm.max * 1.35) + 1, minSentences: 8 };
  } else notes.push(`sentenceMedian is off: only ${dm.n} tune samples have 5 or more sentences (need 3).`);
  const c = profile.perDocPer1k.contractions;
  if (c.n >= 3 && c.p10 > 0) reg.contractions = { minPer1k: round1(c.p10 * 0.5), minWords: 150 };
  else notes.push(c.n < 3 ? `contractions is off: only ${c.n} tune samples have 150 or more words (need 3).` : 'contractions is off: some of your longer samples use none, so a draft without them is not out of character.');
  const d = profile.perDocPer1k.emDash;
  if (d.n >= 3) reg.emDash = { maxPer1k: round1(d.max * 1.5 + 2), minWords: 100 };
  else notes.push(`emDash is off: only ${d.n} tune samples have 100 or more words (need 3).`);
  return { register: reg, notes };
}

const STOP = new Set(('a an the and or but if so of to in on at by for with from as is are was were be been being it its this that these those ' +
  'i me my we our you your he she they them their his her not no do does did have has had will would can could should ' +
  'just very there here what which who when where how than then also about into over up out').split(' '));
const tokens = (s) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []);

// Phrases of 2 to 4 words that appear in at least `minDocs` different documents, longest first, without phrases
// that only appear inside a longer listed one. [{ phrase, docs, count }]
export function recurringPhrases(texts, sentencesOf, { minDocs = 2, max = 30 } = {}) {
  const docsOf = new Map(), countOf = new Map();
  texts.forEach((t, d) => {
    for (const s of sentencesOf(t)) {
      const tk = tokens(s);
      for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= tk.length; i++) {
        const g = tk.slice(i, i + n);
        if (g.every((w) => STOP.has(w)) || (STOP.has(g[0]) && STOP.has(g[n - 1]))) continue;
        const k = g.join(' ');
        countOf.set(k, (countOf.get(k) || 0) + 1);
        (docsOf.get(k) || docsOf.set(k, new Set()).get(k)).add(d);
      }
    }
  });
  let list = [...docsOf].filter(([, ds]) => ds.size >= minDocs).map(([phrase, ds]) => ({ phrase, docs: ds.size, count: countOf.get(phrase), n: phrase.split(' ').length }));
  list.sort((a, b) => b.n - a.n || b.docs - a.docs || b.count - a.count);
  const kept = [];
  for (const p of list) if (!kept.some((k) => k.docs === p.docs && ` ${k.phrase} `.includes(` ${p.phrase} `))) kept.push(p);
  kept.sort((a, b) => b.docs - a.docs || b.count - a.count || b.n - a.n);
  return kept.slice(0, max).map(({ phrase, docs, count }) => ({ phrase, docs, count }));
}

// Approved-line candidates: text a check flagged in at least `minDocs` different documents. `flags` is one list per
// document of { check, text }. Only spans that occur in that document's text are kept (doc-level statistics such as
// a uniformity score have no span). [{ line, docs, checks }]
export function approvedCandidates(texts, flags, { minDocs = 2, max = 40 } = {}) {
  const agg = new Map();
  flags.forEach((list, d) => {
    const lower = texts[d].toLowerCase();
    for (const f of list) {
      const raw = String(f.text || '').replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
      const key = raw.toLowerCase();
      if (key.length < 3 || key.length > 120 || !lower.includes(key)) continue;
      const e = agg.get(key) || { line: raw, docs: new Set(), checks: new Set() };
      e.docs.add(d); e.checks.add(f.check);
      agg.set(key, e);
    }
  });
  return [...agg.values()].filter((e) => e.docs.size >= minDocs)
    .map((e) => ({ line: e.line, docs: e.docs.size, checks: [...e.checks].sort() }))
    .sort((a, b) => b.docs - a.docs || a.line.localeCompare(b.line))
    .slice(0, max);
}
