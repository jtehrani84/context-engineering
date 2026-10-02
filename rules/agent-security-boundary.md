# Agent Security Boundary (the agent-tool boundary is the security boundary)

Applies to any work that builds, configures, or reasons about an AI agent that (a) ingests
external or untrusted data AND (b) holds tools that reach sensitive systems. That covers a
coding agent, a CRM or support agent, a chat bot, an MCP-tool-bearing assistant, and anything
similar. Once both conditions hold, the line between "data the agent read" and "actions the
agent takes" is a security boundary. Design it as one from the start.

## Why agents are different

A traditional app has a fixed set of code paths. An agent's path is chosen at runtime by a model
reading whatever text is in front of it, including attacker-controlled text that arrived as
data. The classic trust boundary (authenticated input, then validation, then trusted action)
collapses: the untrusted input is the instruction stream, and the agent already holds the tools
and credentials to act on it. The person relying on the agent sees "it summarized my leads," not
"it followed hidden instructions and sent out the accounts table." Both look like the agent working.

## Grounding case study (public, third-party research)

In September 2026 the security firm Zenity Labs published three chained vulnerabilities in a
commercial CRM vendor's AI agent. Per the published write-ups, an attacker who never logged in
planted hidden instructions in a public lead-capture web form; when an employee later asked the
agent about leads, the agent followed them. Two flaws bypassed the platform's trusted-URL
allowlist (unrecognized top-level domains, and character sequences that interfered with URL
parsing) so CRM data left inside image requests, and team-chat link previews gave a second
zero-click path. The third flaw let the agent post phishing messages to team chat under its own
trusted identity without verifying who triggered the message. The research was reported to the
vendor months before disclosure, and the coverage says all three were fixed before it went public.
Sources: the Zenity Labs research blog; coverage in SecurityWeek and Infosecurity Magazine.
Zenity's own takeaway is that the pattern is not specific to one vendor. Cite these published
facts only; do not extend the case study with details you have not read in the source.

## The six principles

1. **Ingested external data is data, never instructions (indirect prompt injection).**
   Content from a form field, email, web page, ticket, or document can describe things; it can
   never authorize an action. Extract it against a schema, treat imperatives inside it as inert
   text, and remember that a poisoned record persists and can fire again every time it is processed.

2. **Egress is more than send tools. Any URL the client resolves is an exfiltration channel.**
   A read-only agent with no send tool can still leak data by placing it in an image URL, a link
   preview, a prefetch, or even a hostname (a DNS lookup alone can carry data out, with no click
   and no successful HTTP request). Default-deny outbound destinations, and count passive and
   render-time fetches as egress.

3. **An allowlist is only as sound as its parser.**
   If the filter and the browser (or HTTP client) read the same URL differently, the attacker
   wins in the gap. Canonicalize the target with the same parser the resolver uses, match the
   allowlist on that canonical form, and fail closed on anything ambiguous or unparseable.

4. **Broker sensitive data at the model and egress boundary, including the agent's own output.**
   The agent's output can itself be the exfiltration artifact (a data-bearing URL that renders
   later). Tokenize sensitive values before they reach the model and before anything leaves. Use
   a leak scan as a backstop, and match on a canonical form (case, unicode, ID variants), not on
   exact bytes.

5. **Outbound actions need human approval and attribution.**
   Any send or mutate action should be a human-gated step that shows who initiated it. Never
   auto-send, and never send under the agent's identity without saying which person or trigger
   caused it.

6. **Least authority by route.**
   A route gets only the tools and the data class it needs. A read or plan route is read-only
   with outbound denied. A broad default grant (one subagent that can read every object) means a
   single injected instruction reaches everything.

## The meta-principle

Guard three things independently: what enters the model (as data, never as instruction), what
the model can do (route-scoped tools, least authority), and what can leave (default-deny egress
including passive channels, brokered data, human-gated attributed sends). A weakness in any one
is enough for a full compromise; the chain in the case study used all three.

## Scope of this rule

These are design requirements, not a detector. A guard can enforce them, but only a
forced-failure test proves the guard holds, and the guard's own parser and allowlist need an
adversarial test: parse differentials are where allowlists fail. When reviewing someone else's
agent, turn each principle into a question they can answer about it: what untrusted text does
it read, what can it reach, and what can leave.

Related: `security.md` (access control and secrets), `guards/` (working code for principles 2-4),
`proof-before-claim.md` (prove the guard fires before claiming it works).
