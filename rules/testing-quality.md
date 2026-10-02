# Testing and Quality Rules

## Tests
- Write focused tests that validate behavior, not implementation trivia.
- Cover positive, negative, bulk or high-volume, permission-sensitive, and edge scenarios where relevant.
- Use realistic test data. Don't let tests read shared or production data unless there is no viable
  alternative, and say why when you do.
- Assert meaningful outcomes, not just line coverage.
- Test security-sensitive behavior (access checks, input validation) where it applies.

## UI tests
- Prefer component tests for UI behavior when the repository supports them.
- Validate rendering, states, events, and user interactions.
- Mock the backend thoughtfully: mock at the boundary, not inside the logic under test.
- Keep tests readable and resilient.

## Proof-artifact rule (untyped code)
For code without static type checking (Apps Script, raw JS without a linter, shell scripts):
- A commit is not proof of correctness. Execution is.
- After any fix, exercise the modified path with a real call before marking it shipped.
- Minimum: one synthetic request that hits the changed function and returns a valid response.
- If you can't execute it (no deploy access, an auth wall), say so, and ask the user to verify
  through the tool's own error UI (Apps Script Executions panel, browser DevTools, service logs).
- Never report five or more fixes as "all green" from code review alone. At least the riskiest
  fix needs an execution proof.

## Persistence proof (datastore writes)
For any pipeline step or feature that writes to a datastore (database tables, a vector store,
a cache, a queue, a SaaS object store):
- A successful write call is not proof that rows landed. A row count at runtime is. Zero rows is
  a hard failure, however clean the code reads or whether it compiles.
- This applies in every language. Compile-time safety doesn't cover a silent zero, and partial-success
  flags ("continue on error" batch modes), swallowed try/catch blocks, optional-step warnings, and best-effort
  handlers all hide failed writes behind a green status.
- After a representative run, count the written object before and after. The count must go up. If
  it doesn't, the writer is not writing.
- When auditing a persistence pipeline, start with the live row count before reading any write
  code. Then call every advertised endpoint (a 404 means the endpoint is advertised but not
  built), and census every declared field: long-text fields can't be filtered with `!= null`, so
  select them and count client-side, and exclude picklist defaults, which read as populated.
- Metadata can describe a field that doesn't work. A schema-describe call, a migration file, and
  even a deploy that reports success can all agree a column exists while it can't be queried.
  Treat a passing schema check as a hint, not proof. The reliable checks are a successful write
  or SELECT against the real datastore, or code that references the field and runs. If an admin
  still can't see the field, suspect this before suspecting permissions.
- A hook can nudge ("run the row-count check"), but it can't prove persistence. The proof is a
  test plus a health probe that runs against the real datastore.
- Same principle as the proof-artifact rule above: the commit isn't the proof, the row count is.

## Quality gate mindset
Before finalizing a solution, check:
- security
- limits
- test impact
- backward compatibility
- deployment dependencies
- admin operability
- user experience
