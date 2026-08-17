# pv-core

A pharmacovigilance safety database for clinical trials, built for the sponsor and
CRO seat: every adverse-event case is a relational
[ICH E2B(R3)](https://database.ich.org/sites/default/files/E2B-R3_ICSR_Implementation_Guide.pdf)-shaped
record with versions that lock on signature, coded to a MedDRA release you load
yourself, and an append-only audit trail. A reporting-obligation engine materializes
*expected submissions* from declarative rules, so which cases are reportable, to whom,
by when, and what is overdue are queries, not a tracker spreadsheet.

The public API is the product; the web UI is its first customer.

## Why

Incumbent safety databases are heavy workflow engines priced for pharma. Academic
sponsors, consortia, and the CROs serving them keep SAEs and their 7- and 15-day clocks
in spreadsheets beside a vendor system, and questions like "which SUSARs are due to the
FDA this week?" or "how many follow-ups went out late this quarter?" take someone
rebuilding the answer by hand. Here they are one `GET` (or one `SELECT`). See
[docs/01-vision.md](docs/01-vision.md).

## Layout

| Path | What |
| --- | --- |
| `docs/` | Design docs: vision, data model, compliance mapping, API guide, deployment, roadmap + ADR log |
| `docs/validation/` | Generated IQ/OQ reports and requirement→test traceability matrix |
| `site/` | Astro Starlight docs site: getting started, user guide, cookbook, compliance, validation |
| `packages/db` | Postgres schema (Drizzle), migrations, audit-trail enforcement, blob storage, seed, MedDRA importer |
| `packages/core` | Domain logic: audited mutations, case lifecycle, reporting-obligation engine, renderers |
| `apps/api` | OpenAPI 3.1 REST API (Hono), spec at `/openapi.json`, docs at `/docs` |
| `apps/web` | React app: case queue, case pages, reporting calendar, DSUR listings, admin, audit timeline |
| `tools/` | CLI jobs: reminders digest, validation artifacts |

## Quick start

Requires Node 22+, pnpm, Docker.

```sh
cp .env.example .env
pnpm install
pnpm db:up        # Postgres 16 (:5436), MinIO, mailpit in Docker
pnpm db:migrate
pnpm db:seed      # two fictional trials, nine cases at every point of the clock
pnpm dev          # API on :8789, web on :5176
```

Then open `http://localhost:5176` (case queue) and `http://localhost:8789/docs` (API
reference).

```sh
pnpm test                   # includes DB-level audit-immutability tests
pnpm check                  # lint + typecheck + test
```

## Status

Scaffold. The vertical slice (schema, engine, API, web, docs) is landing commit by
commit; see [docs/06-roadmap.md](docs/06-roadmap.md) for what a CRO "build us a safety
database" engagement needs and how far this is from it. It is not validated software; the
formal CSV program is organizational work.

## License

[AGPL-3.0](LICENSE). Same license as its siblings
[edc-core](https://github.com/tgerke/edc-core), [ctms-core](https://github.com/tgerke/ctms-core),
and [rtsm-core](https://github.com/tgerke/rtsm-core), for the same reason: anyone can run,
study, and improve this, and nobody can take it closed and sell it back to the sites and
sponsors it serves.
