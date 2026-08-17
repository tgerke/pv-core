import type { Sql } from "@pv-core/db";
import type { CreateCaseInput, EventInput } from "./cases.js";

/**
 * Shared fixtures for the core and API tests. Everything lands under the
 * seeded fixture study CORC-9999 (never in the demo views); immutable rows
 * accumulate across runs by design (ADR-0003), so nothing here cleans up.
 */

export interface Fixture {
  studyId: string;
  sponsorOrgId: string;
  productId: string; // CORC-101, whose RSI lists Anaemia/Nausea/Fatigue/Neutropenia/Thrombocytopenia (+ Pneumonitis from v2.0)
  dictionaryId: string;
  fdaDestinationId: string;
  people: Record<"admin" | "processor" | "reviewer" | "readonly" | "ingest", string>;
  llt: (ptName: string) => Promise<string>;
  today: string;
  day: (offset: number) => string;
}

export async function loadFixture(sql: Sql): Promise<Fixture> {
  const [study] =
    await sql`SELECT id, sponsor_org_id FROM study WHERE protocol_number = 'CORC-9999'`;
  if (!study) throw new Error("run pnpm db:seed first (CORC-9999 fixture study missing)");
  const [product] = await sql`SELECT id FROM product WHERE name = 'CORC-101'`;
  const [dict] = await sql`SELECT value FROM app_meta WHERE key = 'meddra_default_dictionary_id'`;
  const [fda] = await sql`SELECT id FROM reporting_destination WHERE name LIKE 'FDA%' LIMIT 1`;
  const emails = {
    admin: "dana.whitfield@cascade-cro.example",
    processor: "marcus.lee@cascade-cro.example",
    reviewer: "priya.raman@corc.example",
    readonly: "sam.okafor@cascade-cro.example",
    ingest: "edc.intake@corc.example",
  } as const;
  const people = {} as Fixture["people"];
  for (const [k, email] of Object.entries(emails)) {
    const [p] = await sql`SELECT id FROM person WHERE email = ${email}`;
    people[k as keyof typeof emails] = p!.id as string;
  }
  const today = ((await sql`SELECT CURRENT_DATE::text AS today`) as { today: string }[])[0]!.today;
  const day = (offset: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const dictionaryId = dict!.value as string;
  return {
    studyId: study.id as string,
    sponsorOrgId: study.sponsor_org_id as string,
    productId: product!.id as string,
    dictionaryId,
    fdaDestinationId: fda!.id as string,
    people,
    llt: async (ptName: string) => {
      const [t] =
        await sql`SELECT code FROM dictionary_term WHERE dictionary_id = ${dictionaryId} AND pt_term = ${ptName} AND term = ${ptName}`;
      if (!t) throw new Error(`demo dictionary has no term ${ptName}`);
      return t.code as string;
    },
    today,
    day,
  };
}

/** A complete, valid ICSR (E2B(R3) §3.3.1) with one serious event; override what a test needs. */
export async function validCaseInput(
  fx: Fixture,
  overrides: Partial<CreateCaseInput> & { event?: Partial<EventInput> & { ptName?: string } } = {},
): Promise<CreateCaseInput> {
  const { event, ...rest } = overrides;
  const ptName = event?.ptName ?? "Seizure";
  const lltCode = await fx.llt(ptName);
  return {
    studyId: fx.studyId,
    productId: fx.productId,
    firstReceivedDate: fx.day(-2),
    createdBy: fx.people.processor,
    patient: {
      subjectNumber: `9999-${Math.random().toString(36).slice(2, 8)}`,
      sex: "male",
      ageValue: 66,
      ageUnit: "years",
    },
    sources: [
      {
        seq: 1,
        givenName: "Test",
        familyName: "Investigator",
        organization: "Fixture Site",
        country: "US",
        qualification: "physician",
        isPrimaryForRegulatory: true,
      },
    ],
    events: [
      {
        seq: 1,
        reportedTerm: ptName,
        lltCode,
        seriousHospitalization: true,
        onsetDate: fx.day(-5),
        outcome: "recovering",
        ...(event ?? {}),
      },
    ],
    drugs: [
      {
        seq: 1,
        role: "suspect",
        productId: fx.productId,
        nameAsReported: "CORC-101",
        doseText: "300 mg BID",
      },
    ],
    narrative: { narrative: "Fixture case." },
    ...rest,
  };
}
