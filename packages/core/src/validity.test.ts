import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, signVersion, transitionVersion, updateSections } from "./cases.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/** Minimum valid ICSR (ICH E2B(R3) IG §3.3.1) and what it gates. */

const { db, sql } = createDb();
const actor = { label: "vitest validity" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

const criteria = async (versionId: string) =>
  (await sql`SELECT * FROM v_case_minimum_criteria WHERE case_version_id = ${versionId}`)[0]!;
const state = async (caseId: string) =>
  (await sql`SELECT state FROM v_case_queue WHERE case_id = ${caseId}`)[0]!.state as string;

describe("minimum criteria for a valid ICSR (E2B(R3) §3.3.1)", () => {
  it("an intake item without a reporter is not valid, has no clock, and shows as intake", async () => {
    const c = await createCase(db, actor, { ...(await validCaseInput(fx)), sources: [] });
    const mc = await criteria(c.caseVersionId);
    expect(mc.minimum_criteria_met).toBe(false);
    expect(mc.missing).toEqual(["identifiable reporter"]);
    expect(await state(c.caseId)).toBe("intake");
    const obs = await sql`SELECT 1 FROM expected_submission WHERE case_id = ${c.caseId}`;
    expect(obs).toHaveLength(0);
  });

  it("no medical review, signature, or submission before validity", async () => {
    const c = await createCase(db, actor, { ...(await validCaseInput(fx)), sources: [] });
    await expect(
      transitionVersion(db, actor, {
        versionId: c.caseVersionId,
        toState: "medical_review",
        by: fx.people.processor,
      }),
    ).rejects.toThrow(/minimum criteria/);
    await expect(
      signVersion(db, actor, {
        versionId: c.caseVersionId,
        signerPersonId: fx.people.reviewer,
        meaning: "approval",
        reauthMethod: "dev_token",
        reauthAt: new Date(),
      }),
    ).rejects.toThrow(/minimum criteria/);
  });

  it("adding the reporter makes it valid and materializes the clock", async () => {
    const c = await createCase(db, actor, { ...(await validCaseInput(fx)), sources: [] });
    await updateSections(db, actor, c.caseVersionId, {
      sources: [
        {
          seq: 1,
          familyName: "Late",
          country: "US",
          qualification: "physician",
          isPrimaryForRegulatory: true,
        },
      ],
    });
    expect((await criteria(c.caseVersionId)).minimum_criteria_met).toBe(true);
    expect(await state(c.caseId)).toBe("data_entry");
    const obs = await sql`SELECT 1 FROM expected_submission WHERE case_id = ${c.caseId}`;
    expect(obs.length).toBeGreaterThan(0);
  });

  it("a case with only concomitant drugs is not valid (needs a suspect or interacting drug)", async () => {
    const c = await createCase(db, actor, {
      ...(await validCaseInput(fx)),
      drugs: [{ seq: 1, role: "concomitant", nameAsReported: "Enzalutamide" }],
    });
    expect((await criteria(c.caseVersionId)).missing).toEqual(["at least one suspect drug"]);
  });
});
