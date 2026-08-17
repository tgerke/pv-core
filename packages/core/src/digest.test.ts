import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attentionCount, collectDigest, digestRecipients, renderDigest } from "./digest.js";

/** The reminders digest is a stateless rendering of the derived views (ADR-0014). */

const { sql } = createDb();
let corc2201: string;
let nlb301: string;
beforeAll(async () => {
  const [a] = await sql`SELECT id FROM study WHERE protocol_number = 'CORC-2201'`;
  const [b] = await sql`SELECT id FROM study WHERE protocol_number = 'NLB-301'`;
  corc2201 = a!.id as string;
  nlb301 = b!.id as string;
});
afterAll(() => sql.end());

describe("reminders digest (ADR-0014)", () => {
  it("collects overdue and due-soon obligations, intake items, and stale reviews from the views", async () => {
    const d = await collectDigest(sql, corc2201);
    expect(d.overdue.map((o) => o.sender_case_id)).toContain("US-CORC-2026-0002");
    expect(d.dueSoon.map((o) => o.sender_case_id)).toContain("US-CORC-2026-0001");
    expect(d.intake.map((c) => c.sender_case_id)).toContain("US-CORC-2026-0009");
    expect(d.awaitingReview.map((c) => c.sender_case_id)).toContain("US-CORC-2026-0002");
    expect(d.chain.valid).toBe(true);
    expect(attentionCount(d)).toBeGreaterThan(0);
    const { subject, text } = renderDigest(d);
    expect(subject).toMatch(/CORC-2201 safety digest: \d+ items need attention/);
    expect(text).toMatch(/Overdue submissions \(3\)/);
    expect(text).toMatch(/5 days overdue/);
    expect(text).toMatch(/Audit chain verified/);
  });

  it("addresses the people whose grants cover the study, and only them", async () => {
    const corc = (await digestRecipients(sql, corc2201)).map((r) => r.email);
    expect(corc).toEqual(
      expect.arrayContaining([
        "dana.whitfield@cascade-cro.example",
        "marcus.lee@cascade-cro.example",
        "priya.raman@corc.example",
      ]),
    );
    expect(corc).not.toContain("sam.okafor@cascade-cro.example"); // read-only auditor
    expect(corc).not.toContain("edc.intake@corc.example"); // intake service
    expect(corc).not.toContain("wei.zhang@northlake.example"); // the other sponsor
    expect(corc).not.toContain("elena.ortiz@cascade-cro.example"); // scoped to CORC-2202
    const nlb = (await digestRecipients(sql, nlb301)).map((r) => r.email);
    expect(nlb).toContain("wei.zhang@northlake.example");
    expect(nlb).not.toContain("priya.raman@corc.example");
  });
});
