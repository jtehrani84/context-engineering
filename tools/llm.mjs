// llm.mjs — ONE portable LLM entry point for the kit's tools.
//
// The rag-quality tools (mk-*) import `{ llm }` from here so they never hardcode a specific provider
// or a personal project. Wire it to YOUR model access in this ONE place — an Anthropic API key, an
// OpenAI-compatible endpoint, a cloud model API, your company's model proxy — and every tool follows.
//
// Contract:  llm(prompt, { system?, max?, model?, role?, temperature? }) -> Promise<string>
//
// Default implementation below calls an OpenAI-compatible chat endpoint via env vars:
//   LLM_BASE_URL   e.g. https://api.openai.com/v1   (or your gateway's base)
//   LLM_API_KEY    your bearer token
//   LLM_MODEL      default model id (overridable per-call via opts.model)
// If those aren't set, it throws a clear message instead of failing silently. To use a different
// provider, replace the body of llm() with your own call — keep the contract and the tools still work.
//
// Roles: a tool that needs a particular kind of model asks for a ROLE (gemini-flash, grok, ... the list and each
// role's id pattern are in model-roster.json), never a model id, so it keeps working when your endpoint moves to a
// new version. Which id a role gets, in order: opts.model when the caller pins one; the role's entry in
// LLM_MODEL_ALIASES (a JSON map, the same variable scripts/llm-call.py reads, e.g. '{"grok": "<model-id>"}'); else
// the newest id in the role's family that your endpoint's GET /models lists. A role the endpoint doesn't list
// throws, naming the role and what it lists; there is no fallback to LLM_MODEL or another vendor.
// The /models pick goes through model-roster.mjs resolve(), the same resolver opencode-llm uses: two providers listing
// one family ("a/x" and "b/x") is an ambiguity error (MODEL_ROSTER_PROVIDERS settles it per role), and the pick is
// cached and a changed id logged in ~/.cache/model-roster/, under "<role>@llm-endpoint". When /models can't be read,
// the last-known id is used with a STALE note on stderr; a change gets a note too.
import { loadRoster, normalizeRole, resolve, RosterError } from './model-roster.mjs';

function config(opts) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (!base || !key || (!opts.model && !opts.role && !process.env.LLM_MODEL)) {
    throw new Error(
      'tools/llm.mjs is not configured. Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL for an ' +
      'OpenAI-compatible endpoint, or replace the body of llm() with your own provider call ' +
      '(Anthropic, Vertex, your gateway). See the header of tools/llm.mjs.'
    );
  }
  return { base: base.replace(/\/$/, ''), key };
}

function aliases() {
  try { const a = JSON.parse(process.env.LLM_MODEL_ALIASES || '{}'); return a && typeof a === 'object' ? a : {}; } catch { return {}; }
}

// role → the model id to send. Exported for tests and for tools that want to print what a role resolves to.
export async function modelForRole(role, { base, key } = config({ role })) {
  const roster = loadRoster();
  const n = normalizeRole(role, roster);
  if (!n) throw new RosterError(`llm.mjs: unknown role '${role}'. Known roles: ${Object.keys(roster.roles).join(', ')}.`, { role });
  const pinned = aliases()[role] ?? aliases()[n.role];
  if (typeof pinned === 'string' && pinned) return pinned;
  const listModels = async () => {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GET ${base}/models answered HTTP ${res.status}`);
    return ((await res.json())?.data || []).map((m) => m?.id).filter((id) => typeof id === 'string');
  };
  let r;
  try { r = await resolve(n.role, { roster, listModels, scope: 'llm-endpoint', sourceName: `${base}/models` }); }
  catch (e) {
    if (!(e instanceof RosterError)) throw e;
    throw new RosterError(`llm.mjs: ${String(e.message).replace(/^model-roster: /, '')} Name the id in LLM_MODEL_ALIASES, or edit the role's pattern in model-roster.json.`, { role: n.role, served: e.served });
  }
  const note = r.changed ? `llm.mjs: role '${r.role}' is now ${r.qualified} (was ${r.previous}); going ahead with the new id`
    : r.stale ? `llm.mjs: role '${r.role}' uses ${r.qualified}, the last-known id from ${r.resolvedAt} (STALE: ${(r.unavailable || []).join('; ').replace(/\s+/g, ' ').trim()}); it may have been removed since` : '';
  if (note && !noted.has(note)) { noted.add(note); console.error(note); }
  // the id as the endpoint listed it ("vendor/model" keeps its prefix)
  return r.qualified;
}
const noted = new Set();

export async function llm(prompt, opts = {}) {
  const { base, key } = config(opts);
  const model = opts.model || (opts.role ? await modelForRole(opts.role, { base, key }) : process.env.LLM_MODEL);
  const messages = opts.system
    ? [{ role: 'system', content: opts.system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: opts.max || 2048, temperature: opts.temperature ?? 0.2 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}
