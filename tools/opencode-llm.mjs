#!/usr/bin/env node
// opencode-llm.mjs: send one prompt to a model through the opencode CLI and return its reply. prose-gate.mjs uses it
// as the judge backend, one call per juror.
//
// It runs `opencode run <prompt> -m <model> --pure`. --pure turns off opencode's plugins and MCP tools: the judge
// needs no tools, and a session's tool list can make a provider reject the call. The CLI is OPENCODE_BIN, else
// `opencode` on PATH. Model ids use opencode's provider/model form.
//
// DATA NOTE: the prompt goes to that model's provider. Send only text you are allowed to send there.
// Usage:  import { llm } from './opencode-llm.mjs';  await llm(prompt, { model: 'anthropic/claude-sonnet-4-5', max })
//         node opencode-llm.mjs "prompt" --model anthropic/claude-sonnet-4-5

import { execFile } from 'node:child_process';

const OPENCODE = process.env.OPENCODE_BIN || 'opencode';
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

// Async on purpose (2026-09-30): the old execFileSync blocked the event loop, so prose-gate's
// Promise.all ran its judges one after another. A slow juror plus one retry each could take ~600s,
// past the 400s wrappers that call the gate, which then printed nothing at all. execFile lets the
// judges overlap; the timeout kills the child so a stuck call can't hang the gate.
export async function llm(prompt, opts = {}) {
  const model = opts.model || 'anthropic/claude-sonnet-4-5';
  const args = ['run', prompt, '-m', model, '--pure'];
  const out = await new Promise((resolve, reject) => {
    // execFileSync closed the child's stdin for us; async execFile leaves it open and opencode run
    // waits on it forever, so close it explicitly (child.stdin.end() below).
    const child = execFile(OPENCODE, args, {
      encoding: 'utf8', timeout: opts.timeout || 150000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    }, (err, stdout) => {
      if (err) return reject(err.killed ? new Error(`${model} timed out after ${opts.timeout || 150000}ms`) : err);
      resolve(stdout);
    });
    child.stdin?.end();
  });
  // default format: a "> build · <model>" header line, then the model's response. Strip ANSI + header.
  return stripAnsi(out).split('\n').filter((l) => !/^\s*>\s*build\s*[·.]/.test(l)).join('\n').trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2); const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--model') flags.model = argv[++i]; else if (argv[i] === '--max') flags.max = +argv[++i]; else rest.push(argv[i]); }
  llm(rest.join(' ') || 'Reply with exactly the two letters: OK', flags).then((x) => console.log(x)).catch((e) => { console.error(String(e)); process.exit(1); });
}
