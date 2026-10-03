// hook.mjs: read the hook wiring from Claude Code settings, test matchers the way Claude Code tests them, and run
// the voice hook on a synthetic tool call.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, basename } from 'node:path';
import { childEnv } from './local-only.mjs';

export const HOOK_NAME = 'voice-tell-gate.py';
// The draft gate: a Stop hook next to the send hook that checks drafts Claude shows in chat (hook/voice-draft-gate.py).
export const DRAFT_HOOK_NAME = 'voice-draft-gate.py';

// A path as one shell word: a plain path stays as it is (a leading ~ still expands), anything else is double-quoted,
// with a leading ~/ written as $HOME so it still expands inside the quotes.
export function shellPath(p) {
  if (/^[A-Za-z0-9_\/.~+@%=:,-]+$/.test(p)) return p;
  const q = (s) => s.replace(/[\\"$`]/g, '\\$&');
  return p.startsWith('~/') ? `"$HOME/${q(p.slice(2))}"` : `"${q(p)}"`;
}
// What the user sees when the draft gate's script is missing (review of the hook holes, N3, 2026-10-03).
export const DRAFT_MISSING_NOTE = 'Voice draft gate: draft not checked: the draft gate script is missing where settings.json points; run voice-doctor.mjs';
// The Stop command for the draft gate at `path` (as it should be written: ~/... or absolute). python3 on a missing file
// exits 2, and exit 2 on Stop blocks the stop, so a bare "python3 <gate>" can refuse every reply once the script is gone
// and trap the session (Claude Code 2.1.286 reads that missing-file error as non-blocking; other builds may not). This
// command checks the file first: when it is missing it prints a systemMessage (the user sees the note) and exits 0, so
// the reply ends; otherwise it runs the gate, whose own failures already allow the stop. Plain POSIX sh, no network.
export function draftGateCommand(path) {
  const p = shellPath(path);
  return `[ -f ${p} ] || { echo '${JSON.stringify({ systemMessage: DRAFT_MISSING_NOTE })}'; exit 0; }; python3 ${p}`;
}
// Would this Stop command block the stop if the draft gate's script went missing? Runs the command through /bin/sh, as
// Claude Code does, with the script's file name swapped for one that doesn't exist, and reads the result: exit 2 or a
// "block" decision is the trap (whether a given Claude Code build then blocks is its own call; the guarded command never
// leaves it that call). Returns { traps, code, timedOut }.
export function draftCommandTraps(command, env = process.env) {
  const probe = command.split(DRAFT_HOOK_NAME).join(`voice-doctor-missing-${DRAFT_HOOK_NAME}`);
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'voice-doctor', transcript_path: '/voice-doctor/missing.jsonl', stop_hook_active: false, last_assistant_message: '' });
  const r = spawnSync('/bin/sh', ['-c', probe], { input, encoding: 'utf8', env: pyEnv(env), timeout: 20000, killSignal: 'SIGKILL' });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { traps: !timedOut && (r.status === 2 || /"decision"\s*:\s*"block"/.test(r.stdout || '')), code: r.status, timedOut };
}

// The environment for the hook's python3: the local-only guard for the Node scorer it starts, and no bytecode cache
// written next to the hook (these runs must not leave files behind).
const pyEnv = (env) => ({ ...childEnv(env), PYTHONDONTWRITEBYTECODE: '1' });
export const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit'];

// Claude Code's matcher rule for tool events (read from the Claude Code 2.1.286 bundle on 2026-10-02, function vDe,
// and confirmed with a live probe the same day): an empty matcher or "*" matches every tool; a matcher made only of
// letters, digits, "_", "|", "," "-" and spaces is a LIST of exact tool names; anything else is a regular expression
// tested unanchored against the tool name. So "slack_send_message" never matches "mcp__slack__slack_send_message",
// while ".*slack_send_message" and "^mcp__.+__slack_send_message$" do.
export function matcherMatches(matcher, tool) {
  if (!matcher || matcher === '*') return true;
  if (/^[a-zA-Z0-9_|, -]+$/.test(matcher)) return matcher.split(/[|,]/).map((s) => s.trim()).filter(Boolean).includes(tool);
  try { return new RegExp(matcher).test(tool); } catch { return false; }
}
export const matcherKind = (m) => (!m || m === '*' ? 'all tools' : /^[a-zA-Z0-9_|, -]+$/.test(m) ? 'exact names' : 'regex');

// A concrete tool name for a configured send tool: exact names stay as they are, a suffix gets a probe server prefix.
export const sendToolName = (s, server = 'voice_doctor') => (s.startsWith('mcp__') ? s : `mcp__${server}__${s}`);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The PreToolUse matcher that covers every configured send tool under any MCP server.
export function recommendedSendMatcher(sendTools) {
  const exact = sendTools.filter((s) => s.startsWith('mcp__')).map(esc);
  const suffix = sendTools.filter((s) => !s.startsWith('mcp__')).map(esc);
  const parts = [];
  if (suffix.length) parts.push(`mcp__.+__(?:${suffix.join('|')})`);
  parts.push(...exact);
  return `^(?:${parts.join('|')})$`;
}

// Every hook command entry in the settings files that runs the voice hook:
// [{ file, event, matcher, command, flat }]. A flat entry ({matcher, command} without a hooks list) isn't read by
// Claude Code; it is returned with flat: true so the doctor can say so.
export function voiceHookEntries(settingsFiles, hookName = HOOK_NAME) {
  const out = [], errors = [];
  for (const file of settingsFiles) {
    if (!existsSync(file)) continue;
    let s;
    try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { errors.push(`${file}: not valid JSON (${e.message})`); continue; }
    for (const [event, entries] of Object.entries(s?.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        if (typeof e.command === 'string' && e.command.includes(hookName)) out.push({ file, event, matcher: e.matcher ?? '', command: e.command, flat: true, timeout: e.timeout ?? null });
        for (const h of Array.isArray(e.hooks) ? e.hooks : []) {
          if (h && h.type === 'command' && typeof h.command === 'string' && h.command.includes(hookName)) out.push({ file, event, matcher: e.matcher ?? '', command: h.command, flat: false, timeout: h.timeout ?? null });
        }
      }
    }
  }
  return { entries: out, errors };
}

// The hook script path named in a command string (~ and $HOME expanded with the real home).
export function hookPathFromCommand(command, hookName = HOOK_NAME, home = process.env.HOME || homedir()) {
  const tok = command.match(/(?:"[^"]*"|'[^']*'|\S)+/g) || [];
  const t = tok.map((x) => x.replace(/^["']|["']$/g, '')).find((x) => x.endsWith(hookName));
  if (!t) return null;
  return t.replace(/^~(?=\/)/, home).replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);
}

// Expand ~ and $HOME in a command with the real home, so it still finds the hook when HOME is pointed elsewhere.
export const pinHome = (command, home = process.env.HOME || homedir()) =>
  command.replace(/(^|\s|["'])~(?=\/)/g, `$1${home}`).replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, home);

// Run the hook on one synthetic tool call. With `command`, it runs the wired command through /bin/sh as Claude Code
// does; otherwise `python3 <hookPath>`. Returns { code, stdout, stderr, timedOut, decision, message }.
export function runHook({ command, hookPath, payload, env = process.env, timeout = 90000 }) {
  const argv = command ? ['/bin/sh', ['-c', command]] : ['python3', [hookPath]];
  const r = spawnSync(argv[0], argv[1], { input: JSON.stringify(payload), encoding: 'utf8', env: pyEnv(env), timeout, killSignal: 'SIGKILL' });
  const res = { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT' };
  return { ...res, ...decisionOf(res, payload.hook_event_name) };
}

// pass | deny | context | blocked-exit-2 | other, with the message. Exit 2 blocks a PreToolUse call and shows
// stderr to the model on PostToolUse, so it counts as a deny or a warning.
export function decisionOf({ code, stdout, stderr }, event) {
  const lines = stdout.trim().split('\n').filter((l) => l.trim().startsWith('{'));
  let h = null;
  if (lines.length) { try { const j = JSON.parse(lines[lines.length - 1]); h = j.hookSpecificOutput || j; } catch { /* fall through */ } }
  if (h && (h.permissionDecision === 'deny' || h.decision === 'block')) return { decision: 'deny', message: h.permissionDecisionReason || h.reason || '' };
  if (h && typeof h.additionalContext === 'string') return { decision: 'context', message: h.additionalContext };
  if (code === 2) return { decision: event === 'PreToolUse' ? 'deny' : 'context', message: stderr.trim(), viaExit2: true };
  if (!stdout.trim() && code === 0) return { decision: 'pass', message: '' };
  return { decision: 'other', message: (stdout || stderr).trim().slice(0, 300) };
}

// The flagged items in a hook message, from its bullet lines (a bullet, "[type] text", then an optional dash and fix):
// [{ type, text }].
export function hookBullets(message) {
  const out = [];
  for (const line of String(message || '').split('\n')) {
    const m = line.match(/^\s*[\u2022*-]\s*\[([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    const text = m[2].split(/\s+[\u2014\u2013]\s+|\s+-\s+(?=[A-Za-z])/)[0].trim().replace(/^["\u201C']|["\u201D']$/g, '');
    out.push({ type: m[1].trim(), text });
  }
  return out;
}

export const sendPayload = (text, tool) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { channel_id: 'C0VOICEDOCTOR', text } });
export const writePayload = (text, filePath) => ({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: filePath, content: text }, tool_response: { success: true } });

// Load the hook in Python without running main() and read what it would do: which of `names` its is_send_tool treats
// as sends, the scorer and normalizer paths it resolves in this environment, and whether it honors the VOICE_AISCORE /
// VOICE_NORMALIZE overrides (it is loaded a second time with both set to marker paths). The hook's top level only reads the
// environment and compiles patterns, so loading it is safe. Returns { ok, isSend, aiscore, normalizer, proseExt,
// honorsAiscoreEnv, honorsNormalizeEnv } or { ok: false, error }.
export function hookIntrospect(hookPath, names = [], env = process.env) {
  const py = [
    'import importlib.util, json, os, sys',
    'sys.dont_write_bytecode = True',
    'def load(tag):',
    '    spec = importlib.util.spec_from_file_location("voice_hook_" + tag, sys.argv[1])',
    '    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m',
    'a = load("plain")',
    'f = getattr(a, "is_send_tool", None)',
    'os.environ["VOICE_AISCORE"] = "/voice-doctor/marker/aiscore.mjs"; os.environ["VOICE_NORMALIZE"] = "/voice-doctor/marker/text-normalize.mjs"',
    'b = load("env")',
    'ext = getattr(a, "PROSE_EXT", None)',
    'print(json.dumps({"isSend": None if f is None else [bool(f(n)) for n in json.loads(sys.argv[2])],',
    '  "aiscore": getattr(a, "AISCORE", None), "normalizer": getattr(a, "NORMALIZER", None),',
    '  "proseExt": list(ext) if isinstance(ext, (tuple, list)) else None,',
    '  "honorsAiscoreEnv": getattr(b, "AISCORE", None) == "/voice-doctor/marker/aiscore.mjs",',
    '  "honorsNormalizeEnv": getattr(b, "NORMALIZER", None) == "/voice-doctor/marker/text-normalize.mjs"}))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', py, hookPath, JSON.stringify(names)], { encoding: 'utf8', timeout: 30000, env: pyEnv(env) });
  if (r.error) return { ok: false, error: `python3 didn't run (${r.error.code || r.error.message})` };
  if (r.status !== 0) return { ok: false, error: (r.stderr || '').trim().split('\n').pop()?.slice(0, 160) || `python3 exited ${r.status}` };
  try {
    const v = JSON.parse(r.stdout.trim().split('\n').pop());
    return { ok: true, ...v, aiscore: v.aiscore ? resolve(v.aiscore) : null, normalizer: v.normalizer ? resolve(v.normalizer) : null };
  } catch { return { ok: false, error: 'could not read the result' }; }
}

// Which hook to run: the command the settings wire for PreToolUse (else any wired entry), else config.paths.hook.
// { command, hookPath, exists, entries, errors }
export function resolveHook(config) {
  const { entries, errors } = voiceHookEntries(config.paths.settings, basename(config.paths.hook) || HOOK_NAME);
  const wired = entries.find((e) => e.event === 'PreToolUse' && !e.flat) || entries.find((e) => !e.flat);
  const hookPath = (wired && hookPathFromCommand(wired.command, basename(config.paths.hook) || HOOK_NAME)) || config.paths.hook;
  return { command: wired?.command || null, hookPath, exists: !!hookPath && existsSync(hookPath), entries, errors };
}
