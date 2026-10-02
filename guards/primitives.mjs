#!/usr/bin/env node
/**
 * primitives.mjs — the shared failure-class detectors.
 *
 * Gate by failure class, not by capability. Each detector is a pure function returning
 * { ok, reason }: it FIRES (ok:false) on the seeded incident and stays SILENT (ok:true) on the good
 * case. The tokenize half of the `leak` class lives in broker.mjs; this module holds the rest.
 *
 * These are the detection cores; wiring them onto canonical events (recorder) + real data is
 * adapter work. Invariant-class failures stop + quarantine; only calibrated quality gates warn.
 */

// silent-empty: a zero-result / dead-lane / dropped-auth path that a green status would hide.
// Fires on 0 rows, a stale heartbeat, a failed semantic canary, or volume outside the expected band.
export function silentEmpty(signal, band = {}) {
  const { rows, heartbeatAgeSec = 0, canaryPassed = true } = signal;
  if (typeof rows !== 'number') return { ok: false, reason: 'no row count reported (cannot prove non-empty)' };
  if (rows === 0) return { ok: false, reason: 'silent-empty: 0 rows where output was expected' };
  if (!canaryPassed) return { ok: false, reason: 'semantic canary failed (lane producing wrong-shape output)' };
  if (band.maxAgeSec != null && heartbeatAgeSec > band.maxAgeSec) return { ok: false, reason: `stale heartbeat (${heartbeatAgeSec}s > ${band.maxAgeSec}s)` };
  if (band.min != null && rows < band.min) return { ok: false, reason: `volume ${rows} below band min ${band.min}` };
  if (band.max != null && rows > band.max) return { ok: false, reason: `volume ${rows} above band max ${band.max}` };
  return { ok: true };
}

// drift: a count must be GENERATED, not hand-typed. A claimed count that != the generated count fires.
export function drift(generatedCount, claimedCount) {
  if (generatedCount !== claimedCount) return { ok: false, reason: `drift: claimed ${claimedCount} != generated ${generatedCount}` };
  return { ok: true };
}

// ungrounded: a fluent claim with no source, or a cited source that doesn't actually support it.
// sources: { id: contentString }. A claim must cite ≥1 source AND a cited source must contain support.
export function ungrounded(claim, sources = {}) {
  const cited = claim.sourceIds || [];
  if (!cited.length) return { ok: false, reason: `ungrounded: claim "${claim.text}" cites no source` };
  const supportToken = (claim.support || claim.text).toLowerCase();
  const proven = cited.some(id => (sources[id] || '').toLowerCase().includes(supportToken));
  if (!proven) return { ok: false, reason: `ungrounded: no cited source actually contains support for "${claim.text}" (proof-of-retrieval failed)` };
  return { ok: true };
}

// execution: code that doesn't compile/test/deploy, or a test with no assertions.
export function execution(result) {
  const { compiled = false, testsPass = false, assertionDensity = 0 } = result;
  if (!compiled) return { ok: false, reason: 'execution: does not compile/build' };
  if (!testsPass) return { ok: false, reason: 'execution: tests fail' };
  if (assertionDensity <= 0) return { ok: false, reason: 'execution: test has no assertions (vacuous green)' };
  return { ok: true };
}

// model-substitution: observed provider/model/effort must match what was requested/locked.
export function modelSubstitution(requested, observed) {
  for (const k of ['provider', 'model', 'effort']) {
    if (requested[k] != null && observed[k] !== requested[k]) return { ok: false, reason: `model-substitution: ${k} requested ${requested[k]} but observed ${observed[k]}` };
  }
  return { ok: true };
}

// leak/injection — injection half (the tokenize half is broker.mjs): hostile SOURCE content must be
// extracted as DATA and can never authorize an action. Returns the extracted data + a count of
// injection attempts that were neutralized (treated as data). extractFromSource authorizes NOTHING by
// construction (the safe data path); authority can only appear from an OBSERVED agent response.
const INJECTION_PATTERNS = [/ignore (all |previous )?instructions/i, /disregard (the )?(system|above)/i, /\brun\b.*\b(command|shell|script)\b/i, /\bgrant\b.*\b(access|permission|admin)\b/i, /\bapprove\b/i, /\bexfiltrat/i, /system prompt/i];
// OBEDIENCE signatures: an injected imperative in the SOURCE + evidence the agent RESPONSE acted on it.
// This is what makes injection() non-vacuous (adversarial-review fix): the verdict now depends on
// agent BEHAVIOR, not merely a regex hit on the source. In production the `obeyed` signal is the agent's
// actual tool-requests derived from the source; here it is modeled from the agent's response text.
const OBEDIENCE = [
  // exfil imperative → response shows an egress target OR a send act (URL, email, or a Slack-thread reply —
  // the case study's step-3 channel; adversarial-review fix: obeyed was URL-only, missing email/Slack).
  { attempt: /\bexfiltrat|email .*(deal|amount|account)|send .*(to (the )?(address|email|thread))/i, obeyed: /(https?:)?\/\/[^\s"'<>]+|\b(sent|emailed|forwarded|replied|posted)\b|\bmessage sent\b|@[\w.-]+\.[a-z]{2,}/i },
  { attempt: /\bapprove\b|\bgrant\b.*\b(access|permission|admin)\b/i, obeyed: /\bapprov|\bgranted\b/i }, // approve/grant imperative → response approves/grants
];
export function extractFromSource(sourceContent, schemaFields = []) {
  const text = String(sourceContent);
  const injectionAttempts = INJECTION_PATTERNS.filter(re => re.test(text)).length;
  // extract only declared schema fields as DATA; NEVER interpret content as an instruction
  const extracted = {};
  for (const f of schemaFields) extracted[f] = text.length; // placeholder extraction (as data, not executed)
  return { extractedData: extracted, injectionAttempts, authorizedActions: 0 }; // authorizedActions is always 0 by construction
}
export function injection(sourceContent, schemaFields = [], agentResponse = '') {
  const text = String(sourceContent), resp = String(agentResponse);
  const injectionAttempts = INJECTION_PATTERNS.filter(re => re.test(text)).length;
  // authorizedActions: injected imperatives the agent RESPONSE actually acted on (obedience). A source
  // that merely CONTAINS an injection attempt but is treated as data (response does not obey) stays ok.
  const authorizedActions = OBEDIENCE.filter(c => c.attempt.test(text) && c.obeyed.test(resp)).length;
  if (authorizedActions > 0) return { ok: false, reason: `injection: agent obeyed ${authorizedActions} injected imperative(s) from source content`, injectionAttemptsNeutralized: injectionAttempts, authorizedActions };
  return { ok: true, injectionAttemptsNeutralized: injectionAttempts, authorizedActions: 0 };
}

// event-wired injection signal. Rather
// than parse response TEXT, this reads the run's CANONICAL EVENTS: if the source carried an injected
// imperative AND the run AUTHORIZED an outbound/sensitive action, the injection reached the tool layer.
// It is a DETECTOR (a signal for review), complementary to injection() (which catches the output arm) —
// enforcement is the least-authority + human-send gate. authorizedActionClasses = the actionClass of
// every action.authorized event in the run's main chain.
// outbound/sensitive action classes a poisoned source could ride (adversarial-review fix: added
// process.exec / agent.spawn / fs.write.protected — a poisoned source causing a shell exec, a subagent
// spawn, or a protected write is obedience reaching a sensitive action, not just external.mutate/cred.read).
const OUTBOUND_SENSITIVE = new Set(['external.mutate', 'credential.read', 'process.exec', 'agent.spawn', 'fs.write.protected']);
export function injectionFromEvents(sourceContent, authorizedActionClasses = []) {
  const text = String(sourceContent);
  const hasImperative = INJECTION_PATTERNS.some(re => re.test(text));
  const obeyedActions = hasImperative ? authorizedActionClasses.filter(c => OUTBOUND_SENSITIVE.has(c)) : [];
  if (obeyedActions.length > 0) return { ok: false, reason: `injection(events): a poisoned source coincided with ${obeyedActions.length} authorized outbound/sensitive action(s) [${obeyedActions.join(',')}] — the injection reached the tool layer; review whether the source drove it`, obeyedActions };
  return { ok: true, obeyedActions: [] };
}
