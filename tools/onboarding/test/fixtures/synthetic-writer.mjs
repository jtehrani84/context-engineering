// synthetic-writer.mjs: generated writing samples for the onboarding tests. Every text here is made up by a seeded
// generator; none of it is anyone's real writing.
//
// consistentWriter(n, seed): n samples from one steady style: plain sentences of about 8 to 18 words, contractions,
// no em dashes, no stock AI vocabulary. A held-out share of these should pass every check.
// offVoiceDraft(seed): one long text in a different register (long sentences, em dashes, no contractions).
const SUBJECTS = ['I', 'We', 'The team', 'Dana', 'Our build', 'The night job', 'The vendor', 'Priya', 'The new parser', 'My laptop'];
const OPENERS = ["I think", "Honestly I'd guess", "From what I saw,", "Quick update:", "So", "Turns out", "For what it's worth,", "Heads up,"];
const VERBS = ["didn't finish", "kept failing", "ran fine", "won't start", "finished early", "broke again", "needs a restart", "came back up"];
const WHEN = ['last night', 'this morning', 'on Monday', 'after lunch', 'around six', 'before the review', 'over the weekend', 'during the demo'];
const BECAUSE = ["because the disk filled up", "since nobody renewed the cert", "and I'm not sure why yet", "so we'll rerun it tomorrow",
  "which we've seen before", "and it's on my list", "because the config pointed at the old host", "so I'll check the logs"];
const ASIDES = ["Let me know if that's a problem.", "I'll post the numbers when they're in.", "We're fine for now.", "Not urgent.",
  "That's all I've got.", "I can walk you through it later.", "It's a small fix.", "Ping me if it happens again."];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

function sentence(r) {
  const opener = r() < 0.35 ? `${pick(r, OPENERS)} ` : '';
  const subj = pick(r, SUBJECTS);
  const s = `${opener}${opener ? subj.replace(/^The/, 'the').replace(/^Our/, 'our').replace(/^My/, 'my') : subj} ${pick(r, VERBS)} ${pick(r, WHEN)} ${pick(r, BECAUSE)}.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function consistentWriter(n = 30, seed = 7) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = 6 + Math.floor(r() * 7);
    const lines = [];
    for (let j = 0; j < k; j++) lines.push(r() < 0.18 ? pick(r, ASIDES) : sentence(r));
    lines.push(`Sample ${i + 1} of the steady writer.`);
    out.push(lines.join(' '));
  }
  return out;
}

export function offVoiceDraft() {
  return [
    'The migration of the reconciliation workload to the new scheduling platform represents a significant milestone in our ongoing effort to modernize the operational foundation that supports every downstream reporting process across the organization — and it was completed ahead of the planned window.',
    'Each of the legacy jobs was carefully inventoried, mapped to its owning team, and validated against the historical run records in order to ensure that no dependency would be silently dropped during the transition — a risk that had been raised repeatedly in prior planning sessions.',
    'The resulting configuration provides a consistent and well-documented mechanism for scheduling, monitoring, and recovering every recurring workload — which in turn allows the operations group to respond to failures with considerably greater speed and confidence than was previously possible.',
    'Going forward, the team intends to extend the same approach to the remaining batch processes, and it will publish a detailed summary of the lessons that were learned during this effort so that other groups are able to benefit from the experience — particularly those planning similar migrations.',
  ].join(' ');
}
