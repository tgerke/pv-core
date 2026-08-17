import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnticipatedEvent, createStudy, endAnticipatedEvent } from "./admin.js";
import { createCase, openVersion, signVersion, updateSections } from "./cases.js";
import { CoreError } from "./errors.js";
import { createRule } from "./reporting.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/**
 * Anticipated serious adverse events (FDA, Sponsor Responsibilities: Safety
 * Reporting Requirements and Safety Assessment for IND and BA/BE Studies,
 * December 2025, §III.C, §IV.A.2.a, §V.A, §VI.A; the aggregate-analysis basis
 * is 21 CFR 312.32(c)(1)(i)(C)). The study's list is data, the sponsor's
 * per-event designation is data, and the reporting effect is a rule attribute
 * (excludes_anticipated), so a rule without it (Regulation (EU) 536/2014, ICH
 * E2A) is untouched. Fixture rules and concepts are created once per database
 * (rules and concepts are never deleted) under the fixture study CORC-9999.
 */

const { db, sql } = createDb();
const actor = { label: "vitest anticipated" };
let fx: Fixture;
let conceptId: string;
let excludingRuleName: string;
let plainRuleName: string;

const obligations = async (caseId: string) =>
  (await sql`
    SELECT rule_name, status FROM v_expected_submission_status WHERE case_id = ${caseId} ORDER BY rule_name`) as {
    rule_name: string;
    status: string;
  }[];
const heldBack = async (versionId: string) =>
  (await sql`
    SELECT rule_name, anticipated_labels FROM v_rule_anticipated_exclusion WHERE case_version_id = ${versionId} ORDER BY rule_name`) as {
    rule_name: string;
    anticipated_labels: string;
  }[];
const reportability = async (versionId: string) =>
  (
    await sql`SELECT expedited_class, reason, any_anticipated, all_susar_anticipated FROM v_case_reportability WHERE case_version_id = ${versionId}`
  )[0]!;
const eventVerdict = async (versionId: string) =>
  (
    await sql`SELECT anticipated, anticipated_basis, anticipated_label, anticipated_candidate FROM v_case_event_reportability WHERE case_version_id = ${versionId} AND seq = 1`
  )[0]!;
const versionHash = async (versionId: string) =>
  ((await sql`SELECT pv_case_version_sha256(${versionId}::uuid) AS h`) as { h: string }[])[0]!.h;
const sign = (versionId: string, meaning: "medical_review" | "approval") =>
  signVersion(db, actor, {
    versionId,
    signerPersonId: fx.people.reviewer,
    meaning,
    reauthMethod: "dev_token",
    reauthAt: new Date(),
  });

/** A concept the fixture study lists (once per database). */
async function ensureConcept(label: string, ptName: string, effectiveFrom: string) {
  const [existing] =
    await sql`SELECT id FROM study_anticipated_event WHERE study_id = ${fx.studyId} AND label = ${label} AND effective_to IS NULL`;
  if (existing) return existing.id as string;
  const [pt] =
    await sql`SELECT pt_code, pt_term FROM dictionary_term WHERE dictionary_id = ${fx.dictionaryId} AND pt_term = ${ptName} LIMIT 1`;
  const r = await createAnticipatedEvent(db, actor, {
    studyId: fx.studyId,
    label,
    planReference: "Fixture SSP v1 §1",
    effectiveFrom,
    approvedBy: fx.people.reviewer,
    dictionaryId: fx.dictionaryId,
    terms: [{ ptCode: pt!.pt_code as string, ptTerm: pt!.pt_term as string }],
  });
  return r.id;
}

/** A study-scoped 15-day rule to the FDA destination (once per database). */
async function ensureRule(name: string, excludesAnticipated: boolean) {
  const [existing] =
    await sql`SELECT id FROM reporting_rule WHERE study_id = ${fx.studyId} AND name = ${name}`;
  if (existing) return;
  await createRule(db, actor, {
    studyId: fx.studyId,
    destinationId: fx.fdaDestinationId,
    name,
    citation: "Fixture rule (21 CFR 312.32(c)(1)(i)(C) carve-out under test)",
    reportTypes: ["study"],
    serious: true,
    unexpected: true,
    related: true,
    causalityBasis: "sponsor",
    excludesAnticipated,
    timelineDays: 15,
    satisfyingKinds: ["initial_report"],
    effectiveFrom: fx.day(-400),
  });
}

/** A serious, unexpected (not in the RSI), related back pain case: both parties say related. */
const susarCase = async () =>
  createCase(
    db,
    actor,
    await validCaseInput(fx, {
      event: { ptName: "Back pain" },
      assessments: [
        { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
        { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
      ],
    }),
  );

beforeAll(async () => {
  fx = await loadFixture(sql);
  conceptId = await ensureConcept(
    "Fixture: skeletal complications of bone metastases",
    "Back pain",
    fx.day(-200),
  );
  excludingRuleName = "Fixture FDA 15-day, excludes anticipated (312.32(c)(1)(i)(C))";
  plainRuleName = "Fixture 15-day, no anticipated carve-out";
  await ensureRule(excludingRuleName, true);
  await ensureRule(plainRuleName, false);
});
afterAll(() => sql.end());

describe("anticipated designation and the rule carve-out (FDA Dec 2025 §IV.A.2.a, §V.A; 312.32(c)(1)(i)(C))", () => {
  it("holds back a rule that excludes anticipated events and leaves a rule without the flag owed", async () => {
    const c = await susarCase();
    const before = await obligations(c.caseId);
    expect(before.map((o) => o.rule_name)).toEqual(
      expect.arrayContaining([excludingRuleName, plainRuleName]),
    );
    expect((await eventVerdict(c.caseVersionId)).anticipated_candidate).toBe(true);
    expect((await eventVerdict(c.caseVersionId)).anticipated).toBe(false);

    await updateSections(db, actor, c.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: conceptId }],
    });
    const after = await obligations(c.caseId);
    expect(after.map((o) => o.rule_name)).not.toContain(excludingRuleName);
    expect(after.map((o) => o.rule_name)).toContain(plainRuleName);

    const held = await heldBack(c.caseVersionId);
    expect(held.map((h) => h.rule_name)).toContain(excludingRuleName);
    expect(held.find((h) => h.rule_name === excludingRuleName)!.anticipated_labels).toContain(
      "skeletal complications",
    );
    const v = await eventVerdict(c.caseVersionId);
    expect(v.anticipated).toBe(true);
    expect(v.anticipated_basis).toBe("prespecified");
    expect(v.anticipated_label).toContain("skeletal complications");
  });

  it("keeps the expedited class authority-agnostic: still a 15-day SUSAR, with the reason saying so", async () => {
    const c = await susarCase();
    await updateSections(db, actor, c.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: conceptId }],
    });
    const r = await reportability(c.caseVersionId);
    expect(r.expedited_class).toBe("15d");
    expect(r.reason).toBe("SUSAR; anticipated in the study population (aggregate review)");
    expect(r.any_anticipated).toBe(true);
    expect(r.all_susar_anticipated).toBe(true);
  });

  it("removing the designation re-materializes the obligation", async () => {
    const c = await susarCase();
    await updateSections(db, actor, c.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: conceptId }],
    });
    expect((await obligations(c.caseId)).map((o) => o.rule_name)).not.toContain(excludingRuleName);
    await updateSections(db, actor, c.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: false }],
    });
    expect((await obligations(c.caseId)).map((o) => o.rule_name)).toContain(excludingRuleName);
    expect(await heldBack(c.caseVersionId)).toHaveLength(0);
    expect((await eventVerdict(c.caseVersionId)).anticipated).toBe(false);
  });

  it("an anticipated designation names a concept on this study's list, in effect on the awareness date", async () => {
    const c = await susarCase();
    await expect(
      updateSections(db, actor, c.caseVersionId, {
        designations: [{ eventSeq: 1, anticipated: true }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const future = await ensureConcept("Fixture: concept not yet in effect", "Fall", fx.day(30));
    await expect(
      updateSections(db, actor, c.caseVersionId, {
        designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: future }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      updateSections(db, actor, c.caseVersionId, {
        designations: [{ eventSeq: 1, anticipated: false, anticipatedEventId: conceptId }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("the database guard rejects a concept from another study even when core is bypassed", async () => {
    const [other] = await sql`SELECT id FROM study WHERE protocol_number = 'CORC-9998'`;
    const otherStudyId =
      (other?.id as string | undefined) ??
      (
        await createStudy(db, actor, {
          protocolNumber: "CORC-9998",
          title: "Second fixture study (anticipated-event guard test)",
          sponsorOrgId: fx.sponsorOrgId,
          productIds: [fx.productId],
        })
      ).id;
    const [existing] =
      await sql`SELECT id FROM study_anticipated_event WHERE study_id = ${otherStudyId} AND effective_to IS NULL LIMIT 1`;
    const foreign =
      (existing?.id as string | undefined) ??
      (
        await createAnticipatedEvent(db, actor, {
          studyId: otherStudyId,
          label: "Fixture: other study's concept",
          planReference: "Other SSP §1",
          effectiveFrom: fx.day(-200),
          dictionaryId: fx.dictionaryId,
          terms: [{ ptCode: "x", ptTerm: "Back pain" }],
        })
      ).id;
    const c = await susarCase();
    await expect(
      updateSections(db, actor, c.caseVersionId, {
        designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: foreign }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    const [ev] = await sql`SELECT id FROM case_event WHERE case_version_id = ${c.caseVersionId}`;
    await expect(
      sql`INSERT INTO case_event_designation (case_version_id, case_event_id, anticipated, anticipated_event_id)
          VALUES (${c.caseVersionId}, ${ev!.id}, true, ${foreign})`,
    ).rejects.toThrow(/not on this study/);
  });
});

describe("designations are part of the signed record (ADR-0006, §11.70)", () => {
  it("the version hash changes on designation, a signature binds it, and the lock refuses later changes", async () => {
    const c = await susarCase();
    const h0 = await versionHash(c.caseVersionId);
    await updateSections(db, actor, c.caseVersionId, {
      designations: [
        { eventSeq: 1, anticipated: true, anticipatedEventId: conceptId, rationale: "test" },
      ],
    });
    const h1 = await versionHash(c.caseVersionId);
    expect(h1).not.toBe(h0);
    await sign(c.caseVersionId, "medical_review");
    const [integrity] =
      await sql`SELECT hash_matches FROM v_signature_integrity WHERE case_version_id = ${c.caseVersionId}`;
    expect(integrity!.hash_matches).toBe(true);
    await expect(
      updateSections(db, actor, c.caseVersionId, {
        designations: [{ eventSeq: 1, anticipated: false }],
      }),
    ).rejects.toMatchObject({ code: "locked" });
  });

  it("a follow-up version clones the designation (openVersion) and the sponsor may change it there", async () => {
    const c = await susarCase();
    await updateSections(db, actor, c.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: true, anticipatedEventId: conceptId }],
    });
    await sign(c.caseVersionId, "medical_review");
    await sign(c.caseVersionId, "approval");
    const v2 = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(0),
      createdBy: fx.people.processor,
    });
    const [cloned] =
      await sql`SELECT count(*)::int AS n FROM case_event_designation WHERE case_version_id = ${v2.caseVersionId} AND anticipated`;
    expect(cloned!.n).toBe(1);
    expect((await eventVerdict(v2.caseVersionId)).anticipated).toBe(true);
    await updateSections(db, actor, v2.caseVersionId, {
      designations: [{ eventSeq: 1, anticipated: false }],
    });
    expect((await eventVerdict(v2.caseVersionId)).anticipated).toBe(false);
  });
});

describe("the study's anticipated-event list is governed like the RSI", () => {
  it("a rate never exists without its unit and basis; a concept added during the trial carries a justification", async () => {
    await expect(
      createAnticipatedEvent(db, actor, {
        studyId: fx.studyId,
        label: "Fixture: unsourced rate",
        planReference: "SSP",
        predictedRate: 0.1,
        effectiveFrom: fx.day(-1),
        dictionaryId: fx.dictionaryId,
        terms: [{ ptCode: "x", ptTerm: "Back pain" }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      createAnticipatedEvent(db, actor, {
        studyId: fx.studyId,
        label: "Fixture: during-trial concept without justification",
        prespecified: false,
        effectiveFrom: fx.day(-1),
        dictionaryId: fx.dictionaryId,
        terms: [{ ptCode: "x", ptTerm: "Back pain" }],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("terms are immutable and a concept ends once", async () => {
    const r = await createAnticipatedEvent(db, actor, {
      studyId: fx.studyId,
      label: `Fixture: ends once ${Math.random().toString(36).slice(2, 8)}`,
      prespecified: false,
      justification: "Clinical judgment recorded for the test (FDA Dec 2025 §VI.A).",
      effectiveFrom: fx.day(-1),
      dictionaryId: fx.dictionaryId,
      terms: [{ ptCode: "x", ptTerm: "Back pain" }],
    });
    await expect(
      sql`UPDATE study_anticipated_event_term SET pt_term = 'changed' WHERE anticipated_event_id = ${r.id}`,
    ).rejects.toThrow();
    await expect(
      sql`UPDATE study_anticipated_event SET label = 'changed' WHERE id = ${r.id}`,
    ).rejects.toThrow(/only effective_to/);
    await endAnticipatedEvent(db, actor, r.id, fx.day(0));
    await expect(endAnticipatedEvent(db, actor, r.id, fx.day(1))).rejects.toBeInstanceOf(CoreError);
    await expect(sql`DELETE FROM study_anticipated_event WHERE id = ${r.id}`).rejects.toThrow(
      /never deleted/,
    );
  });
});
