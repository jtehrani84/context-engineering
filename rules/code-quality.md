# Code Quality Rules

## General Principles
- Write code that validates behavior, not implementation trivia.
- Favor readability over cleverness. Clear code that a new team member understands beats compact code that requires context.
- Keep functions focused — one job, well-named, under 40 lines when possible.
- Meaningful error handling. Don't swallow exceptions. Don't log and rethrow without adding context.
- Prefer explicit over implicit (magic numbers, hidden state, auto-wiring that's hard to trace).

## Performance & Efficiency
- Never perform expensive operations (DB calls, API requests, file I/O) inside loops when they could be batched.
- Use collections and maps to reduce lookup overhead.
- Be conscious of memory: don't load entire datasets when you need a subset.
- Measure before optimizing. Don't guess where the bottleneck is.
- Cache when safe and appropriate — but be explicit about invalidation.

## Separation of Concerns
- Keep business logic separate from infrastructure (DB, HTTP, file system).
- Entry points (handlers, controllers, triggers) should orchestrate only — no business logic in these.
- One entry point per concern (one event handler per entity/event type).
- Shared state is a liability — pass dependencies explicitly.

## Error Handling
- Fail fast and loudly at boundaries. Don't let invalid data propagate.
- Handle partial success deliberately (what happens when 3 of 5 items fail?).
- User-facing errors: helpful message with what to do next.
- Developer-facing errors: include context (what input caused this, what state was the system in).
- Never catch-all without logging or re-throwing.

## Testing
- Write tests that validate behavior (given X, expect Y) not implementation details.
- Cover: happy path, error cases, edge cases, boundary conditions.
- Use realistic test data — not "test123" or single-character strings.
- Tests should be readable as documentation: a new developer should understand the feature from reading the tests.
- Avoid test interdependencies — each test should work in isolation.
- Don't chase coverage numbers. 70% meaningful coverage beats 95% trivial coverage.

## Code Review Mindset
Before finalizing a solution, check:
- Security: injection, access control, data exposure
- Performance: N+1 queries, unbounded loops, missing indexes
- Reliability: error handling, retry logic, timeout handling
- Backward compatibility: does this break existing callers?
- Operability: logging, monitoring, deployment dependencies
- Simplicity: is there a simpler way that still meets the requirement?

## Naming Conventions
- Functions: verb-noun (`calculateTotal`, `fetchUserProfile`, `validateInput`)
- Variables: describe the content, not the type (`userEmail` not `str1`)
- Booleans: is/has/should prefix (`isValid`, `hasPermission`, `shouldRetry`)
- Constants: describe the purpose (`MAX_RETRY_ATTEMPTS` not `THREE`)
- Files: match their primary export or purpose

## Dependencies
- Minimize external dependencies — each one is a security surface and maintenance burden.
- Pin versions explicitly. Lock files should be committed.
- Audit new dependencies before adding (maintenance status, security history, bundle size).
- Prefer standard library solutions when they're close enough.
