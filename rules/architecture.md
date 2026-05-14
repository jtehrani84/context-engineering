# Architecture Rules

## Decision Framework
Always choose the simplest architecture that:
- Meets the requirement
- Scales reasonably for the expected load
- Is understandable by the next person who reads it
- Is secure
- Is testable
- Is operable (can be debugged, monitored, and maintained)

## Preferred Patterns
- Thin entry points, reusable services, clear separation of concerns.
- Encapsulate business logic in service/domain layers rather than scattering it across handlers, controllers, and helpers.
- Centralize constants, error messages, and shared utility logic.
- Keep orchestration separate from business rules.
- Design for reuse across UI, automation, and integrations.
- Prefer composition over inheritance.
- Make dependencies explicit (injection, not global state).

## Anti-Patterns to Avoid
- Monolithic utility classes doing everything
- Duplicated logic scattered across multiple files
- Hardcoded values, IDs, URLs, or environment assumptions
- UI components directly encoding business policy
- Deeply nested, hard-to-test logic
- Implicit coupling between unrelated systems
- Premature optimization before measuring
- Bypass flags or escape hatches without governance

## Change Design Output
For architecture-impacting work, always provide:
- Current-state issue (what's wrong or missing)
- Proposed design (what you're building)
- Alternatives considered (what else could work)
- Why this option was chosen (tradeoffs accepted)
- Deployment considerations (rollback plan, migration steps)

## Infrastructure Constraints
Before adding any new connection, auth path, or external system:
1. Check if the target system already has an established access pattern
2. Don't build parallel paths to the same destination
3. Document the integration contract (retries, timeouts, failure modes)
4. Consider: what happens when this dependency is down?

## Decision Records
For significant architecture decisions:
- Write a short decision record: context, decision, consequences
- Store in a `decisions/` directory or equivalent
- Reference these in future conversations — prevents re-litigating settled questions

## The "Would I Want to Debug This at 2 AM?" Test
Before any architecture choice, ask:
- Can I find the relevant code in under 2 minutes?
- Can I understand the data flow without reading 10 files?
- Can I roll this back without a database migration?
- Is the failure mode obvious (loud error) or silent (data corruption)?
