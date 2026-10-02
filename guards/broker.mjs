#!/usr/bin/env node
/**
 * broker.mjs — run-scoped model-boundary token broker (the leak/injection primitive).
 *
 * Keeps raw sensitive data out of the model AND any model-adjacent egress. Sensitive values are
 * replaced with opaque handles bound to run + field + data class + destination; the model sees only
 * handles; restoration happens only inside a trusted connector holding the broker key.
 *
 * Hardened after adversarial review — three soundness holes fixed:
 *  - byte-exact matching missed equivalent forms (15-char SF id, case, unicode). FIX: `scanForLeak`
 *    is the SOUND backstop — it matches on a canonical form (NFKC + casefold + strip zero-width),
 *    so an equivalent form of a registered value cannot egress with a green canary; register() also
 *    stores known equivalents (e.g. an 18-char SF id's 15-char prefix).
 *  - registration-order fragmentation split a longer value (incl. the canary) when a substring was
 *    registered first. FIX: tokenize claims non-overlapping spans over the ORIGINAL text longest-first.
 *  - a value that is a substring of a handle re-tokenized inside emitted handles, corrupting restore.
 *    FIX: existing handle spans are pre-claimed; output is built in one pass over the original text, so
 *    a handle is never re-scanned; detokenize returns ok:false on any unknown/nested handle.
 *
 * scanForLeak(text).clean === true means: no registered value, in any known-equivalent canonical form,
 * is present in the handle-stripped text. That is the safety guarantee customer routes rely on.
 */
const ZW = /[\u200B-\u200D\uFEFF\u00A0]/g;
const HANDLE = /⟦H:[^⟧]+⟧/g;
const canon = s => String(s).normalize('NFKC').replace(ZW, '').toLowerCase();

// known equivalent representations of a value (extend per domain)
function variants(value) {
  const v = String(value), out = new Set([v]);
  if (/^[A-Za-z0-9]{18}$/.test(v)) out.add(v.slice(0, 15)); // 18-char case-safe record id -> its 15-char prefix (some CRMs issue both forms)
  return [...out];
}

export function openBroker(runId, opts = {}) {
  const key = opts.key || null;
  const map = new Map();        // handle -> { value, field, dataClass, destination }
  const forms = new Map();      // raw registered form -> meta (incl. variants)
  const canonForms = new Map(); // canon(form) -> raw form (leak backstop)
  let seq = 0;
  const handleFor = () => `⟦H:${runId}#${++seq}⟧`;

  function register(value, meta = {}) {
    if (!value) return value;
    for (const f of variants(value)) { forms.set(f, meta); canonForms.set(canon(f), f); }
    return value;
  }

  // tokenize: claim non-overlapping spans over the ORIGINAL text, longest-first, never inside an
  // existing handle. Build the output in one pass — an emitted handle is never re-scanned.
  function tokenize(text, ctx = {}) {
    const s = String(text);
    const claimed = new Array(s.length).fill(false);
    for (const m of s.matchAll(HANDLE)) for (let k = m.index; k < m.index + m[0].length; k++) claimed[k] = true;
    const spans = [];
    for (const value of [...forms.keys()].sort((a, b) => b.length - a.length)) {
      let idx = 0;
      while ((idx = s.indexOf(value, idx)) !== -1) {
        const end = idx + value.length;
        let free = true; for (let k = idx; k < end; k++) if (claimed[k]) { free = false; break; }
        if (free) { spans.push({ start: idx, end, value }); for (let k = idx; k < end; k++) claimed[k] = true; }
        idx = end;
      }
    }
    spans.sort((a, b) => a.start - b.start);
    let out = '', pos = 0;
    for (const sp of spans) {
      out += s.slice(pos, sp.start);
      const h = handleFor();
      map.set(h, { value: sp.value, field: ctx.field || null, dataClass: ctx.dataClass || null, destination: ctx.destination || null });
      out += h; pos = sp.end;
    }
    return out + s.slice(pos);
  }

  // ONLY the trusted connector (with the key) restores; any unknown/nested handle => ok:false.
  function detokenize(text, connectorKey) {
    if (!key || connectorKey !== key) return { ok: false, reason: 'detokenization requires the trusted-connector key (unavailable to the model)', text: String(text) };
    let unknown = 0;
    const out = String(text).replace(HANDLE, h => { const e = map.get(h); if (e) return e.value; unknown++; return h; });
    if (unknown > 0 || /⟦H:/.test(out)) return { ok: false, reason: 'unknown or nested handle — refusing partially-restored text', text: out, unknownHandles: unknown };
    return { ok: true, text: out, unknownHandles: 0 };
  }

  // SOUND leak backstop: canonical match over handle-stripped text catches case/unicode/id-form variants.
  function scanForLeak(text) {
    const stripped = String(text).replace(HANDLE, ''); // handles are opaque, not leaks
    const cs = canon(stripped), leaked = [];
    for (const [c, raw] of canonForms) if (c && cs.includes(c)) leaked.push(raw);
    return { clean: leaked.length === 0, leaked };
  }

  return { register, tokenize, detokenize, scanForLeak, get handleCount() { return map.size; } };
}
