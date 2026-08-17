# ADR-0015: Multi-sponsor is a scope on one CRO instance, not a tenant

**Status**: accepted · 2026-08-17

## Context

A CRO hosts several sponsors' programs. Incumbents sell "multitenant CRO support" as a
tier. Tenancy (per-sponsor databases, keys, isolation guarantees) is a large amount of
machinery for the current phase, but a sponsor's staff must not see another sponsor's
cases.

## Decision

`access_grant` scopes to a sponsor `organization`, to a `study`, or to nothing
(instance-wide). Authorization resolves every resource to its study and its sponsor
organization and permits the operation when the actor holds a matching grant at any of
the three levels. Products, destinations, and rules can be owned by a sponsor
organization. One instance per operating organization; the seed shows two sponsors so the
scoping has something to hide.

## Alternatives considered

- Per-sponsor schemas or databases. Deferred: correct for a hosted product, unnecessary
  for a pilot, and it would move the compliance triggers into a per-tenant provisioning
  story.
- Study-only scoping. Rejected: a sponsor's safety physician works across that sponsor's
  studies and would need a grant per study.

## Consequences

Sponsor segregation rests on grants and scoped reads, not on isolation; docs/03-compliance.md
states so among the honest gaps. Cross-sponsor aggregate views (`v_reporting_compliance`)
carry the sponsor column so a scoped reader sees only its rows.
