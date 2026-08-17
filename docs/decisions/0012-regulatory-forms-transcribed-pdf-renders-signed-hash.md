# ADR-0012: Regulatory forms are transcribed from the official documents; a PDF is a rendering of the signed version

**Status**: accepted · 2026-08-17

## Decision

CIOMS I and FDA MedWatch 3500A PDFs are rendered server-side (pdfkit) from a case
version (`packages/core/src/forms.ts`). The field lists and box numbering are transcribed
from the official form documents, fetched 2026-08-17:

| Form | Source | SHA-256 of the fetched file |
| --- | --- | --- |
| CIOMS Form, Suspect Adverse Reaction Report (items 1 to 25a) | https://cioms.ch/wp-content/uploads/2017/05/cioms-form1.pdf | `e6f6bad7ad09225e30d8b0e4dec1f033732260db0464439ff94d0e17e8a805dc` |
| Form FDA 3500A MedWatch (09/2025), OMB No. 0910-0291, expires 09-30-2027 | https://www.fda.gov/media/69876/download | `d9f3e6b6b9fcd5c8d38fda4989c50e73ce77e15ef657476a5e04a968dc2bd382` |
| General instructions for Form FDA 3500A | https://www.fda.gov/media/133177/download | `1441210b0c737ea0d69a27c11a77f254216a8c3b3656e6a447c2564335c34dc4` |

The 3500A rendering covers the drug sections (A patient, B adverse event, C suspect
products, E initial reporter, G all manufacturers) and states that the device sections (D,
F, H) do not apply. Neither rendering claims to be the official fillable form; each page
says it was rendered by pv-core and names the version hash. Answers the form asks for that
the record does not hold (race and ethnicity, product NDC, expiration date, whether the
reporter also told the FDA) are left blank or marked as not collected, never invented. A rendered PDF is not the record: the version hash is. Recording a
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
