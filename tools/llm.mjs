// llm.mjs — ONE portable LLM entry point for the kit's tools.
//
// The rag-quality tools (mk-*) import `{ llm }` from here so they never hardcode a specific provider
// or a personal project. Wire it to YOUR model access in this ONE place — an Anthropic API key, an
// OpenAI-compatible endpoint, a cloud model API, your company's model proxy — and every tool follows.
//
// Contract:  llm(prompt, { system?, max?, model?, temperature? }) -> Promise<string>
//
// Default implementation below calls an OpenAI-compatible chat endpoint via env vars:
//   LLM_BASE_URL   e.g. https://api.openai.com/v1   (or your gateway's base)
//   LLM_API_KEY    your bearer token
//   LLM_MODEL      default model id (overridable per-call via opts.model)
// If those aren't set, it throws a clear message instead of failing silently. To use a different
// provider, replace the body of llm() with your own call — keep the contract and the tools still work.
export async function llm(prompt, opts = {}) {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = opts.model || process.env.LLM_MODEL;
  if (!base || !key || !model) {
    throw new Error(
      'tools/llm.mjs is not configured. Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL for an ' +
      'OpenAI-compatible endpoint, or replace the body of llm() with your own provider call ' +
      '(Anthropic, Vertex, your gateway). See the header of tools/llm.mjs.'
    );
  }
  const messages = opts.system
    ? [{ role: 'system', content: opts.system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: opts.max || 2048, temperature: opts.temperature ?? 0.2 }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}
