// voice-overlay.skeleton.mjs — the CALIBRATION layer of the voice system (pristine template).
//
// The kit ships an ACTIVE copy of this at `voice-overlay.mjs` (empty → engine runs generic-only).
// To calibrate: edit `voice-overlay.mjs` (or re-copy this file over it to reset). See VOICE-ONBOARDING.md.
// This layer is the ONLY part that carries a person's voice, so it's the only part that ships blank.
//
// Interface contract (aiscore.mjs imports these — keep the names + shapes):
//   scanVoice(text)        -> [ {type, text, fix?} ]   issue objects; empty array until calibrated
//   hardBanCount(issues)   -> int                        counts word/phrase/struct hits in that array
//   cadenceCount(issues)   -> int                        counts cadence hits in that array
//   CALIBRATED             -> boolean                    the fuse + engine read this; true only when real

// ── YOUR calibration (all empty until you onboard) ──────────────────────────────────────────────
export const TEAM_WORDS = [];       // words YOU overuse that read as AI when stacked — your personal tells
export const TEAM_PHRASES = [];     // openers/phrases you would never actually write
export const TEAM_STRUCTURES = [];  // [{ id, kind:'hardban'|'cadence', test:(text)=>[matched strings] }]
export const EXEMPTIONS = [];       // exact phrases to NEVER flag: a signature line you DO use; a verbatim quote

// ── engine interface (works empty; grows as you fill the arrays above) ───────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function scanVoice(text = '') {
  const issues = [];
  for (const w of TEAM_WORDS) {
    const m = text.match(new RegExp(`\\b${esc(w)}\\b`, 'gi'));
    if (m) issues.push({ type: `word:${w}`, text: m[0], fix: `overused — vary or cut "${w}"` });
  }
  for (const p of TEAM_PHRASES) if (text.toLowerCase().includes(p.toLowerCase())) issues.push({ type: 'phrase', text: p, fix: `rephrase — you would not write "${p}"` });
  for (const s of TEAM_STRUCTURES) {
    try { for (const h of (s.test(text) || [])) issues.push({ type: `${s.kind === 'cadence' ? 'cadence' : 'struct'}:${s.id}`, text: String(h).slice(0, 80) }); } catch {}
  }
  return issues.filter(i => !EXEMPTIONS.some(e => text.includes(e) && e.includes(i.text)));
}
export const hardBanCount = (issues = []) => issues.filter(i => i.type.startsWith('word:') || i.type === 'phrase' || i.type.startsWith('struct:')).length;
export const cadenceCount = (issues = []) => issues.filter(i => i.type.startsWith('cadence:')).length;
export const CALIBRATED = (TEAM_WORDS.length + TEAM_PHRASES.length + TEAM_STRUCTURES.length) > 0;
