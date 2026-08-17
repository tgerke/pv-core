import { createDb } from "@pv-core/db";
import { afterAll, describe, expect, it } from "vitest";

/**
 * DSUR views (ICH E2F §3.7.2 line listing of serious adverse reactions,
 * §3.7.3 cumulative SAE tabulation by SOC and arm) over the seeded studies.
 * Arms come from the unblinding fact or read 'blinded' (ADR-0008, E2A §III.D).
 */

const { sql } = createDb();
afterAll(() => sql.end());

describe("DSUR line listing (ICH E2F §3.7.2)", () => {
  it("lists one row per case under its most serious reaction, ordered by trial, SOC, PT", async () => {
    const rows = (await sql`
      SELECT sender_case_id, protocol_number, soc_term, pt_term, arm_label, expectedness, rsi_label
      FROM v_dsur_sar_line_listing WHERE protocol_number = 'CORC-2201' ORDER BY soc_term, pt_term`) as {
      sender_case_id: string;
      soc_term: string;
      pt_term: string;
      arm_label: string;
      expectedness: string;
      rsi_label: string;
    }[];
    const ids = rows.map((r) => r.sender_case_id);
    expect(new Set(ids).size).toBe(ids.length); // one row per case
    expect(ids).toEqual(
      expect.arrayContaining(["US-CORC-2026-0001", "US-CORC-2026-0004", "US-CORC-2026-0006"]),
    );
    expect(ids).not.toContain("US-CORC-2026-0009"); // intake item, not a valid ICSR
    // A serious expected reaction is a reaction all the same; expectedness is carried, not filtered.
    expect(rows.find((r) => r.sender_case_id === "US-CORC-2026-0004")!.expectedness).toBe(
      "expected",
    );
    expect(rows.find((r) => r.sender_case_id === "US-CORC-2026-0004")!.rsi_label).toBe(
      "IB v2.0 §6.3",
    );
  });

  it("prints the arm only where an unblinding fact exists and 'blinded' otherwise (E2A §III.D)", async () => {
    const rows = (await sql`
      SELECT sender_case_id, arm_label FROM v_dsur_sar_line_listing WHERE protocol_number = 'CORC-2201'`) as {
      sender_case_id: string;
      arm_label: string;
    }[];
    const arm = (id: string) => rows.find((r) => r.sender_case_id === id)?.arm_label;
    expect(arm("US-CORC-2026-0001")).toBe("CORC-101 300 mg BID"); // unblinded for the fatal SUSAR
    expect(arm("US-CORC-2026-0008")).toBe("Placebo"); // unblinded, placebo
    expect(arm("US-CORC-2026-0002")).toBe("blinded");
    const openLabel =
      (await sql`SELECT arm_label FROM v_dsur_sar_line_listing WHERE protocol_number = 'CORC-2202'`) as {
        arm_label: string;
      }[];
    expect(openLabel.every((r) => r.arm_label === "CORC-201")).toBe(true);
  });

  it("excludes nullified cases", async () => {
    const rows =
      await sql`SELECT sender_case_id FROM v_dsur_sar_line_listing WHERE sender_case_id = 'US-CORC-2026-0007'`;
    expect(rows).toHaveLength(0);
  });
});

describe("DSUR cumulative SAE tabulation (ICH E2F §3.7.3)", () => {
  it("counts serious events, cases, and reactions by SOC and arm", async () => {
    const rows = (await sql`
      SELECT soc_term, arm_label, event_count::int AS event_count, case_count::int AS case_count, reaction_count::int AS reaction_count
      FROM v_dsur_sae_summary WHERE protocol_number = 'CORC-2201' ORDER BY soc_term, arm_label`) as {
      soc_term: string;
      arm_label: string;
      event_count: number;
      case_count: number;
      reaction_count: number;
    }[];
    const resp = rows.filter((r) => r.soc_term.startsWith("Respiratory"));
    expect(resp.reduce((n, r) => n + r.event_count, 0)).toBeGreaterThanOrEqual(1); // ILD; the intake PE is excluded
    const blood = rows.filter((r) => r.soc_term.startsWith("Blood"));
    expect(blood.map((r) => r.arm_label).sort()).toEqual(["Placebo", "blinded"]);
    for (const r of rows) expect(r.reaction_count).toBeLessThanOrEqual(r.event_count);
  });
});
