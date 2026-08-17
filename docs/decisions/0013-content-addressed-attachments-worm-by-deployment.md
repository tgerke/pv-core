# ADR-0013: Attachments and payloads are content-addressed; WORM depends on deployment

**Status**: accepted · 2026-08-17

## Decision

Source documents, correspondence, and submitted payloads are stored as bytes keyed by
their SHA-256 in a blob store behind a driver interface (`local` directory for
development, `s3` for any S3-compatible store). `case_attachment` rows are immutable and
carry the hash, file name, MIME type, size, uploader, and provenance. With the s3 driver
and a bucket created with Object Lock, the bytes are WORM; the local driver makes no such
guarantee, and `pnpm validation:iq` says which one an environment runs.

## Rationale

The port of ctms-core's storage design (its ADR-0009). Content addressing makes the hash
both the storage key and the identity a submission points at, so "what did we send" is
answered by bytes, and duplicate uploads deduplicate by construction.

## Consequences

Backups must cover the object store and Postgres together. Scoped reads (`GET
/files/{sha256}` resolves the case's study and sponsor before serving) keep attachments
inside the grant model.
