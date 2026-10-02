#!/usr/bin/env node
// aiscore — score prose for AI-writing tells. Two layers:
//   1. generic avoid-ai-writing detector (0-100 AI score) — vendored MIT, (c) Conor Bronsdon (see avoid-ai-writing/)
//   2. your voice-law OVERLAY (words/phrases/structures the generic misses) — EMPTY until you calibrate
// 100% local (no network). The overlay lives OUTSIDE the vendored detector so an upstream update
// never clobbers your calibration.
//
// FUSE: until the overlay is calibrated (see VOICE-ONBOARDING.md), a clean score is GENERIC-ONLY and
// says nothing about whether the text sounds like YOU — the output says so, on purpose.
//
// Usage:
//   node tools/aiscore.mjs <file> [--json] [--technical] [--plain] [--no-overlay]
//   echo "text" | node tools/aiscore.mjs - [--json]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { scanVoice, hardBanCount, cadenceCount, CALIBRATED } from './voice-overlay.mjs';
const require = createRequire(import.meta.url);
const D = require('./avoid-ai-writing/detector/patterns.js');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const target = args.find(a => !a.startsWith('--'));
const asJson = flags.has('--json');
const contextMode = flags.has('--technical') ? 'technical' : 'general';
const sourceMode = flags.has('--plain') ? 'plain' : 'rendered-markdown';
const useOverlay = !flags.has('--no-overlay');

const text = (!target || target === '-') ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');

const r = D.analyzeText(text, { contextMode, sourceMode });
const voiceIssues = useOverlay ? scanVoice(text) : [];
const voiceHardBans = hardBanCount(voiceIssues);
const uncalibrated = useOverlay && !CALIBRATED;
const CAL_NOTE = 'GENERIC-ONLY — overlay not calibrated to you; a clean score does NOT mean it sounds like you (see VOICE-ONBOARDING.md)';

if (asJson) {
  const types = {}; for (const i of r.issues) types[i.type] = (types[i.type] || 0) + 1;
  const vTypes = {}; for (const i of voiceIssues) vTypes[i.type] = (vTypes[i.type] || 0) + 1;
  console.log(JSON.stringify({
    file: target || '(stdin)', score: r.score, label: r.label, classification: r.document_classification,
    class_probabilities: r.class_probabilities, confidence: r.confidence_category,
    issueCount: r.issues.length, issueTypes: types,
    voice: { calibrated: !uncalibrated, hardBans: voiceHardBans, cadenceFlags: cadenceCount(voiceIssues), issueTypes: vTypes, issues: voiceIssues },
    calibrationNote: uncalibrated ? CAL_NOTE : undefined,
    wordCount: r.stats?.wordCount,
  }));
  process.exit(0);
}

const bar = '─'.repeat(56);
console.log(bar);
console.log(`  ${target || '(stdin)'}`);
console.log(`  AI score ${r.score}/100   ${r.label}   ${r.document_classification}   conf:${r.confidence_category}`);
if (useOverlay) {
  const verdict = voiceHardBans === 0 ? 'CLEAN' : `${voiceHardBans} hard-ban${voiceHardBans > 1 ? 's' : ''}`;
  const cad = cadenceCount(voiceIssues);
  console.log(`  voice-law: ${verdict}${cad ? `  ·  ${cad} cadence flag${cad > 1 ? 's' : ''}` : ''}`);
  if (uncalibrated) console.log(`  ⚠ ${CAL_NOTE}`);
}
console.log(bar);
if (voiceIssues.length) {
  console.log('  ▸ VOICE-LAW VIOLATIONS (your overlay — fix these first)');
  for (const i of voiceIssues) { console.log(`      [${i.type}] ${i.text}`); if (i.fix) console.log(`         → ${i.fix}`); }
  console.log(bar);
}
if (!r.issues.length) { console.log('  generic AI detector: no tells flagged.'); }
else {
  console.log('  ▸ GENERIC AI TELLS');
  const byType = {}; for (const i of r.issues) (byType[i.type] ||= []).push(i);
  for (const [type, list] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`      ${type} ×${list.length}`);
    for (const i of list.slice(0, 3)) { const q = (i.text || '').replace(/\s+/g, ' ').trim().slice(0, 56); console.log(`          "${q}"${i.text && i.text.length > 56 ? '…' : ''}`); }
    if (list.length > 3) console.log(`          … +${list.length - 3} more`);
  }
}
console.log(bar);
console.log('  signal, not proof — pair with context before acting.');
