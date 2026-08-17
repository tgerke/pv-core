# Pilot deployment (one instance per CRO)

One deployment per operating organization; a CRO hosts its sponsors on it as scoped
grants, not as tenants (ADR-0015). This page is the checklist that turns the dev
quickstart into a pilot posture. `pnpm validation:iq` verifies most of it against the
running environment and produces the sign-off report.

## Topology

Three processes and three stores: the api (Hono, `pnpm --filter @pv-core/api start`),
the web bundle (static, served by nginx from the `apps/web` image), Postgres 16, an
S3-compatible object store for attachments and submission payloads, and an SMTP relay for
the reminders digest. Container images publish from tagged releases
(`ghcr.io/tgerke/pv-core-{api,web}`); the api image doubles as the one-shot runner for
migrate, seed, `import-meddra`, and the digest cron because it ships `packages/db` and
`tools/`.

## Environment

Take variable names from `.env.example`. The ones a pilot must set:

- `DATABASE_URL` (owning role, migrations and seed only) and `DATABASE_URL_APP` or
  `PV_APP_PASSWORD` for the DML-only `pv_app` role the api connects as. Rotate the
  dev-grade role passwords before exposing anything.
- `PV_TIMEZONE`: the sponsor's business time zone. Regulatory clocks are calendar days;
  every connection pins its session time zone here so `CURRENT_DATE` and `sent_at::date`
  agree with the calendar the safety team works on (ADR-0007).
- `AUTH_MODE=oidc` with `OIDC_ISSUER`, `OIDC_AUDIENCE`, and (for machine intake)
  `API_SERVICE_SUBJECTS`. `REAUTH_MAX_AGE_SECONDS` sets the 21 CFR 11.200 re-authentication
  window for signing (default 300). Dev mode is a demo affordance, not a pilot posture.
- `STORAGE_DRIVER=s3` with a bucket created with Object Lock, so attachment and payload
  bytes are WORM (ADR-0013). The local-directory driver is for development.
- `SMTP_URL` and `DIGEST_FROM` for `pnpm digest`, scheduled from cron.

## MedDRA

The repository ships no MedDRA content. Load the release your organization licenses:

```sh
pnpm db:import-meddra -- --version 27.1 --dir /path/to/MedDRA/ascii-27.1
```

The importer reads `mdhier.asc` and `llt.asc` verbatim and records the source hash on the
`dictionary` row. Re-running with the same version is a no-op; a new release is a new row.
Point `app_meta.meddra_default_dictionary_id` at the release new cases should code
against.

## First users

Provision a `person` matching the IdP email plus an `access_grant` row (two audited
INSERTs, or the admin API once one admin exists). Scope grants to a sponsor organization
for staff who work across that sponsor's studies and to a study for staff who work on
one; leave a grant unscoped only for the instance administrator and the read-only auditor.

## Bring-up order

```sh
pnpm db:migrate                       # owning role
pnpm db:import-meddra -- ...          # licensed release
# provision the first admin person + access_grant (two INSERTs)
pnpm --filter @pv-core/api start      # connects as pv_app
```

## Reminders digest

`pnpm digest` reads the derived views and mails one plain-text summary per study (overdue
and due-soon obligations, intake items, stale reviews, unassessed causality, chain
status) to the people whose grants cover the study. It is stateless; schedule it from
cron at whatever cadence the safety team wants:

```sh
# weekday mornings at 07:00 local, from a checkout
0 7 * * 1-5  cd /opt/pv-core && pnpm digest
# or against the compose stack (the api image ships tools/)
0 7 * * 1-5  docker compose exec api pnpm digest
```

`GET /studies/{id}/digest` serves the same content, so what the email says is never
terminal-only knowledge.

## Backups and verification

Back up the Postgres volume and the object-store bucket together; a submission record
points at payload bytes by SHA-256, and a restore that has one without the other is
incomplete. `GET /audit-chain/verify` (or `SELECT * FROM pv_verify_audit_chain()`) after a
restore confirms the audit trail is intact; the verdict is the same from any session time
zone, since the hash input for `occurred_at` is a canonical UTC rendering (migration 0003).
`v_signature_integrity` confirms every signed version still hashes to what was signed.
