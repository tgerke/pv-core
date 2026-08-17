import { loadFixture } from "@pv-core/core/test-helpers";
import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

/**
 * Dev-mode authentication, authorization, and signing re-auth through the HTTP
 * surface (ADR-0015, ADR-0016). Runs against the seeded dev database; fixtures
 * land under CORC-9999.
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
const READONLY = H("dev-readonly-token");
const INGEST = H("dev-ingest-token");

beforeAll(async () => {
  process.env.AUTH_MODE = "dev";
  app = buildApp(db, sql);
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

describe("dev-mode authentication (§11.10(d))", () => {
  it("refuses requests without a bearer token (401) and unknown tokens", async () => {
    expect((await app.request("/queue")).status).toBe(401);
    expect((await app.request("/queue", { headers: H("nope") })).status).toBe(401);
  });

  it("resolves a token to a person and their grants", async () => {
    const res = await app.request("/me", { headers: REVIEWER });
    expect(res.status).toBe(200);
    const me = (await res.json()) as {
      label: string;
      operations: string[];
      grants: { role: string }[];
    };
    expect(me.label).toMatch(/Priya Raman/);
    expect(me.grants[0]!.role).toBe("medical_reviewer");
    expect(me.operations).toEqual(expect.arrayContaining(["read", "assess", "sign"]));
    expect(me.operations).not.toContain("submit");
  });
});

describe("authorization by grant scope (§11.10(g), ADR-0015)", () => {
  it("a sponsor-scoped reviewer never sees the other sponsor's cases; the unscoped admin sees all", async () => {
    const reviewer = (await (await app.request("/queue", { headers: REVIEWER })).json()) as {
      sender_case_id: string;
    }[];
    const admin = (await (await app.request("/queue", { headers: ADMIN })).json()) as {
      sender_case_id: string;
    }[];
    expect(reviewer.some((r) => r.sender_case_id.startsWith("US-NLB"))).toBe(false);
    expect(admin.some((r) => r.sender_case_id.startsWith("US-NLB"))).toBe(true);
    expect(admin.length).toBeGreaterThan(reviewer.length);
  });

  it("the ingest identity can create a case but read nothing (403)", async () => {
    expect((await app.request("/queue", { headers: INGEST })).status).toBe(403);
    const res = await app.request("/cases", {
      method: "POST",
      headers: INGEST,
      body: JSON.stringify({
        study_id: fx.studyId,
        product_id: fx.productId,
        first_received_date: fx.today,
        source: { system: "edc-core", ref: "SAE-T-1" },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { case_id: string };
    expect((await app.request(`/cases/${created.case_id}`, { headers: INGEST })).status).toBe(403);
  });

  it("read_only cannot write; processors cannot assess or sign; reviewers cannot submit", async () => {
    const created = (await (
      await app.request("/cases", {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({
          study_id: fx.studyId,
          product_id: fx.productId,
          first_received_date: fx.today,
        }),
      })
    ).json()) as { case_id: string; case_version_id: string };
    const v = created.case_version_id;
    expect(
      (
        await app.request(`/case-versions/${v}/sections`, {
          method: "PUT",
          headers: READONLY,
          body: JSON.stringify({ narrative: { narrative: "x" } }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/case-versions/${v}/assessments`, {
          method: "PUT",
          headers: PROCESSOR,
          body: JSON.stringify({ assessments: [] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/case-versions/${v}/sign`, {
          method: "POST",
          headers: PROCESSOR,
          body: JSON.stringify({ meaning: "approval", reauth_token: "dev-processor-token" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/case-versions/${v}/submissions`, {
          method: "POST",
          headers: REVIEWER,
          body: JSON.stringify({
            destination_id: fx.fdaDestinationId,
            kind: "initial_report",
            format: "cioms_i_pdf",
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/reporting-rules", {
          method: "POST",
          headers: PROCESSOR,
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(403);
  });

  it("the anticipated designation is the sponsor's judgment: processors and the intake service get 403, the reviewer 200; only an admin edits the study's list", async () => {
    const created = (await (
      await app.request("/cases", {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({
          study_id: fx.studyId,
          product_id: fx.productId,
          first_received_date: fx.today,
          received_via: "fax",
          received_ref: "FX-2026-0042",
          events: [{ seq: 1, reported_term: "Back pain", llt_code: await fx.llt("Back pain") }],
        }),
      })
    ).json()) as { case_id: string; case_version_id: string };
    const detail = (await (
      await app.request(`/cases/${created.case_id}`, { headers: ADMIN })
    ).json()) as { received_via: string; received_ref: string };
    expect(detail.received_via).toBe("fax");
    expect(detail.received_ref).toBe("FX-2026-0042");
    const body = JSON.stringify({ designations: [{ event_seq: 1, anticipated: false }] });
    for (const headers of [PROCESSOR, INGEST, READONLY]) {
      expect(
        (
          await app.request(`/case-versions/${created.case_version_id}/designations`, {
            method: "PUT",
            headers,
            body,
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await app.request(`/case-versions/${created.case_version_id}/designations`, {
          method: "PUT",
          headers: REVIEWER,
          body,
        })
      ).status,
    ).toBe(200);
    const concept = {
      study_id: fx.studyId,
      label: "API gate test concept",
      plan_reference: "SSP §0",
      effective_from: fx.today,
      dictionary_id: fx.dictionaryId,
      terms: [{ pt_code: "x", pt_term: "Back pain" }],
    };
    for (const headers of [PROCESSOR, REVIEWER]) {
      expect(
        (
          await app.request("/anticipated-events", {
            method: "POST",
            headers,
            body: JSON.stringify(concept),
          })
        ).status,
      ).toBe(403);
    }
    expect((await app.request("/anticipated-events", { headers: READONLY })).status).toBe(200);
    expect(
      (await app.request(`/studies/${fx.studyId}/anticipated-events`, { headers: REVIEWER }))
        .status,
    ).toBe(200);
  });
});

describe("signing re-authentication (§11.200)", () => {
  it("rejects a signing request whose re-authentication does not match the session", async () => {
    const created = (await (
      await app.request("/cases", {
        method: "POST",
        headers: PROCESSOR,
        body: JSON.stringify({
          study_id: fx.studyId,
          product_id: fx.productId,
          first_received_date: fx.today,
          patient: { subject_number: "9999-auth", sex: "male" },
          sources: [
            {
              seq: 1,
              family_name: "R",
              country: "US",
              qualification: "physician",
              is_primary_for_regulatory: true,
            },
          ],
          events: [
            {
              seq: 1,
              reported_term: "Seizure",
              llt_code: await fx.llt("Seizure"),
              serious_hospitalization: true,
            },
          ],
          drugs: [
            { seq: 1, role: "suspect", product_id: fx.productId, name_as_reported: "CORC-101" },
          ],
        }),
      })
    ).json()) as { case_version_id: string };
    const v = created.case_version_id;
    const bad = await app.request(`/case-versions/${v}/sign`, {
      method: "POST",
      headers: REVIEWER,
      body: JSON.stringify({ meaning: "medical_review", reauth_token: "stale" }),
    });
    expect(bad.status).toBe(403);
    const good = await app.request(`/case-versions/${v}/sign`, {
      method: "POST",
      headers: REVIEWER,
      body: JSON.stringify({ meaning: "medical_review", reauth_token: "dev-reviewer-token" }),
    });
    expect(good.status).toBe(201);
    const body = (await good.json()) as { signed_sha256: string };
    expect(body.signed_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The version is now locked (423) for everyone.
    const edit = await app.request(`/case-versions/${v}/sections`, {
      method: "PUT",
      headers: PROCESSOR,
      body: JSON.stringify({ narrative: { narrative: "x" } }),
    });
    expect(edit.status).toBe(423);
  });
});
