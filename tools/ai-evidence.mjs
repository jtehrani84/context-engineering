// Which generic-detector categories count as AI evidence in adjustedScore (the number prose-gate rejects on).
// Classified 2026-10-01 against 39,193 human docs (the public corpora that calibration/fetch-public-corpora.sh pins,
// plus python-dev and private sets) and 124 fresh AI drafts from four models, comparing each category's hit rate on
// AI drafts with its rate on human docs of the same length. Rule and full table: evidence file recal/CLASSIFY.md
// (2026-10-01; the evidence files are not shipped).
// Every category still prints in the aiscore report; this only decides what moves the score. The raw detector
// `score` is unchanged (voice-tell-gate.py and harness-eval read it). aiscore.test.mjs fails if the detector gains
// a category that is in neither list, or if a COUNTED weight drifts from patterns.js ISSUE_WEIGHTS.

// Counted, at the detector's own weight. ai-placeholder and formatting (more than 3 bold phrases) were more common
// on AI drafts than on same-length human docs across at least two models, and both survive a Holm correction over
// all 250 check-by-length tests, a prompt-clustered bootstrap, leave-one-model-out and a genre-restricted human basis
// (recal/xr/disputes.json, 2026-10-01). The other seven never fired on any of the 39,193 human docs or the 124 drafts;
// synthetic fixtures show each one fires, so they're untested, not dead. They cost nothing measured, so they stay.
export const COUNTED = {
  'ai-placeholder': 10, formatting: 3,
  'ai-citation-markup': 15, 'ai-utm-source': 12, 'cutoff-disclaimer': 10, 'future-narrative': 12,
  'novelty-inflation': 3, 'reasoning-artifact': 6, 'tier3-phrase-cluster': 12,
};
export const CHATBOT_HUMAN_CLOSERS = /\b(?:i\s+hope\s+this\s+helps|feel\s+free\s+to\s+reach\s+out|let\s+me\s+know\s+if\s+you\s+need\s+anything)\b/i;

// Not counted. Reason codes: NOISE = fires on human docs at least as often as on AI drafts of the same length, or
// too often on humans to be worth the evidence; STYLE = a writing rule (a person's or a style guide's), not a sign of AI;
// LINT = weight 0 upstream anyway.
export const NOT_COUNTED = {
  tier1: 'NOISE', transition: 'NOISE', filler: 'NOISE', 'lets-construction': 'NOISE', 'acknowledgment-loop': 'NOISE',
  'vague-attribution': 'NOISE', 'hollow-intensifier': 'NOISE', 'confidence-calibration': 'NOISE', uniformity: 'NOISE',
  'bullet-np-list': 'NOISE', 'hedge-stack': 'NOISE', 'real-actual-inflation': 'NOISE', 'title-case-header': 'NOISE',
  'parenthetical-hedge': 'NOISE', 'smart-punct-signature': 'NOISE', 'punct-distribution': 'NOISE',
  'fnword-trigram-entropy': 'NOISE', 'cross-para-burstiness': 'NOISE', 'low-ttr': 'NOISE',
  'hashtag-stuff': 'NOISE', // a narrower form (6+ tags in the last 280 characters) is proposed in CLASSIFY.md, not built
  'tier1-clarity': 'STYLE', 'em-dash': 'STYLE', 'unnecessary-hyphenation': 'LINT',
  // UNTESTED = no fresh-AI hit (or, for performed-insight, 3 drafts that fail a Holm correction and leave-one-model-out)
  // but at least one human hit. A cross-vendor review (a model from another lab) and the data agree: removing all of them changes no
  // reject on either sample and raises held-out long-band AUC by 0.014 (recal/xr/disputes.json).
  'performed-insight': 'UNTESTED', chatbot: 'UNTESTED', tier2: 'UNTESTED', tier3: 'UNTESTED', 'tier3-phrase': 'UNTESTED',
  'generic-conclusion': 'UNTESTED', 'template-phrase': 'UNTESTED', 'normalization-flag': 'UNTESTED', sycophantic: 'UNTESTED',
  'significance-inflation': 'UNTESTED', 'rhetorical-question': 'UNTESTED', 'social-cta-closer': 'UNTESTED',
  'negation-chain': 'UNTESTED', 'lingering-attention': 'UNTESTED', 'speculative-opener': 'UNTESTED',
  'emotional-flatline': 'UNTESTED', 'false-concession': 'UNTESTED', 'dev-blog-boilerplate': 'UNTESTED',
  'formulaic-opener': 'UNTESTED',
};

// Same arithmetic as patterns.js (sum of category weights over the deduped issues, divided by
// max(1, log2(words / 50)), capped at 100), restricted to COUNTED. 0 whenever the detector scored 0.
export function evidenceScore(r) {
  if (!r || !r.score) return 0;
  let S = 0;
  for (const i of r.issues || []) {
    if (!(i.type in COUNTED)) continue;
    if (i.type === 'chatbot' && CHATBOT_HUMAN_CLOSERS.test(i.text || '')) continue;
    S += COUNTED[i.type];
  }
  const lf = Math.max(1, Math.log2((r.stats?.wordCount || 0) / 50));
  return Math.min(100, Math.round(S / lf));
}
