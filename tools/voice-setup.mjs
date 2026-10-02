#!/usr/bin/env node
// voice-setup.mjs — the SETUP FUSE for the voice system.
//
// The problem it prevents: a user runs the guard, gets a clean score, and trusts it to mean "this
// sounds like me" — when the overlay is empty and the eval corpus is still the shipped generic seed.
// A clean GENERIC score says nothing about a specific person's voice, and text detection can't
// separate a person from a deliberate imitator who adapts. So the fuse fails
// CLOSED: until you calibrate, it forces every voice verdict to be labeled "generic-only, NOT you."
//
// It reads two things and reports a calibration STATE:
//   • the overlay  (tools/voice-overlay.mjs — copied+filled from voice-overlay.skeleton.mjs)
//   • the corpus   (harness-evolution/corpus.json — how many of YOUR OWN samples, beyond the seed)
//
// Usage:
//   node voice-setup.mjs            # human status + the next onboarding step
//   node voice-setup.mjs --check    # machine: prints STATE, exit 0 if CALIBRATED else 1 (for hooks/gates)
//   node voice-setup.mjs --label    # prints the one-line label the engine appends to any clean score
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const OVERLAY = join(HERE, 'voice-overlay.mjs');
const CORPUS = join(KIT, 'harness-evolution', 'corpus.json');
const MIN_OWN_SAMPLES = 20;   // below this the eval baseline is not trustworthy for YOUR voice

async function overlayState() {
  if (!existsSync(OVERLAY)) return { present: false, calibrated: false, terms: 0 };
  try {
    const m = await import(OVERLAY + `?t=${Date.now() % 1e6}`);
    const terms = (m.TEAM_WORDS?.length || 0) + (m.TEAM_PHRASES?.length || 0) + (m.TEAM_STRUCTURES?.length || 0);
    return { present: true, calibrated: !!m.CALIBRATED && terms > 0, terms };
  } catch (e) { return { present: true, calibrated: false, terms: 0, err: String(e).slice(0, 80) }; }
}
function corpusState() {
  if (!existsSync(CORPUS)) return { present: false, own: 0 };
  try {
    const j = JSON.parse(readFileSync(CORPUS, 'utf8'));
    const rows = j.samples || j.items || j || [];
    // a sample counts as "yours" only if explicitly marked (origin:'self' / seed:false) — the shipped
    // seed is marked seed:true, so it never inflates your calibration.
    const own = (Array.isArray(rows) ? rows : []).filter(r => r && (r.origin === 'self' || r.seed === false)).length;
    return { present: true, own };
  } catch { return { present: true, own: 0 }; }
}

const ov = await overlayState();
const co = corpusState();
const STATE = (!ov.calibrated) ? 'UNCALIBRATED' : (co.own < MIN_OWN_SAMPLES ? 'PARTIAL' : 'CALIBRATED');
const LABEL = {
  UNCALIBRATED: '⚠ voice guard is GENERIC-ONLY, NOT calibrated to you — a clean score does not mean it sounds like you. Run onboarding (VOICE-ONBOARDING.md).',
  PARTIAL: '◐ overlay calibrated, but the eval corpus has too few of your own samples to trust the baseline — keep adding your writing.',
  CALIBRATED: '✓ voice guard calibrated to you (overlay + corpus). Still can\'t beat an adaptive impersonator — that\'s provenance, not detection.',
}[STATE];

const args = process.argv.slice(2);
if (args.includes('--label')) { console.log(LABEL); process.exit(0); }
if (args.includes('--check')) { console.log(STATE); process.exit(STATE === 'CALIBRATED' ? 0 : 1); }

console.log(`\nvoice system — calibration fuse`);
console.log(`  overlay : ${ov.present ? (ov.calibrated ? `calibrated (${ov.terms} terms)` : 'present but EMPTY') : 'not created yet (copy voice-overlay.skeleton.mjs → voice-overlay.mjs)'}`);
console.log(`  corpus  : ${co.present ? `${co.own} of your own samples (need ${MIN_OWN_SAMPLES}+)` : 'no corpus.json yet'}`);
console.log(`  STATE   : ${STATE}`);
console.log(`  ${LABEL}`);
console.log(`\n  next step:`);
if (STATE === 'UNCALIBRATED') console.log(`    → open VOICE-ONBOARDING.md, step 1: collect 20-40 samples of your OWN writing, then fill voice-overlay.mjs.`);
else if (STATE === 'PARTIAL') console.log(`    → add more of your own samples to harness-evolution/corpus.json (origin:'self'), then: node harness-evolution/harness-eval.mjs --save baseline.json`);
else console.log(`    → you're calibrated. Re-run onboarding whenever your writing drifts; grow the held-out split over time.`);
console.log('');
