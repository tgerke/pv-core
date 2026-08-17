import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase } from "./cases.js";
import { renderCiomsI, renderMedWatch3500A } from "./forms.js";
import { dechallenge, loadVersionSnapshot, primaryEvent, rechallenge } from "./snapshot.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/**
 * Regulatory form renderings (ADR-0012): CIOMS I and Form FDA 3500A rendered
 * from a version, carrying the version hash. The field lists come from the
 * official documents (see forms.ts header); these tests check the renderer
 * runs on real data and that the derived answers (dechallenge, rechallenge,
 * most serious event) follow the record.
 */

const { db, sql } = createDb();
const actor = { label: "vitest forms" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";

describe("regulatory form renderings (ADR-0012)", () => {
  it("renders CIOMS I and Form FDA 3500A as PDFs from a version", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    const cioms = await renderCiomsI(sql, c.caseVersionId);
    const medwatch = await renderMedWatch3500A(sql, c.caseVersionId);
    expect(isPdf(cioms)).toBe(true);
    expect(isPdf(medwatch)).toBe(true);
    expect(cioms.byteLength).toBeGreaterThan(1000);
    expect(medwatch.byteLength).toBeGreaterThan(1000);
  });

  it("derives dechallenge and rechallenge from the record, and picks the most serious event", async () => {
    const c = await createCase(db, actor, {
      ...(await validCaseInput(fx)),
      events: [
        { seq: 1, reportedTerm: "Nausea", lltCode: await fx.llt("Nausea"), outcome: "recovered" },
        {
          seq: 2,
          reportedTerm: "Seizure",
          lltCode: await fx.llt("Seizure"),
          seriousHospitalization: true,
          outcome: "recovered",
          onsetDate: fx.day(-4),
        },
      ],
      drugs: [
        {
          seq: 1,
          role: "suspect",
          productId: fx.productId,
          nameAsReported: "CORC-101",
          actionTaken: "drug_withdrawn",
        },
      ],
      assessments: [
        {
          drugSeq: 1,
          eventSeq: 2,
          assessor: "sponsor",
          reasonablePossibility: true,
          rechallenge: "did_not_recur",
        },
      ],
    });
    const s = await loadVersionSnapshot(sql, c.caseVersionId);
    expect(primaryEvent(s)?.reported_term).toBe("Seizure");
    expect(dechallenge(s)).toBe("YES");
    expect(rechallenge(s)).toBe("NO");
    expect(s.versionSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to render an unknown version", async () => {
    await expect(renderCiomsI(sql, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /not found/,
    );
  });
});
