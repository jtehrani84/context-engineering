#!/usr/bin/env node
/**
 * mcp-classify.mjs — shared, FAIL-CLOSED MCP tool classifier (adversarial-review fix).
 *
 * The old classifier used a mutation-VERB allowlist: any MCP tool not matching create|update|delete|...
 * fell through to network.read. That is unsound — push_files, fork_repository, add_issue_comment, react,
 * edit_message clearly mutate/send yet match no verb, so they classified as a benign read and slipped
 * the external.mutate gate (the case-study class of miss: an outbound action read as harmless).
 *
 * Fix — fail closed, on TOKENS not substrings:
 *   1. any token is a mutation verb           -> external.mutate  (mixed ops like find_and_replace too)
 *   2. else any token is a read verb          -> network.read
 *   3. else                                   -> external.mutate  (unclassifiable external tool is
 *                                                 treated as potentially mutating — least authority)
 * Tradeoff (documented, safe direction): a noun-only read (e.g. account_assets) has no read VERB, so it
 * over-classifies to external.mutate. Over-gating a read is safe; under-gating a mutation is the hole.
 * Every host adapter should import this, so each host classifies a tool the same way (cross-host conformance).
 *
 * Two adversarial fixes folded in:
 *   A. mcpOperation kept only the LAST `__` segment (`.pop()`), so a mutate verb before an embedded `__`
 *      (`mcp__server__delete__view_record`) was dropped → misclassified network.read. Now keep every op
 *      segment after the server (`slice(2)`), so a leading mutate verb still forces external.mutate.
 *   B. The single-`_` display form some hosts use (`mcp_server_op`) loses the server/op boundary: a multi-token
 *      server whose token is a READ verb leaked into the op and rescued an unlisted-mutate op into
 *      network.read (under-gate). The SOUND path is `classifyOp(op)` — the adapter isolates the true op
 *      from the host's structured (server, tool) pair and classifies THAT, never a lossy string guess.
 */
// The destructive lexicon (drop/truncate/flush/wipe/destroy/kill/terminate/clear/drain/reset) was added
// after the fuzzer found a real co-occurrence under-gate: `drop_view_record` hit the
// read verb `view` and classified network.read because `drop` was NOT a recognized mutate verb. Listing
// these known-destructive verbs closes it (the read branch can no longer rescue a destructive op). Truly
// unknown verbs still fail closed to external.mutate.
const MUTATE = new Set(['create', 'update', 'delete', 'remove', 'send', 'write', 'upsert', 'post', 'merge', 'deploy', 'execute', 'push', 'fork', 'add', 'insert', 'upload', 'reply', 'edit', 'react', 'assign', 'invite', 'schedule', 'move', 'rename', 'clone', 'import', 'replace', 'append', 'modify', 'manage', 'draft', 'copy', 'batch', 'set', 'abort', 'link', 'approve', 'mutate', 'submit', 'activate', 'deactivate', 'enable', 'disable', 'revoke', 'grant', 'override', 'archive', 'purge', 'restore', 'publish', 'cancel', 'register', 'trigger', 'install', 'format', 'drop', 'truncate', 'flush', 'wipe', 'destroy', 'kill', 'terminate', 'clear', 'drain', 'reset', 'expire', 'rotate', 'evict', 'invalidate', 'detach', 'disconnect', 'decommission', 'deprovision']);
const READ = new Set(['get', 'list', 'search', 'read', 'query', 'fetch', 'describe', 'lookup', 'view', 'stats', 'status', 'resolve', 'count', 'preview', 'inspect', 'download', 'export', 'thumbnail', 'poll', 'analyze', 'find', 'check']);

// generative negation/removal family (adversarial-review fix): de-/un-/dis- prefixed inverse ops are
// mutations even though the base verb (register/link/publish/assign/subscribe/...) is not itself in MUTATE.
// A token-exact set can't keep up with these, so match them by pattern.
const NEGATION_MUTATE = /^(de|dis|un)(register|link|publish|assign|subscribe|activate|authorize|authorise|provision|associate|attach|enroll|enrol|allow|approve)s?$/;

// classify a KNOWN operation string (server already isolated by the caller) — the SOUND entry point.
// AUTHORITATIVE: if MCP tool annotations are supplied (the spec's readOnlyHint / destructiveHint), they
// decide — this is the real fix for the name-heuristic residual below. Otherwise fall back to the name
// heuristic: a mutate/negation verb wins; else a read verb; else fail-closed to external.mutate.
//
// DISCLOSED RESIDUAL (honest scope): the name heuristic is NOT sound for an UNRECOGNIZED mutating verb
// that co-occurs with a recognized READ verb (e.g. a hostile `frobnicate_get`) — the read branch would
// classify it network.read. The fail-closed default only catches ops with NO recognized read verb. The
// annotation path closes this authoritatively; a hostile server that also lies in its annotations is a
// broader trust problem than name classification can solve.
export function classifyOp(op, annotations = null) {
  const tokens = String(op || '').toLowerCase().split(/[_.-]+/).filter(Boolean);
  const nameMutates = tokens.some(t => MUTATE.has(t) || NEGATION_MUTATE.test(t));
  const nameReads = tokens.some(t => READ.has(t));
  const ann = annotations && typeof annotations === 'object' ? annotations : null;
  // ANY mutation signal — name OR annotation — forces mutate (a lying readOnlyHint cannot launder a
  // name-recognized destructive op like delete_x; defense in depth over trusting the annotation alone).
  if (nameMutates || (ann && (ann.destructiveHint === true || ann.readOnlyHint === false))) return 'external.mutate';
  // read ONLY on a positive read signal (a read verb, or an explicit readOnlyHint) with nothing mutating.
  if (nameReads || (ann && ann.readOnlyHint === true)) return 'network.read';
  return 'external.mutate'; // fail-closed for a truly unrecognized op
}

export function mcpOperation(toolName) {
  const t = String(toolName || '');
  if (t.includes('__')) return t.split('__').slice(2).join('_');                 // canonical mcp__server__op(+__op2): keep ALL op segments (fix A — .pop() dropped a leading mutate verb)
  return t.replace(/^mcp[._]/i, '').split(/[._]/).slice(1).join('_') || t;       // flattened mcp_server_op — best-effort, SOUND only for single-token servers (fix B: adapter should use classifyOp)
}

export function classifyMcp(toolName, annotations = null) {
  return classifyOp(mcpOperation(toolName), annotations);
}
