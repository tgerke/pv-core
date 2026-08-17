import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProduct, createStudy } from "./admin.js";
import { createCase, updateSections } from "./cases.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/**
 * Expectedness is derived against the RSI version in effect at event onset
 * (Reg. 536/2014 Annex III §2.2(8); ICH E2A §II.C), overridable by a recorded
 * sponsor judgment with a rationale (E2A §II.C.2), and fail-safe unexpected
 * when no RSI is in effect. The seeded CORC-101 RSI: v1.0 (day -300..-43)
 * without Pneumonitis, v2.0 (day -42..) with it.
 */

const { db, sql } = createDb();
const actor = { label: "vitest expectedness" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

const verdict = async (versionId: string) =>
  (
    await sql`SELECT expectedness, expectedness_basis, rsi_label FROM v_case_event_reportability WHERE case_version_id = ${versionId}`
  )[0]!;

describe("expectedness against the RSI in effect at onset (E2A §II.C; Reg. 536/2014 Annex III §2.2(8))", () => {
  it("a term listed only in the later RSI is unexpected for an onset before that version took effect", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, { event: { ptName: "Pneumonitis", onsetDate: fx.day(-60) } }),
    );
    const v = await verdict(c.caseVersionId);
    expect(v.expectedness).toBe("unexpected");
    expect(v.expectedness_basis).toBe("rsi_not_listed");
    expect(v.rsi_label).toBe("IB v1.0 §6.3");
  });

  it("and expected once the listing RSI is in effect at onset", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, { event: { ptName: "Pneumonitis", onsetDate: fx.day(-10) } }),
    );
    const v = await verdict(c.caseVersionId);
    expect(v.expectedness).toBe("expected");
    expect(v.expectedness_basis).toBe("rsi_listed");
    expect(v.rsi_label).toBe("IB v2.0 §6.3");
  });

  it("a sponsor override with a rationale wins (E2A §II.C.2)", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, { event: { ptName: "Anaemia" } }),
    );
    expect((await verdict(c.caseVersionId)).expectedness).toBe("expected");
    await updateSections(db, actor, c.caseVersionId, {
      assessments: [
        {
          drugSeq: 1,
          eventSeq: 1,
          assessor: "sponsor",
          reasonablePossibility: true,
          expectednessOverride: "unexpected",
          expectednessRationale:
            "Grade 4 with transfusion exceeds the listed severity (E2A §II.C.2)",
        },
      ],
    });
    const v = await verdict(c.caseVersionId);
    expect(v.expectedness).toBe("unexpected");
    expect(v.expectedness_basis).toBe("override");
  });

  it("no RSI in effect: unexpected, fail-safe, with the basis saying so", async () => {
    const product = await createProduct(db, actor, {
      sponsorOrgId: fx.sponsorOrgId,
      name: `NORSI-${Date.now()}`,
    });
    const study = await createStudy(db, actor, {
      protocolNumber: `CORC-9998-${Date.now()}`,
      title: "No-RSI fixture",
      sponsorOrgId: fx.sponsorOrgId,
      productIds: [product.id],
    });
    const c = await createCase(db, actor, {
      ...(await validCaseInput(fx)),
      studyId: study.id,
      productId: product.id,
      drugs: [{ seq: 1, role: "suspect", productId: product.id, nameAsReported: "NORSI" }],
    });
    const v = await verdict(c.caseVersionId);
    expect(v.expectedness).toBe("unexpected");
    expect(v.expectedness_basis).toBe("no_rsi_in_effect");
  });
});
