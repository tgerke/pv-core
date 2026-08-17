# ADR-0018: Docs screenshots and evaluator pages are generated from the seeded stack, never hand-made

**Status**: accepted · 2026-08-17

## Context

ADR-0011 deferred screenshots "until the UI settles, then regenerated against a freshly
seeded stack." The site now has to serve a second reader beside the case processor: the
clinical-operations lead at a CRO deciding whether pv-core fits a safety-database
engagement, who reaches the site after a screen share and needs to see every screen,
follow the workflows, and judge fit without running anything. A picture that was
hand-captured once and never refreshed is the fastest way to misrepresent the product,
and a fit checklist maintained by hand is a second copy of the roadmap that will drift.

## Decision

1. `tools/screenshots.mjs` (`pnpm docs:screenshots`) is the only producer of
   `site/src/assets/screenshots/**` and `site/src/assets/generated/**`. It drives headless
   Chrome over the DevTools protocol against the dev stack, refuses to run unless the API
   is in dev auth mode and the database is exactly the seed (a `pnpm test` run pollutes
   it), never mutates (dialogs are opened and never confirmed, forms typed into and never
   submitted, every non-GET request from the browser is blocked at the network layer and
   counted as a failure), looks every entity up from the live API because seeding
   regenerates UUIDs, and fails loudly on seed drift. It also writes the digest text, the
   E2B(R3) JSON export, and page 1 of the CIOMS I and 3500A renderings, which have no
   screen of their own.
2. Regenerating is part of any commit that changes a pictured screen; a stale screenshot
   is a documentation bug. Screenshots are light theme, 1440×900 at 2× as WebP, and the
   files are committed (the docs workflow builds from checkout and only runs on `site/**`).
3. Evaluator pages derive from existing prose instead of restating it. The fit assessment
   parses the roadmap's readiness table at build time and fails the build if the table
   moves; the tour, overview, and persona tabs reuse sentences already on the user-guide,
   compliance, and roadmap pages for anything regulatory (ADR-0010).
4. Feedback is collected privately (screen shares, email), so the site produces a copyable
   summary rather than linking a public tracker. Revisit when a public channel opens.

## Consequences

Roughly 7 MB of WebP per generation lands in git; regenerate deliberately, and use `ONLY=`
to limit the blast radius. CI does not run the capture (it needs Chrome and the full
stack), the same posture as the validation artifacts of ADR-0017. `docs/` gains no mirror
of the evaluator pages: ADR-0011 already assigns clinical-ops-facing task content to the
site, and `compliance.md` stays the one mandated lockstep pair.
