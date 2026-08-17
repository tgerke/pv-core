# API guide

The API is the product (ADR-0002). The web app consumes only this API, with no private
endpoints or backdoors, so anything the UI can show, a script can query. The OpenAPI 3.1
spec is generated from the same zod schemas that validate requests:
`http://localhost:8789/openapi.json`, interactive reference at
`http://localhost:8789/docs`.

## Principles

1. **Resources are the relational model**: studies, products and their RSI versions, cases
   and versions, events, drugs, assessments, obligations, submissions, acknowledgements,
   attachments, signatures, audit events. Element names follow ICH E2B(R3) where the
   standard has one.
2. **Derived status is served, never stored**: `/queue`, `/expected-submissions`,
   `/reportability`, and the DSUR endpoints return the same views the database computes
   (docs/02-data-model.md); two clients can never disagree.
3. **Every mutation is attributable**: the bearer token resolves to a person; that person
   lands on every audit event the mutation produces.
4. **Auditability is an endpoint**: `/audit-events`, `/cases/{id}/audit`,
   `/audit-chain/verify`, and `/signature-integrity` expose the trail and its integrity
   checks.
5. **The clock is explainable**: `/case-versions/{id}/rule-matches` answers "why does this
   rule apply to this case" from the same predicate the engine uses, and lists the rules a
   sponsor's anticipated designation held back (`excluded_reason: "anticipated"`) so a
   missing clock is explained rather than absent.

Auth: `Authorization: Bearer <token>`. Two modes, selected by `AUTH_MODE`:

- **`dev`**: static tokens from `.env.example` (`dev-admin-token`, `dev-processor-token`,
  `dev-reviewer-token`, `dev-readonly-token`, `dev-ingest-token`) map to seeded people. Demo
  only.
- **`oidc`**: the token is a JWT from your identity provider (`OIDC_ISSUER`,
  `OIDC_AUDIENCE`); its verified email claim resolves to a person record. Any
  OIDC-compliant IdP works (Okta, Entra ID, Auth0, Keycloak). Machine identities
  (client-credentials tokens with no email claim) resolve by subject instead, via
  `API_SERVICE_SUBJECTS`.

Either way the identity must hold an `access_grant` row: roles (`admin`, `case_processor`,
`medical_reviewer`, `read_only`, `ingest`) map to operations (read / enter / assess / sign /
submit / administer), scoped to a sponsor organization, to one study, or unscoped
(ADR-0015). Denials are 403 and name the missing permission. `GET /me` returns the
caller's person, grants, and permitted operations, so a client can decide which surface
to render. `ingest` is enter-only: a source system pushes cases in and reads nothing back.

## The safety physician's morning, from R

The test of "usable by a data-science team": every open clock across the studies you can
read, as one tidy data frame, overdue first.

```r
library(httr2)
library(dplyr)

pv <- function(path, ..., token = "dev-reviewer-token") {
  request("http://localhost:8789") |>
    req_url_path_append(path, ...) |>
    req_auth_bearer_token(token) |>
    req_perform() |>
    resp_body_json(simplifyVector = TRUE) |>
    as_tibble()
}

df_obligations <- pv("expected-submissions") |>
  filter(status %in% c("overdue", "due_soon", "pending")) |>
  select(sender_case_id, protocol_number, destination_name, rule_name,
         clock_start_date, due_date, days_remaining, status) |>
  arrange(days_remaining)

df_obligations
#> # A tibble: 8 × 8
#>   sender_case_id    protocol_number destination_name  … days_remaining status
#>   US-CORC-2026-0002 CORC-2201       FDA CDER (IND …)  …             -5 overdue
#>   US-CORC-2026-0001 CORC-2201       FDA CDER (IND …)  …              3 due_soon
```

Why is that first case overdue? Ask the engine, not a person:

```r
df_queue <- pv("queue")
overdue  <- df_queue |> filter(sender_case_id == "US-CORC-2026-0002")
pv("case-versions", overdue$latest_version_id, "rule-matches") |>
  select(rule_name, citation, clock_start_date, timeline_days)
```

## The DSUR line listing, from R

ICH E2F §3.7.2 asks for serious adverse reactions by trial, SOC, and Preferred Term over
the reporting period. That is one call and one `gt` table:

```r
library(gt)

study_id <- pv("studies") |> filter(protocol_number == "CORC-2201") |> pull(id)

gt_sar <- pv("studies", study_id, "dsur", "sar-line-listing") |>
  select(sender_case_id, subject_number, arm_label, soc_term, pt_term,
         onset_date, outcome, sponsor_related, expectedness, rsi_label) |>
  gt(groupname_col = "soc_term") |>
  tab_header(title = "CORC-2201: serious adverse reactions (interval)")
```

Add `?from=YYYY-MM-DD&to=YYYY-MM-DD` to cut by receipt date. `dsur/sae-summary` gives the
§3.7.3 tabulation by SOC and arm; blinded cases read `blinded` in the arm column.

## Recording what was sent, from R

Every mutation is the same shape as the UI's: a POST with a JSON body. Recording a
submission needs the `submit` operation and an approved version; the server refuses
otherwise (409), copies the version hash onto the row, and, for `e2b_r3_json`, renders and
stores the exact bytes it sent.

```r
sub <- request("http://localhost:8789") |>
  req_url_path_append("case-versions", version_id, "submissions") |>
  req_auth_bearer_token("dev-processor-token") |>
  req_body_json(list(destination_id = fda_id, kind = "initial_report",
                     format = "e2b_r3_json")) |>
  req_perform() |>
  resp_body_json()

request("http://localhost:8789") |>
  req_url_path_append("submissions", sub$id, "acknowledgement") |>
  req_auth_bearer_token("dev-processor-token") |>
  req_body_json(list(ack_code = "CA")) |>
  req_perform()
```

Signing (`POST /case-versions/{id}/sign`) additionally needs `reauth_token`: in OIDC mode
a freshly issued token for the same subject, in dev mode the bearer token restated.

## Read-only SQL

The `v_*` views are public API. A `pv_readonly` connection (docs/05-deployment.md) reads
the same derived truth the endpoints serve, and never the arm columns at rest:

```r
con <- DBI::dbConnect(RPostgres::Postgres(), dbname = "pv", host = "localhost",
                      port = 5436, user = "pv_readonly", password = "pv_readonly")
DBI::dbGetQuery(con, "SELECT protocol_number, destination_name, pct_on_time, overdue_open
                      FROM v_reporting_compliance ORDER BY 1, 2")
```

## Sponsor judgments: assessments and anticipated designations

- `PUT /case-versions/{id}/assessments`: the drug-by-event causality rows for both
  assessors, expectedness overrides with rationale. Gated `assess`.
- `PUT /case-versions/{id}/designations`: the sponsor's per-event designation as
  anticipated in the study population (naming a concept on the study's list) or not.
  Gated `assess`, never accepted on `POST /cases`; the clock resyncs and the version hash
  covers the designations (ADR-0019).
- `GET /anticipated-events`, `GET /studies/{id}/anticipated-events`: each study's list of
  anticipated serious adverse events with their preferred terms, plan reference or
  justification, and predicted rate with its basis when one was recorded.
  `POST /anticipated-events` (administer, scope from `study_id` in the body) adds a concept;
  `POST /anticipated-events/{id}/end` ends one. Concepts are never edited or deleted.
- `POST /reporting-rules` accepts `excludes_anticipated` and `causality_basis`, the two
  attributes that decide whether an FDA IND rule sees a designated event and whose
  causality opinion starts its clock (ADR-0020).
- `POST /cases` accepts `received_via` (`email` | `fax` | `phone` | `edc_push` | `other`)
  and `received_ref`, the human provenance of a report; a machine push also carries
  `source`.

## Renderings, exports, and the digest

- `GET /case-versions/{id}/cioms1.pdf` and `/medwatch-3500a.pdf`: CIOMS I and Form FDA
  3500A rendered from the version, the version hash in the footer (ADR-0012).
- `GET /case-versions/{id}/e2b.json`: the E2B(R3)-shaped export keyed by element IDs
  (ADR-0009; not schema-validated XML).
- `GET /files/{sha256}`: the bytes behind any attachment or stored payload, scoped to the
  case that holds them (documented informally; binary response).
- `GET /studies/{id}/digest`: the reminders digest as `pnpm digest` would mail it, with
  its derived recipient list (ADR-0014). Two sections were added in this pass: cases where
  the investigator and sponsor differ on causality (an action item) and anticipated SAEs
  held from individual IND reporting (informational, with their other open obligations).

## Errors

JSON `{ "error": "..." }` with the status the domain implies: 400 invalid input, 401
missing or invalid credential, 403 the operation is not permitted for this scope, 404
not found, 409 a rule of the record refuses (a follow-up while the latest version is
open, a submission without an approval signature, a second nullification), 423 the
version is locked by a signature.
