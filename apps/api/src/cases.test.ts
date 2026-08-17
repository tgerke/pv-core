import { loadFixture } from "@pv-core/core/test-helpers";
import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

/**
 * The case lifecycle through the HTTP surface: intake -> valid ICSR ->
 * obligations -> medical review -> approval -> submission with a server-
 * rendered E2B(R3) JSON payload -> acknowledgement -> follow-up (ADR-0006,
 * ADR-0007, ADR-0009, ADR-0013).
 */

const { db, sql } = createDb();
let app: ReturnType<typeof buildApp>;
let fx: Awaited<ReturnType<typeof loadFixture>>;
const H = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});
const ADMIN = H("dev-admin-token");
const PROCESSOR = H("dev-processor-token");
const REVIEWER = H("dev-reviewer-token");
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.AUTH_MODE = "dev";
  app = buildApp(db, sql);
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

describe("case lifecycle over HTTP (E2B(R3) §3.3.1; E2A §III.B; §11.70)", () => {
  it("walks a case from intake to acknowledged submission and a follow-up", async () => {
    // Intake: no reporter yet.
    const created = await j(
      await app.request("/cases", {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({
          study_id: fx.studyId,
          product_id: fx.productId,
          first_received_date: fx.day(-1),
          patient: { subject_number: "9999-http", sex: "male", age_value: 70, age_unit: "years" },
          events: [
            {
              seq: 1,
              reported_term: "Seizure",
              llt_code: await fx.llt("Seizure"),
              serious_hospitalization: true,
              onset_date: fx.day(-3),
              outcome: "recovering",
            },
          ],
          drugs: [
            { seq: 1, role: "suspect", product_id: fx.productId, name_as_reported: "CORC-101" },
          ],
          narrative: { narrative: "HTTP fixture." },
        }),
      }),
    );
    const caseId = created.case_id as string;
    const v1 = created.case_version_id as string;
    let detail = await j(await app.request(`/cases/${caseId}`, { headers: ADMIN }));
    expect(detail.state).toBe("intake");
    expect((detail.versions as { missing: string[] }[])[0]!.missing).toEqual([
      "identifiable reporter",
    ]);
    expect(detail.obligations).toHaveLength(0);

    // Reporter arrives: valid ICSR, 15-day clock materializes (unassessed => related, fail-safe).
    expect(
      (
        await app.request(`/case-versions/${v1}/sections`, {
          method: "PUT",
          headers: PROCESSOR,
          body: JSON.stringify({
            sources: [
              {
                seq: 1,
                family_name: "R",
                country: "US",
                qualification: "physician",
                is_primary_for_regulatory: true,
              },
            ],
          }),
        })
      ).status,
    ).toBe(200);
    detail = await j(await app.request(`/cases/${caseId}`, { headers: ADMIN }));
    expect(detail.state).toBe("data_entry");
    expect(detail.expedited_class).toBe("15d");
    const obligations = detail.obligations as {
      rule_name: string;
      status: string;
      due_date: string;
    }[];
    expect(obligations.find((o) => o.rule_name.startsWith("FDA IND 15-day"))!.due_date).toBe(
      fx.day(14),
    );

    // Assessment, review, signatures.
    expect(
      (
        await app.request(`/case-versions/${v1}/assessments`, {
          method: "PUT",
          headers: REVIEWER,
          body: JSON.stringify({
            assessments: [
              { drug_seq: 1, event_seq: 1, assessor: "sponsor", reasonable_possibility: true },
            ],
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/case-versions/${v1}/transition`, {
          method: "POST",
          headers: PROCESSOR,
          body: JSON.stringify({ to_state: "medical_review" }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request(`/case-versions/${v1}/sign`, {
          method: "POST",
          headers: REVIEWER,
          body: JSON.stringify({ meaning: "medical_review", reauth_token: "dev-reviewer-token" }),
        })
      ).status,
    ).toBe(201);
    // Submission before approval is refused by the database guard.
    expect(
      (
        await app.request(`/case-versions/${v1}/submissions`, {
          method: "POST",
          headers: PROCESSOR,
          body: JSON.stringify({
            destination_id: fx.fdaDestinationId,
            kind: "initial_report",
            format: "e2b_r3_json",
          }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/case-versions/${v1}/sign`, {
          method: "POST",
          headers: REVIEWER,
          body: JSON.stringify({ meaning: "approval", reauth_token: "dev-reviewer-token" }),
        })
      ).status,
    ).toBe(201);

    // Submission: the server renders the E2B(R3) JSON payload and stores it content-addressed.
    const sub = await j(
      await app.request(`/case-versions/${v1}/submissions`, {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({
          destination_id: fx.fdaDestinationId,
          kind: "initial_report",
          format: "e2b_r3_json",
        }),
      }),
    );
    expect(sub.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    const bytes = await app.request(`/files/${sub.payload_sha256}`, { headers: ADMIN });
    expect(bytes.status).toBe(200);
    const payload = (await bytes.json()) as {
      "C.1.1": string;
      meta: { schema_validated: boolean };
    };
    expect(payload["C.1.1"]).toBe(created.sender_case_id);
    expect(payload.meta.schema_validated).toBe(false);
    expect(
      (
        await app.request(`/submissions/${sub.id}/acknowledgement`, {
          method: "POST",
          headers: PROCESSOR,
          body: JSON.stringify({ ack_code: "CA" }),
        })
      ).status,
    ).toBe(201);
    detail = await j(await app.request(`/cases/${caseId}`, { headers: ADMIN }));
    expect(detail.state).toBe("submitted");
    expect((detail.obligations as { status: string; on_time: boolean }[])[0]!.status).toBe(
      "acknowledged",
    );
    expect((detail.obligations as { status: string; on_time: boolean }[])[0]!.on_time).toBe(true);

    // Follow-up: a new open version and a new 15-day obligation.
    const v2 = await j(
      await app.request(`/cases/${caseId}/versions`, {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({ kind: "follow_up", info_received_date: fx.today }),
      }),
    );
    expect(v2.version_number).toBe(2);
    detail = await j(await app.request(`/cases/${caseId}`, { headers: ADMIN }));
    expect(detail.state).toBe("data_entry");
    expect(
      (detail.obligations as { obligation_kind: string; status: string }[]).some(
        (o) => o.obligation_kind === "follow_up" && o.status === "pending",
      ),
    ).toBe(true);

    // The audit trail covers every step and the chain verifies.
    const audit = (await (
      await app.request(`/cases/${caseId}/audit`, { headers: ADMIN })
    ).json()) as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "case.insert",
        "case_source.insert",
        "signature.insert",
        "submission.insert",
        "expected_submission.insert",
      ]),
    );
    const chain = (await (await app.request("/audit-chain/verify", { headers: ADMIN })).json()) as {
      ok: boolean;
    };
    expect(chain.ok).toBe(true);
  });

  it("serves the DSUR views, compliance metrics, and rule matches", async () => {
    for (const path of [
      "/dsur/sar-line-listing",
      "/dsur/sae-summary",
      "/compliance",
      "/reportability",
      "/expected-submissions?status=overdue",
    ]) {
      const res = await app.request(path, { headers: ADMIN });
      expect(res.status, path).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
    const [q] =
      await sql`SELECT latest_version_id FROM v_case_queue WHERE sender_case_id = 'US-CORC-2026-0001'`;
    const matches = (await (
      await app.request(`/case-versions/${q!.latest_version_id}/rule-matches`, { headers: ADMIN })
    ).json()) as { rule_name: string }[];
    expect(matches.map((m) => m.rule_name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/FDA IND 7-day/),
        expect.stringMatching(/EU CTR SUSAR 7-day/),
      ]),
    );
  });

  it("validates bodies and reports zod issues as 400", async () => {
    const res = await app.request("/cases", {
      method: "POST",
      headers: PROCESSOR,
      body: JSON.stringify({ product_id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/product_id/);
  });
});
