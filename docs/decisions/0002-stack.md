# ADR-0002: TypeScript + Postgres; R is a client, not the implementation

**Status**: accepted · 2026-08-17

## Decision

Postgres 16 is the system of record. The backend and frontend are TypeScript end to end
(Hono + Drizzle; Vite + React + Tailwind), the same stack as ctms-core. R (the team's
analysis stack) consumes the OpenAPI-documented REST API and the `v_*` views.

## Rationale

The product's core claim is a relational case model with compliance primitives; Postgres
provides triggers, views, constraints, and pgcrypto to enforce them in the database, below
any application bug. Keeping R at the API boundary rather than in the implementation is
the point: the API must be good enough that a safety physician in R never needs a
backdoor. Sibling repositories are prior art; patterns are ported, code is never shared.

## Consequences

`docs/04-api.md` carries worked httr2 examples (the overdue queue, the DSUR line listing)
as an acceptance test of API quality. Ports and package scope are chosen so all sibling
stacks run on one machine (`@pv-core/*`, api :8789, web :5176, Postgres :5436).
