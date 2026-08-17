# ADR-0012: Regulatory forms are transcribed from the official documents; a PDF is a rendering of the signed version

**Status**: accepted · 2026-08-17

## Decision

CIOMS I and FDA MedWatch 3500A PDFs are rendered server-side (pdfkit) from a case
version. The field lists and box numbering are transcribed from the official form
documents fetched at implementation time (CIOMS I from the Council for International
Organizations of Medical Sciences; Form FDA 3500A and its instructions from fda.gov), with
URL and access date recorded here when that commit lands. If a form cannot be fetched and
verified, the output ships as an "ICH E2A Attachment 1 element report" (the key data
elements the source library does carry) and is listed as an honest gap; no form layout is
written from memory. A rendered PDF is not the record: the version hash is. Recording a
submission stores the exact bytes sent as a content-addressed attachment and copies the
version hash onto the submission row.

## Rationale

The form documents are public but not in the verified source library (ADR-0010). A CRO
handing a report to a regulator needs the real form, and a plausible-looking imitation of
it is worse than a labeled element report.

## Consequences

`submission.payload_sha256` and `GET /files/{sha256}` reproduce what was sent, byte for
byte. Re-rendering a version later may differ cosmetically; the record is the hash-bound
version plus the stored payload.
