# Security Rules

## Principles
- Never hardcode secrets, API keys, tokens, passwords, or credentials in source code.
- Validate all inputs at trust boundaries (user input, API parameters, file uploads).
- Principle of least privilege: request only the access you need.
- Defense in depth: don't rely on a single security layer.
- When in doubt, ask before exposing or transmitting sensitive data.

## Secrets and Sensitive Artifacts
- Never read, print, or expose .env files, private keys, certificates, auth tokens, or credentials unless explicitly required.
- Prefer environment variables, secret managers, or vault services for sensitive values.
- Mask sensitive values in examples and logs (show `sk-ant-...xxxx` not the full key).
- Never commit secrets to version control — use .gitignore patterns.
- If a secret appears in a file, flag it immediately.

## Access Control
- Enforce authentication before granting access to protected resources.
- Validate authorization at every layer (don't trust client-side checks alone).
- Minimize privileged access — use scoped tokens, read-only credentials where possible.
- Log security-sensitive operations for auditability.

## Input Validation
- Sanitize all untrusted input before using in queries, commands, or templates.
- Parameterize database queries — never concatenate user input into SQL/query strings.
- Validate file paths to prevent directory traversal.
- Limit request sizes and rate-limit API endpoints.

## Code Security Review Checklist
When proposing code changes, include a mental security check:
- [ ] Are there any hardcoded secrets or credentials?
- [ ] Is user input validated and sanitized?
- [ ] Are queries parameterized (no injection risk)?
- [ ] Is access control enforced at the right layer?
- [ ] Are errors handled without leaking internal details?
- [ ] Are sensitive operations logged for audit?
- [ ] Is the change backward-compatible with existing auth?

## Data Protection
- Do not send proprietary, internal, or customer data to external services without explicit approval.
- Distinguish between data classification levels (public, internal, confidential, restricted).
- When in doubt about whether data can be shared externally, ask first.
- PII requires extra handling — minimize collection, encrypt at rest, limit retention.

## Deployment Security
- Never expose management interfaces (admin panels, debug endpoints) to the public internet.
- Use TLS/HTTPS for all network communication.
- Keep dependencies updated — known vulnerabilities in dependencies are attackable.
- Use dedicated service accounts with minimal permissions for automated processes.
- Review firewall rules and network access before deploying.
