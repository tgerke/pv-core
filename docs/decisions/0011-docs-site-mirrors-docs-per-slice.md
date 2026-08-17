# ADR-0011: The docs site is a mirror of docs/, written per slice

**Status**: accepted · 2026-08-17

## Decision

`site/` is an Astro Starlight site (the tooling ctms-core settled on in its ADR-0033):
getting started, a task-based user guide, compliance, validation, SQL access, cookbook,
roadmap, glossary, and an ADR index. Its pages are written in the same commit as the
feature they describe, not back-filled. `docs/*.md` and the site pages deliberately
overlap; a change to one usually needs the other, and `starlight-links-validator` fails
the build on broken internal links.

## Rationale

ctms-core learned that documentation written after the fact loses the details that were
obvious while the slice was fresh. Two audiences read the docs (ADR-0013 there): clinical
operations staff wanting tasks, and the data team wanting schema, API, and SQL. The site
serves the first; `docs/` serves the second.

## Consequences

Screenshots are deferred until the UI settles, then regenerated against a freshly seeded
stack. The docs workflow deploys `site/dist` to GitHub Pages on pushes to main.
