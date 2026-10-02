#!/usr/bin/env node
/**
 * mcp-classify.test.mjs — regression for the fail-closed MCP classifier (adversarial-review fix).
 * The old verb-allowlist classified push_files/fork/add_comment/reply/edit as benign network.read,
 * slipping the external.mutate gate. This guards the fix. Exit 1 on any failure.
 */
import { classifyMcp, classifyOp } from './mcp-classify.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const is = (tool, expect) => ok(classifyMcp(tool) === expect, `${tool} -> ${expect} (got ${classifyMcp(tool)})`);

// the exact tools the old allowlist MISSED — must now be external.mutate
for (const t of ['mcp__github__push_files', 'mcp__github__fork_repository', 'mcp__github__add_issue_comment',
  'mcp__telegram__reply', 'mcp__telegram__edit_message', 'mcp__telegram__react',
  'mcp__workspace__send_gmail_message', 'mcp__workspace__upload_image', 'mcp__slack__slack_schedule_message',
  'mcp__editor__find_and_replace_in_files', 'mcp__github__assign_copilot_to_issue'])
  is(t, 'external.mutate');

// verbs the old allowlist DID catch — still external.mutate
for (const t of ['mcp__crm__update_account', 'mcp__github__create_branch', 'mcp__github__merge_pull_request', 'mcp__github__delete_file'])
  is(t, 'external.mutate');

// genuine reads — network.read (read verb anywhere, no mutate verb)
for (const t of ['mcp__github__get_file_contents', 'mcp__github__search_repositories', 'mcp__github__list_commits',
  'mcp__crm__query_records', 'mcp__workspace__read_sheet_values', 'mcp__crm__list_accounts'])
  is(t, 'network.read');

// noun-only reads with NO read verb (server_health, account_assets) over-gate to external.mutate — the
// documented fail-closed tradeoff: over-gating a read is safe; under-gating a mutation is the hole.
is('mcp__crm__server_health', 'external.mutate');

// mixed op (read verb + mutate verb) -> mutate wins (fail-closed)
is('mcp__x__get_and_delete_record', 'external.mutate');
is('mcp__x__search_and_replace', 'external.mutate');

// unknown / noun-only -> fail-closed external.mutate (safe over-gate, never under-gate)
is('mcp__x__frobnicate', 'external.mutate');
is('mcp__crm__account_assets', 'external.mutate'); // noun-only read has no read VERB -> over-gated, safe

// token-exact (not substring): 'asset' must NOT match 'set', 'credit' must NOT match 'edit'
ok(classifyMcp('mcp__x__list_assets') === 'network.read', "'assets' is not the mutate verb 'set' (list_assets -> read)");

// single-underscore display form (mcp_server_op) classifies IDENTICALLY (conformance)
ok(classifyMcp('mcp_github_push_files') === 'external.mutate', 'single-underscore form: push_files -> external.mutate (parity)');
ok(classifyMcp('mcp_github_get_file_contents') === 'network.read', 'single-underscore form: get_file_contents -> network.read (parity)');

// REGRESSION (adversarial review) (A): a mutate verb before an EMBEDDED __ must NOT be dropped by .pop().
// Old code kept only the last segment (view_record/get_status/list_keys) → network.read; now slice(2)
// keeps the whole op, so the leading mutate verb still forces external.mutate.
is('mcp__server__delete__view_record', 'external.mutate');
is('mcp__server__send__get_status', 'external.mutate');
is('mcp__server__remove__list_keys', 'external.mutate');

// REGRESSION (adversarial review) (B): classifyOp is the SOUND entry point — classifies an already-isolated
// op (the adapter supplies it from the host's structured server/tool pair, never a lossy string guess).
ok(classifyOp('flush') === 'external.mutate', 'classifyOp: flush -> external.mutate (destructive lexicon)');
ok(classifyOp('update_account') === 'external.mutate', 'classifyOp: update -> external.mutate');
ok(classifyOp('get_file_contents') === 'network.read', 'classifyOp: get_file_contents -> network.read');
ok(classifyOp('') === 'external.mutate', 'classifyOp: empty op -> fail-closed external.mutate');

// REGRESSION (adversarial review) (fuzzer): a destructive verb co-occurring with a READ verb must
// NOT let the read branch rescue it to network.read. drop/truncate/flush/wipe/... are now recognized mutations.
ok(classifyOp('drop_view_record') === 'external.mutate', "co-occurrence: 'drop'+'view' -> external.mutate (read branch cannot rescue a destructive verb)");
ok(classifyOp('flush_get_status') === 'external.mutate', "co-occurrence: 'flush'+'get' -> external.mutate");
ok(classifyOp('truncate_list_keys') === 'external.mutate', "co-occurrence: 'truncate'+'list' -> external.mutate");
is('mcp__db__drop__view_record', 'external.mutate'); // embedded-__ + destructive verb, full path

// REGRESSION (adversarial review) (negation/removal family — was token-exact, missed de-/un-/dis- inverses):
ok(classifyOp('deregister_device') === 'external.mutate', 'deregister → external.mutate (negation family)');
ok(classifyOp('unlink_get_account') === 'external.mutate', "co-occurrence: 'unlink'+'get' → external.mutate");
ok(classifyOp('unpublish') === 'external.mutate', 'unpublish → external.mutate');
ok(classifyOp('unassign_list') === 'external.mutate', "co-occurrence: 'unassign'+'list' → external.mutate");
ok(classifyOp('expire_token') === 'external.mutate', 'expire → external.mutate (destructive verb)');
ok(classifyOp('list_registers') === 'network.read', "'registers' is a noun, NOT a negation verb (list_registers → read, no over-gate)");

// REGRESSION (adversarial review) (annotation path — the SOUND fix for the name-heuristic residual):
ok(classifyOp('frobnicate_get', { readOnlyHint: true }) === 'network.read', 'an unknown op with readOnlyHint:true → read (annotation is authoritative for the residual)');
ok(classifyOp('frobnicate', { destructiveHint: true }) === 'external.mutate', 'an unknown op with destructiveHint:true → mutate');
ok(classifyOp('delete_record', { readOnlyHint: true }) === 'external.mutate', 'a lying readOnlyHint CANNOT launder a name-recognized delete → still external.mutate (defense in depth)');
ok(classifyMcp('mcp__srv__frobnicate', { readOnlyHint: true }) === 'network.read', 'classifyMcp forwards annotations to classifyOp');

console.log(`mcp-classify.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
