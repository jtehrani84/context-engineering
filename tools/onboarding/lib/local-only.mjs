// local-only.mjs: turn off every network entry point Node offers, for tools that read a person's writing samples.
//
// Import it first (profile-build.mjs and calibrate-user.mjs do), or preload it in a child process with
// NODE_OPTIONS=--import=<file URL of this module>; childEnv() below builds that environment. After it runs,
// net, tls, http, https, http2, dns, dgram and fetch throw NetworkRefused instead of connecting, so a bug or a
// stray dependency can't send a sample anywhere. It covers Node code only. A Python child (the send hook) isn't
// covered; the tools only start the hook, which runs the local scorer.
import { syncBuiltinESMExports, createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export class NetworkRefused extends Error {}
export const LOCAL_ONLY_URL = pathToFileURL(fileURLToPath(import.meta.url)).href;

// VOICE_LOCAL_ONLY_LOG (tests only): append each refused call to this file, so a test can tell that nothing even tried.
const LOG = process.env.VOICE_LOCAL_ONLY_LOG || null;
const refuse = (what) => function refused() {
  if (LOG) { try { require('fs').appendFileSync(LOG, `${process.pid} ${what}\n`); } catch { /* the refusal below still happens */ } }
  throw new NetworkRefused(`local-only: ${what} is turned off in this tool, so writing samples can't leave the machine`);
};

const TABLE = {
  net: ['connect', 'createConnection', 'createServer'],
  tls: ['connect', 'createServer', 'createSecureContext'],
  http: ['request', 'get', 'createServer'],
  https: ['request', 'get', 'createServer'],
  http2: ['connect', 'createServer', 'createSecureServer'],
  dns: ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'resolveSrv', 'reverse'],
  dgram: ['createSocket'],
};

if (!globalThis.__voiceLocalOnly) {
  for (const [mod, fns] of Object.entries(TABLE)) {
    const m = require(mod);
    for (const f of fns) if (typeof m[f] === 'function') m[f] = refuse(`${mod}.${f}`);
    if (m.promises) for (const f of fns) if (typeof m.promises[f] === 'function') m.promises[f] = refuse(`${mod}.promises.${f}`);
  }
  const net = require('net');
  net.Socket.prototype.connect = refuse('net.Socket.connect');
  for (const g of ['fetch', 'WebSocket', 'EventSource']) {
    if (g in globalThis) Object.defineProperty(globalThis, g, { value: refuse(g), writable: false, configurable: false });
  }
  syncBuiltinESMExports();
  Object.defineProperty(globalThis, '__voiceLocalOnly', { value: true });
}

// The environment for a Node child process that must stay local: this module is preloaded in it too.
export function childEnv(env = process.env) {
  const flag = `--import=${LOCAL_ONLY_URL}`;
  const prior = env.NODE_OPTIONS || '';
  return { ...env, NODE_OPTIONS: prior.includes(flag) ? prior : `${prior} ${flag}`.trim() };
}
