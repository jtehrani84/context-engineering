#!/usr/bin/env node
/**
 * egress-guard.mjs — outbound egress control (the leak primitive's egress half). Motivated by the
 * publicly reported 2026 chain against a commercial CRM agent (Zenity Labs; see
 * rules/agent-security-boundary.md): a read-only agent
 * leaked CRM data by embedding it in the subdomain of an external-image URL — rendering the image
 * fired a DNS query that exfiltrated the data, defeating the Trusted-URLs allowlist via a URL-parse
 * discrepancy, with no send tool and no click.
 *
 * Two lessons folded in:
 *  1. EGRESS != SEND-TOOLS. Any URL the client will RESOLVE is an egress channel — image src, link
 *     preview, fetch, webhook. This guard treats every extractable URL as egress, not just send calls.
 *  2. AN ALLOWLIST IS ONLY AS SOUND AS ITS PARSER. We canonicalize the host with the WHATWG URL parser
 *     (the same parser browsers use) and match the allowlist on that canonical host — and we DEFAULT
 *     DENY: anything we cannot parse to a clean allowlisted host is blocked, so a parse ambiguity fails
 *     closed instead of slipping through. We also refuse data-bearing subdomains against the broker.
 *
 * checkEgress(text, {broker, allowHosts}) scans model/agent OUTPUT for URLs, blocks any whose host is
 * not on the exact allowlist, and — using the broker — blocks any URL that carries a registered
 * sensitive value anywhere (host, subdomain, path, query). Returns { ok, blocked:[{url,reason}] }.
 */
const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
// also catch bare-host image/src patterns and protocol-relative //host/...
const HOSTISH_RE = /(?:src|href)\s*=\s*["']?\s*(\/\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+)/gi;
// Protocol-relative //host ANYWHERE, not just src=/href= (adversarial-review fix): a markdown
// image `![x](//h/p)`, CSS `url(//h/p)`, or a bare `//h/p` all resolve against the page scheme and fire
// egress, but HOSTISH_RE only saw them inside src/href — so they slipped the allowlist + broker entirely.
const SCHEME_REL_RE = /(?:^|[\s(\[<'"])(\/\/[^\s"'<>)\]]+)/g;
// Parse-differential defense (adversarial-review fix): the WHATWG URL parser that
// browsers + fetch use STRIPS ASCII tab/newline/CR from a URL before resolving it. URL_RE/HOSTISH_RE
// stop at those chars (they are \s), so `https://trusted-saas.test\t.evil.com/p` would extract the clean
// allowlisted prefix while the browser resolves the ATTACKER host — fail-open. This is the same class
// as the published trusted-URL allowlist bypass in rules/agent-security-boundary.md (character sequences that change how the URL parses);
// the public write-up does not name the exact characters. Capture any scheme/`//` run that CONTAINS \t/\n/\r (delimited by
// space/quote/paren, NOT by the strip chars), strip them, and check the browser's REAL host too.
const URL_DIFF_RE = /(?:https?:\/\/|\/\/)[^ "'<>)\]]*[\t\n\r][^ "'<>)\]]*/gi;

function canonicalHost(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/\.$/, ''); } // strip trailing-dot (DNS root) trick
  catch { try { return new URL('http:' + u).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; } }
}

// host is allowed only if it EXACTLY equals an allowlisted host or is a subdomain of one
function hostAllowed(host, allowHosts) {
  if (!host) return false;
  return allowHosts.some(a => host === a || host.endsWith('.' + a));
}

export function checkEgress(text, opts = {}) {
  const allowHosts = (opts.allowHosts || []).map(h => h.toLowerCase());
  const broker = opts.broker || null;
  const s = String(text); // keep raw (with \t\n\r) — URL_DIFF_RE needs the strip chars intact
  const urls = new Set();
  for (const m of s.matchAll(URL_RE)) urls.add(m[0].replace(/[.,;]+$/, ''));
  for (const m of s.matchAll(HOSTISH_RE)) urls.add(m[1].replace(/[.,;]+$/, ''));
  for (const m of s.matchAll(SCHEME_REL_RE)) urls.add(m[1].replace(/[.,;]+$/, ''));            // protocol-relative //host anywhere
  for (const m of s.matchAll(URL_DIFF_RE)) urls.add(m[0].replace(/[\t\n\r]+/g, '').replace(/[.,;]+$/, '')); // strip tab/LF/CR → the host the browser resolves

  const blocked = [];
  for (const url of urls) {
    const host = canonicalHost(url);
    // DEFAULT DENY: unparseable/ambiguous host fails closed
    if (!host) { blocked.push({ url, reason: 'unparseable host — default-deny (parse-ambiguity fails closed)' }); continue; }
    if (!hostAllowed(host, allowHosts)) { blocked.push({ url, reason: `host '${host}' not on egress allowlist` }); continue; }
    // even an allowlisted host is blocked if the URL carries sensitive data (the case study's data-in-subdomain trick)
    if (broker) { const leak = broker.scanForLeak(url); if (!leak.clean) blocked.push({ url, reason: `carries sensitive data in the URL (${leak.leaked.length} value(s)) — data-exfil channel` }); }
  }
  return { ok: blocked.length === 0, blocked, urlsSeen: urls.size };
}
