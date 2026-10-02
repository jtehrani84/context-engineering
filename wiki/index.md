# Wiki Index

Master index of every page in this wiki. Claude keeps it current when it adds a page (`/ingest` does this), and you prune it. Pages load on demand, so an entry here costs one line of context and the page itself costs nothing until it is opened.

Last updated: [YYYY-MM-DD]

## How to Use
- Each entry is one line: a link and a sentence that says when to open the page.
- Run `/curate` weekly to flag stale entries, or `/wiki-lint` to find dead links and unlisted pages.
- Every change to the wiki gets a line in `log.md`, newest at the bottom.
- Pages you don't want listed, routed to or shared are local-only. See the convention in `README.md`.

## Projects
<!-- Active engagements and builds: what, why, status, key links -->

## Concepts
<!-- Architecture patterns, standards and frameworks you reference repeatedly -->

## Entities
<!-- Companies, products and competitors. See entities/README.md -->

## People
<!-- Stakeholder profiles. See people/README.md. Keep these local-only -->

## Tools
<!-- Tool configs, CLI notes, integration how-tos -->

## Events
<!-- Conferences, launches, customer workshops -->

## Insights
<!-- Articles and sources you have processed, with what you took from them -->

## Decisions
<!-- Architectural decision records: the reasoning behind settled debates -->
<!-- Example: decisions/ADR-001-auth-approach.md -->

## Inbox

Unprocessed items live in `inbox.md`. Crons and sessions append there, and `/curate` turns each item into a page or discards it.
