import { describe, expect, it } from "vitest";
import { type Grant, permits, readableScope } from "./authz.js";

/** Grants scope to a sponsor organization, a study, or nothing (ADR-0015); roles map to operations (ADR-0016). */

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const STUDY = "33333333-3333-3333-3333-333333333333";

describe("authorization over grants (ADR-0015, ADR-0016)", () => {
  it("a sponsor-scoped reviewer assesses that sponsor's studies and no others", () => {
    const grants: Grant[] = [{ role: "medical_reviewer", organization_id: ORG, study_id: null }];
    expect(permits(grants, "assess", { studyId: STUDY, sponsorOrgId: ORG })).toBe(true);
    expect(permits(grants, "assess", { studyId: STUDY, sponsorOrgId: OTHER_ORG })).toBe(false);
    expect(permits(grants, "submit", { studyId: STUDY, sponsorOrgId: ORG })).toBe(false);
  });

  it("a study-scoped processor enters and submits for that study only", () => {
    const grants: Grant[] = [{ role: "case_processor", organization_id: null, study_id: STUDY }];
    expect(permits(grants, "enter", { studyId: STUDY, sponsorOrgId: ORG })).toBe(true);
    expect(permits(grants, "submit", { studyId: STUDY, sponsorOrgId: ORG })).toBe(true);
    expect(
      permits(grants, "enter", {
        studyId: "44444444-4444-4444-4444-444444444444",
        sponsorOrgId: ORG,
      }),
    ).toBe(false);
    expect(permits(grants, "sign", { studyId: STUDY, sponsorOrgId: ORG })).toBe(false);
  });

  it("the ingest identity enters and never reads, assesses, signs, or submits", () => {
    const grants: Grant[] = [{ role: "ingest", organization_id: ORG, study_id: null }];
    expect(permits(grants, "enter", { studyId: STUDY, sponsorOrgId: ORG })).toBe(true);
    for (const op of ["read", "assess", "sign", "submit", "administer"] as const) {
      expect(permits(grants, op, { studyId: STUDY, sponsorOrgId: ORG })).toBe(false);
    }
  });

  it("an unscoped admin does everything; read_only reads and nothing else", () => {
    expect(
      permits([{ role: "admin", organization_id: null, study_id: null }], "administer", {}),
    ).toBe(true);
    const ro: Grant[] = [{ role: "read_only", organization_id: null, study_id: null }];
    expect(permits(ro, "read", { studyId: STUDY, sponsorOrgId: OTHER_ORG })).toBe(true);
    expect(permits(ro, "enter", {})).toBe(false);
  });

  it("readableScope narrows list queries to the grants' sponsors and studies", () => {
    expect(readableScope([{ role: "admin", organization_id: null, study_id: null }]).all).toBe(
      true,
    );
    const s = readableScope([
      { role: "medical_reviewer", organization_id: ORG, study_id: null },
      { role: "case_processor", organization_id: null, study_id: STUDY },
      { role: "ingest", organization_id: OTHER_ORG, study_id: null },
    ]);
    expect(s.all).toBe(false);
    expect(s.sponsorOrgIds).toEqual([ORG]);
    expect(s.studyIds).toEqual([STUDY]);
  });
});
