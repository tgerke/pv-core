import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, openVersion, signVersion, updateSections } from "./cases.js";
import { recordSubmission, waiveObligation } from "./reporting.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/**
 * The reporting-obligation engine (ADR-0007) against the seeded rules for the
 * fixture sponsor: FDA IND 7-day (21 CFR 312.32(c)(2); ICH E2A §III.B.1),
 * FDA IND 15-day (312.32(c)(1); E2A §III.B.2), FDA follow-up (312.32(d)), FDA
 * nullification. Due dates are calendar days from the awareness date.
 */

const { db, sql } = createDb();
const actor = { label: "vitest engine" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

const obligations = async (caseId: string) =>
  (await sql`
    SELECT rule_name, obligation_kind, clock_start_date::text AS day0, due_date::text AS due, status
    FROM v_expected_submission_status WHERE case_id = ${caseId} ORDER BY due_date, rule_name`) as {
    rule_name: string;
    obligation_kind: string;
    day0: string;
    due: string;
    status: string;
  }[];
const reportability = async (versionId: string) =>
  (
    await sql`SELECT expedited_class, reason, causality_assessed FROM v_case_reportability WHERE case_version_id = ${versionId}`
  )[0]!;
const sign = (versionId: string, meaning: "medical_review" | "approval") =>
  signVersion(db, actor, {
    versionId,
    signerPersonId: fx.people.reviewer,
    meaning,
    reauthMethod: "dev_token",
    reauthAt: new Date(),
  });

describe("expedited clocks (ICH E2A §III.B; 21 CFR 312.32(c)(1)-(2))", () => {
  it("fatal, unexpected, related: a 7-day and a 15-day obligation from the awareness date", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        firstReceivedDate: fx.day(-1),
        awarenessDate: fx.day(-1),
        event: { seriousDeath: true, seriousHospitalization: true, outcome: "fatal" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    const r = await reportability(c.caseVersionId);
    expect(r.expedited_class).toBe("7d");
    expect(r.reason).toBe("fatal/life-threatening SUSAR");
    const obs = await obligations(c.caseId);
    const seven = obs.find((o) => o.rule_name.startsWith("FDA IND 7-day"))!;
    const fifteen = obs.find((o) => o.rule_name.startsWith("FDA IND 15-day"))!;
    expect(seven.day0).toBe(fx.day(-1));
    expect(seven.due).toBe(fx.day(6));
    expect(fifteen.due).toBe(fx.day(14));
    expect(seven.status).toBe("pending");
  });

  it("serious, unexpected, related but not fatal: 15-day only", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    expect((await reportability(c.caseVersionId)).expedited_class).toBe("15d");
    const names = (await obligations(c.caseId)).map((o) => o.rule_name);
    expect(names.some((n) => n.startsWith("FDA IND 15-day"))).toBe(true);
    expect(names.some((n) => n.startsWith("FDA IND 7-day"))).toBe(false);
  });

  it("serious but expected (listed in the RSI in effect): no expedited obligation (E2A §III.A.1)", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Anaemia" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    const r = await reportability(c.caseVersionId);
    expect(r.expedited_class).toBe("none");
    expect(r.reason).toBe("serious but expected");
    expect(await obligations(c.caseId)).toHaveLength(0);
  });

  it("non-serious: nothing", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, { event: { seriousHospitalization: false, ptName: "Nausea" } }),
    );
    expect((await reportability(c.caseVersionId)).reason).toBe("non-serious");
    expect(await obligations(c.caseId)).toHaveLength(0);
  });

  it("not related by both reporter and sponsor: nothing", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: false },
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: false },
        ],
      }),
    );
    expect((await reportability(c.caseVersionId)).reason).toBe(
      "not related (reporter and sponsor)",
    );
    expect(await obligations(c.caseId)).toHaveLength(0);
  });

  it("unassessed causality is treated as related (fail-safe, ADR-0007) and flagged", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    const r = await reportability(c.caseVersionId);
    expect(r.expedited_class).toBe("15d");
    expect(r.causality_assessed).toBe(false);
  });

  it("re-syncing is idempotent and a change that removes reportability removes the undischarged obligation", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    expect((await obligations(c.caseId)).length).toBeGreaterThan(0);
    await sql`SELECT pv_sync_expected_submissions(${c.caseVersionId}::uuid)`;
    const n = (await obligations(c.caseId)).length;
    await sql`SELECT pv_sync_expected_submissions(${c.caseVersionId}::uuid)`;
    expect((await obligations(c.caseId)).length).toBe(n);
    // Sponsor and reporter say not related: the obligation is no longer owed.
    await updateSections(db, actor, c.caseVersionId, {
      assessments: [
        { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: false },
        { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: false },
      ],
    });
    expect(await obligations(c.caseId)).toHaveLength(0);
  });
});

describe("follow-ups and discharge (21 CFR 312.32(d); Reg. 536/2014 Annex III §2.4)", () => {
  it("a submitted initial obligation is discharged; a follow-up version opens a new 15-day obligation from its own day zero", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        firstReceivedDate: fx.day(-10),
        awarenessDate: fx.day(-10),
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    await sign(c.caseVersionId, "approval");
    await recordSubmission(db, actor, {
      caseVersionId: c.caseVersionId,
      destinationId: fx.fdaDestinationId,
      kind: "initial_report",
      format: "cioms_i_pdf",
      sentBy: fx.people.processor,
    });
    let obs = await obligations(c.caseId);
    expect(obs.find((o) => o.rule_name.startsWith("FDA IND 15-day"))!.status).toBe("submitted");
    const v2 = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(-1),
      createdBy: fx.people.processor,
    });
    obs = await obligations(c.caseId);
    const fu = obs.find((o) => o.obligation_kind === "follow_up")!;
    expect(fu.day0).toBe(fx.day(-1));
    expect(fu.due).toBe(fx.day(14));
    expect(fu.status).toBe("pending");
    // The initial obligation keeps its own history.
    expect(
      obs.find((o) => o.rule_name.startsWith("FDA IND 15-day") && o.obligation_kind === "initial")!
        .status,
    ).toBe("submitted");
    expect(v2.versionNumber).toBe(2);
  });

  it("an initial obligation the latest version no longer triggers reads superseded_by_follow_up", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    await sign(c.caseVersionId, "approval");
    const v2 = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(0),
      createdBy: fx.people.processor,
    });
    await updateSections(db, actor, v2.caseVersionId, {
      assessments: [
        { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: false },
        { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: false },
      ],
    });
    const obs = await obligations(c.caseId);
    expect(obs.find((o) => o.obligation_kind === "initial")!.status).toBe(
      "superseded_by_follow_up",
    );
  });

  it("a waiver reads not_required (E2A §III.E.1 placebo, protocol-defined endpoints)", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    const [es] = await sql`SELECT id FROM expected_submission WHERE case_id = ${c.caseId} LIMIT 1`;
    await waiveObligation(db, actor, {
      expectedSubmissionId: es!.id as string,
      reason: "placebo after unblinding",
      by: fx.people.reviewer,
    });
    expect(
      (await obligations(c.caseId)).every(
        (o) => o.status === "not_required" || o.status === "pending",
      ),
    ).toBe(true);
    const [w] =
      await sql`SELECT status FROM v_expected_submission_status WHERE expected_submission_id = ${es!.id}`;
    expect(w!.status).toBe("not_required");
  });
});
