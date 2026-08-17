import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, updateSections } from "./cases.js";
import { collectDigest, renderDigest } from "./digest.js";
import { createRule } from "./reporting.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/**
 * Investigator and sponsor causality opinions coexist and both travel with the
 * report (E2B(R3) IG §G.k.9.i; Regulation (EU) 536/2014 Annex III §2.1 ¶4:
 * the sponsor never downgrades the investigator's assessment; ICH E2F
 * §3.7.2(l): the DSUR comment carries the sponsor's position when it differs).
 * Disagreement is derived, never stored or adjudicated. Which opinion clocks a
 * rule is the rule's causality_basis: 'sponsor' for the FDA IND rules (21 CFR
 * 312.32(c)(1)(i), FDA Sponsor Responsibilities Dec 2025 §IV.A), 'either' for
 * ICH E2A §III.A.1 and the EU rules.
 */

const { db, sql } = createDb();
const actor = { label: "vitest disagreement" };
let fx: Fixture;
const SPONSOR_RULE = "Fixture 15-day on the sponsor's causality (312.32(c)(1)(i))";
const EITHER_RULE = "Fixture 15-day on either party's causality (E2A §III.A.1)";

async function ensureRule(name: string, causalityBasis: "sponsor" | "either") {
  const [existing] =
    await sql`SELECT id FROM reporting_rule WHERE study_id = ${fx.studyId} AND name = ${name}`;
  if (existing) return;
  await createRule(db, actor, {
    studyId: fx.studyId,
    destinationId: fx.fdaDestinationId,
    name,
    reportTypes: ["study"],
    serious: true,
    unexpected: true,
    related: true,
    causalityBasis,
    timelineDays: 15,
    satisfyingKinds: ["initial_report"],
    effectiveFrom: fx.day(-400),
  });
}

const eventVerdict = async (versionId: string) =>
  (
    await sql`SELECT reporter_related, sponsor_related, related_either, causality_disagreement FROM v_case_event_reportability WHERE case_version_id = ${versionId} AND seq = 1`
  )[0]!;
const owed = async (caseId: string) =>
  (
    (await sql`SELECT rule_name FROM v_expected_submission_status WHERE case_id = ${caseId}`) as {
      rule_name: string;
    }[]
  ).map((r) => r.rule_name);

beforeAll(async () => {
  fx = await loadFixture(sql);
  await ensureRule(SPONSOR_RULE, "sponsor");
  await ensureRule(EITHER_RULE, "either");
});
afterAll(() => sql.end());

describe("investigator vs sponsor causality (Annex III §2.1; E2A §III.A; E2F §3.7)", () => {
  it("both opinions are kept side by side and the disagreement is derived, not stored", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Acute kidney injury" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
          {
            drugSeq: 1,
            eventSeq: 1,
            assessor: "sponsor",
            reasonablePossibility: false,
            causalityResult:
              "Not related: dehydration after diarrhoea; creatinine recovered without dose change",
          },
        ],
      }),
    );
    const v = await eventVerdict(c.caseVersionId);
    expect(v.reporter_related).toBe(true);
    expect(v.sponsor_related).toBe(false);
    expect(v.related_either).toBe(true);
    expect(v.causality_disagreement).toBe(true);
    const rows =
      await sql`SELECT assessor, reasonable_possibility FROM case_assessment WHERE case_version_id = ${c.caseVersionId} ORDER BY assessor`;
    expect(rows.map((r) => [r.assessor, r.reasonable_possibility])).toEqual([
      ["reporter", true],
      ["sponsor", false],
    ]);
    const [q] =
      await sql`SELECT any_causality_disagreement FROM v_case_queue WHERE case_id = ${c.caseId}`;
    expect(q!.any_causality_disagreement).toBe(true);
  });

  it("clocks a rule on the sponsor's opinion (312.32(c)(1)(i)) or on either party's (E2A §III.A) as the rule says", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Acute kidney injury" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: false },
        ],
      }),
    );
    const names = await owed(c.caseId);
    expect(names).toContain(EITHER_RULE);
    expect(names).not.toContain(SPONSOR_RULE);

    // The sponsor changes its mind: the sponsor-basis rule now applies too.
    await updateSections(db, actor, c.caseVersionId, {
      assessments: [
        { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
        { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
      ],
    });
    expect(await owed(c.caseId)).toEqual(expect.arrayContaining([EITHER_RULE, SPONSOR_RULE]));
    expect((await eventVerdict(c.caseVersionId)).causality_disagreement).toBe(false);
  });

  it("an unassessed side is not a disagreement, and the fail-safe still treats it as related", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Acute kidney injury" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: false },
        ],
      }),
    );
    const v = await eventVerdict(c.caseVersionId);
    expect(v.causality_disagreement).toBe(false);
    expect(v.sponsor_related).toBe(true);
    expect(await owed(c.caseId)).toContain(SPONSOR_RULE);
  });

  it("the DSUR line listing carries the sponsor's comment only when it disagrees (E2F §3.7.2(l))", async () => {
    const disagreeing = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Acute kidney injury" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: false },
        ],
      }),
    );
    const agreeing = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        event: { ptName: "Acute kidney injury" },
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "reporter", reasonablePossibility: true },
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    const comment = async (caseId: string) =>
      (
        (await sql`SELECT sponsor_comment FROM v_dsur_sar_line_listing WHERE case_id = ${caseId}`) as {
          sponsor_comment: string | null;
        }[]
      )[0]?.sponsor_comment;
    expect(await comment(disagreeing.caseId)).toBe(
      "Sponsor disagrees with the reporter: investigator related, sponsor not related",
    );
    expect(await comment(agreeing.caseId)).toBeNull();
  });

  it("the digest lists the disagreement as an action item", async () => {
    const d = await collectDigest(sql, fx.studyId);
    expect(d.disagreement.length).toBeGreaterThan(0);
    const { text } = renderDigest(d);
    expect(text).toContain("Investigator and sponsor differ on causality");
  });
});
