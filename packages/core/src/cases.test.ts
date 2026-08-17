import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCase,
  nullifyCase,
  openVersion,
  signVersion,
  updateSections,
  updateVersionHeader,
} from "./cases.js";
import { CoreError } from "./errors.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/** Versions lock on signature; follow-ups and corrections are new versions (ADR-0006). */

const { db, sql } = createDb();
const actor = { label: "vitest cases" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

const sign = (versionId: string, meaning: "medical_review" | "approval" = "approval") =>
  signVersion(db, actor, {
    versionId,
    signerPersonId: fx.people.reviewer,
    meaning,
    reauthMethod: "dev_token",
    reauthAt: new Date(),
  });

describe("case versions lock on signature (ADR-0006, §11.70)", () => {
  it("edits succeed while unsigned and are refused with 'locked' after the first signature", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    await updateSections(db, actor, c.caseVersionId, {
      narrative: { narrative: "edited before signing" },
    });
    await sign(c.caseVersionId, "medical_review");
    const err = await updateSections(db, actor, c.caseVersionId, {
      narrative: { narrative: "edited after signing" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect((err as CoreError).code).toBe("locked");
    const hdr = await updateVersionHeader(db, actor, c.caseVersionId, {
      awarenessDate: fx.day(-3),
      awarenessRationale: "late",
    }).catch((e) => e);
    expect((hdr as CoreError).code).toBe("locked");
  });

  it("a follow-up cannot open while the latest version is unsigned; once signed it clones the children", async () => {
    const c = await createCase(
      db,
      actor,
      await validCaseInput(fx, {
        assessments: [
          { drugSeq: 1, eventSeq: 1, assessor: "sponsor", reasonablePossibility: true },
        ],
      }),
    );
    const early = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(0),
      createdBy: fx.people.processor,
    }).catch((e) => e);
    expect((early as CoreError).code).toBe("conflict");
    await sign(c.caseVersionId);
    const v2 = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(0),
      createdBy: fx.people.processor,
    });
    const [counts] = await sql`
      SELECT (SELECT count(*) FROM case_event WHERE case_version_id = ${v2.caseVersionId})::int AS events,
             (SELECT count(*) FROM case_drug WHERE case_version_id = ${v2.caseVersionId})::int AS drugs,
             (SELECT count(*) FROM case_assessment WHERE case_version_id = ${v2.caseVersionId})::int AS assessments,
             (SELECT count(*) FROM case_source WHERE case_version_id = ${v2.caseVersionId})::int AS sources,
             (SELECT narrative FROM case_narrative WHERE case_version_id = ${v2.caseVersionId}) AS narrative`;
    expect(counts!.events).toBe(1);
    expect(counts!.drugs).toBe(1);
    expect(counts!.assessments).toBe(1);
    expect(counts!.sources).toBe(1);
    expect(counts!.narrative).toBe("Fixture case.");
    // The clone is editable; the original stays locked.
    await updateSections(db, actor, v2.caseVersionId, {
      narrative: { narrative: "follow-up text" },
    });
    const [state] = await sql`SELECT state FROM v_case_queue WHERE case_id = ${c.caseId}`;
    expect(state!.state).toBe("data_entry");
  });

  it("nullification is a fact that blocks further versions and signatures", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    await sign(c.caseVersionId);
    await nullifyCase(db, actor, { caseId: c.caseId, reason: "duplicate", by: fx.people.reviewer });
    const [q] = await sql`SELECT state, is_nullified FROM v_case_queue WHERE case_id = ${c.caseId}`;
    expect(q!.state).toBe("nullified");
    const again = await openVersion(db, actor, {
      caseId: c.caseId,
      kind: "follow_up",
      infoReceivedDate: fx.day(0),
      createdBy: fx.people.processor,
    }).catch((e) => e);
    expect((again as CoreError).code).toBe("conflict");
  });

  it("the sender case id is CC-org-year-number and doubles as the worldwide id (C.1.1, C.1.8.1)", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    expect(c.senderCaseId).toMatch(/^US-CORC-\d{4}-\d{4}$/);
    expect(c.worldwideUniqueId).toBe(c.senderCaseId);
  });
});
