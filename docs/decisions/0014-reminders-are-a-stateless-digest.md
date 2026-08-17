# ADR-0014: Reminders are a stateless digest over the views

**Status**: accepted · 2026-08-17

## Decision

`pnpm digest` (`tools/digest.ts`, `packages/core/src/digest.ts`) reads the derived views
for each study and emails the people holding study-wide or sponsor-wide grants: due-soon
and overdue obligations, intake items awaiting validity, cases waiting in medical review,
and the audit-chain status. It stores nothing and is scheduled by cron. The same data is
served at `GET /studies/{id}/digest` so the email is never terminal-only knowledge.

## Rationale

The port of ctms-core's ADR-0017. Notification state (who was told what, when) is a
second system to keep consistent; a digest computed from the record each morning has
nothing to drift.

## Consequences

Per-user subscription preferences and event-driven alerts are not offered; the cadence is
the cron schedule. mailpit in docker-compose is the dev sink.
