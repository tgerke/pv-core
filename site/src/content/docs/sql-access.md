---
title: "Direct SQL access"
---

The `v_*` views are documented public API, not internals. The REST API is `SELECT`s over
these views, so a read-only Postgres connection reads exactly the derived truth the app
shows: no export step, no sync job, no drift.

## The read-only role

Migration 0002 creates a SQL role with SELECT-only privileges that cannot read the arm
columns at rest ([ADR-0008](/pv-core/decisions/#adr-0008)):

| | |
| --- | --- |
| host | `localhost` |
| port | `5436` |
| database | `pv` |
| user / password | `pv_readonly` / `pv_readonly` |

:::note
These are dev credentials for the local Docker instance, kept deliberately guessable. A
deployment rotates them (`ALTER ROLE`).
:::

## The views

| View | One row per | What it answers |
| --- | --- | --- |
| `v_case_queue` | case | Derived state, expedited class and reason, next due date, open and overdue counts, flags |
| `v_case_minimum_criteria` | case version | The four E2B(R3) §3.3.1 criteria and which are missing |
| `v_case_event_reportability` | event | Serious, fatal or life-threatening, expectedness with its basis and RSI version, causality per assessor |
| `v_case_reportability` | case version | Expedited class (7d / 15d / none) and the reason in words |
| `v_rule_match` | version × rule | Which rules apply to which versions, and their day zero |
| `v_expected_submission_status` | obligation | Rule, destination, due date, and the derived status |
| `v_dsur_sar_line_listing` | case | ICH E2F §3.7.2 line listing under the most serious reaction |
| `v_dsur_sae_summary` | study × SOC × arm | ICH E2F §3.7.3 cumulative tabulation |
| `v_reporting_compliance` | study × destination | Closed, on time, late, overdue open, on-time percentage |
| `v_signature_integrity` | signature | The signed hash and the hash recomputed now |

## From R

```r
con <- DBI::dbConnect(RPostgres::Postgres(), dbname = "pv", host = "localhost",
                      port = 5436, user = "pv_readonly", password = "pv_readonly")
dplyr::tbl(con, "v_expected_submission_status") |>
  dplyr::filter(status %in% c("overdue", "due_soon")) |>
  dplyr::collect()
```

Treat view columns like endpoint fields: additive changes are safe, renames and removals
are breaking and will be announced.
