import type { Db } from "@pv-core/db";
import {
  accessGrant,
  organization,
  person,
  product,
  productRsiVersion,
  reportingDestination,
  rsiListedTerm,
  site,
  study,
  studyAnticipatedEvent,
  studyAnticipatedEventTerm,
  studyProduct,
  studySite,
} from "@pv-core/db";
import { eq, sql } from "drizzle-orm";
import { type Actor, withActor } from "./actor.js";
import type { AccessRole } from "./authz.js";
import { CoreError, fromPgError } from "./errors.js";

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw fromPgError(err) ?? err;
  }
}

export async function createOrganization(
  db: Db,
  actor: Actor,
  input: { name: string; kind: "sponsor" | "cro" | "site_org" },
) {
  return guarded(() =>
    withActor(
      db,
      actor,
      async (tx) =>
        (await tx.insert(organization).values(input).returning({ id: organization.id }))[0]!,
    ),
  );
}

export interface StudyInput {
  protocolNumber: string;
  title: string;
  phase?: string | null;
  status?: "planning" | "active" | "closed";
  sponsorOrgId: string;
  indNumber?: string | null;
  euCtNumber?: string | null;
  isBlinded?: boolean;
  studyType?: "clinical_trial" | "individual_patient_use" | "other_study";
  productIds?: string[];
}

export async function createStudy(db: Db, actor: Actor, input: StudyInput) {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [row] = await tx
        .insert(study)
        .values({
          protocolNumber: input.protocolNumber,
          title: input.title,
          phase: input.phase ?? null,
          status: input.status ?? "planning",
          sponsorOrgId: input.sponsorOrgId,
          indNumber: input.indNumber ?? null,
          euCtNumber: input.euCtNumber ?? null,
          isBlinded: input.isBlinded ?? false,
          studyType: input.studyType ?? "clinical_trial",
        })
        .returning({ id: study.id });
      for (const productId of input.productIds ?? []) {
        await tx.insert(studyProduct).values({ studyId: row!.id, productId, role: "imp" });
      }
      return row!;
    }),
  );
}

export async function updateStudyStatus(
  db: Db,
  actor: Actor,
  studyId: string,
  status: "planning" | "active" | "closed",
) {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [s] = await tx
        .select({ id: study.id })
        .from(study)
        .where(eq(study.id, studyId))
        .limit(1);
      if (!s) throw new CoreError("not_found", "study not found");
      await tx.update(study).set({ status }).where(eq(study.id, studyId));
    }),
  );
}

export async function createSite(
  db: Db,
  actor: Actor,
  input: {
    organizationId: string;
    name: string;
    city?: string | null;
    country: string;
    studyId?: string;
    siteNumber?: string;
  },
) {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [row] = await tx
        .insert(site)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          city: input.city ?? null,
          country: input.country,
        })
        .returning({ id: site.id });
      let studySiteId: string | null = null;
      if (input.studyId && input.siteNumber) {
        const [ss] = await tx
          .insert(studySite)
          .values({
            studyId: input.studyId,
            siteId: row!.id,
            siteNumber: input.siteNumber,
            status: "active",
          })
          .returning({ id: studySite.id });
        studySiteId = ss!.id;
      }
      return { id: row!.id, studySiteId };
    }),
  );
}

export async function createProduct(
  db: Db,
  actor: Actor,
  input: {
    sponsorOrgId: string;
    name: string;
    substance?: string | null;
    kind?: "investigational" | "marketed";
  },
) {
  return guarded(() =>
    withActor(
      db,
      actor,
      async (tx) =>
        (
          await tx
            .insert(product)
            .values({
              sponsorOrgId: input.sponsorOrgId,
              name: input.name,
              substance: input.substance ?? null,
              kind: input.kind ?? "investigational",
            })
            .returning({ id: product.id })
        )[0]!,
    ),
  );
}

export interface RsiVersionInput {
  productId: string;
  label: string;
  effectiveFrom: string;
  approvedBy?: string | null;
  documentSha256?: string | null;
  dictionaryId: string;
  listedTerms: { ptCode: string; ptTerm: string; listednessNote?: string | null }[];
  /** End the currently open version the day before this one starts. */
  endPrevious?: boolean;
}

/** A new RSI version with its listed terms; optionally ends the previous one. */
export async function createRsiVersion(db: Db, actor: Actor, input: RsiVersionInput) {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      if (input.endPrevious) {
        // effective_to is the one permitted mutation (0001 guard).
        await tx.execute(sql`
          UPDATE product_rsi_version SET effective_to = (${input.effectiveFrom}::date - 1)
          WHERE product_id = ${input.productId} AND effective_to IS NULL AND effective_from < ${input.effectiveFrom}::date`);
      }
      const [row] = await tx
        .insert(productRsiVersion)
        .values({
          productId: input.productId,
          label: input.label,
          effectiveFrom: input.effectiveFrom,
          approvedBy: input.approvedBy ?? null,
          documentSha256: input.documentSha256 ?? null,
        })
        .returning({ id: productRsiVersion.id });
      if (input.listedTerms.length > 0) {
        await tx.insert(rsiListedTerm).values(
          input.listedTerms.map((t) => ({
            rsiVersionId: row!.id,
            dictionaryId: input.dictionaryId,
            ptCode: t.ptCode,
            ptTerm: t.ptTerm,
            listednessNote: t.listednessNote ?? null,
          })),
        );
      }
      return row!;
    }),
  );
}

export async function endRsiVersion(
  db: Db,
  actor: Actor,
  rsiVersionId: string,
  effectiveTo: string,
) {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [v] = await tx
        .select({ id: productRsiVersion.id, effectiveTo: productRsiVersion.effectiveTo })
        .from(productRsiVersion)
        .where(eq(productRsiVersion.id, rsiVersionId))
        .limit(1);
      if (!v) throw new CoreError("not_found", "RSI version not found");
      if (v.effectiveTo) throw new CoreError("conflict", "RSI version already ended");
      await tx
        .update(productRsiVersion)
        .set({ effectiveTo })
        .where(eq(productRsiVersion.id, rsiVersionId));
    }),
  );
}

export type AnticipatedRateUnit = "per_100_participant_years" | "proportion";

/**
 * A serious adverse event anticipated in the study population, as listed in
 * the safety surveillance plan (FDA IND safety reporting guidance, December
 * 2025, §V.A): one medical concept, its Preferred Terms, and, when the plan
 * states one, the predicted rate with its basis. A concept added during the
 * trial (§VI.A) is not prespecified and carries the clinical justification.
 */
export interface AnticipatedEventInput {
  studyId: string;
  label: string;
  prespecified?: boolean;
  planReference?: string | null;
  justification?: string | null;
  predictedRate?: number | null;
  rateUnit?: AnticipatedRateUnit | null;
  rateBasis?: string | null;
  effectiveFrom: string;
  approvedBy?: string | null;
  dictionaryId: string;
  terms: { ptCode: string; ptTerm: string }[];
}

export async function createAnticipatedEvent(db: Db, actor: Actor, input: AnticipatedEventInput) {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      if (input.terms.length === 0)
        throw new CoreError("invalid", "an anticipated event names at least one Preferred Term");
      const [row] = await tx
        .insert(studyAnticipatedEvent)
        .values({
          studyId: input.studyId,
          label: input.label,
          prespecified: input.prespecified ?? true,
          planReference: input.planReference ?? null,
          justification: input.justification ?? null,
          predictedRate: input.predictedRate == null ? null : String(input.predictedRate),
          rateUnit: input.rateUnit ?? null,
          rateBasis: input.rateBasis ?? null,
          effectiveFrom: input.effectiveFrom,
          approvedBy: input.approvedBy ?? null,
        })
        .returning({ id: studyAnticipatedEvent.id });
      await tx.insert(studyAnticipatedEventTerm).values(
        input.terms.map((t) => ({
          anticipatedEventId: row!.id,
          dictionaryId: input.dictionaryId,
          ptCode: t.ptCode,
          ptTerm: t.ptTerm,
        })),
      );
      return row!;
    }),
  );
}

export async function endAnticipatedEvent(
  db: Db,
  actor: Actor,
  anticipatedEventId: string,
  effectiveTo: string,
) {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [v] = await tx
        .select({ id: studyAnticipatedEvent.id, effectiveTo: studyAnticipatedEvent.effectiveTo })
        .from(studyAnticipatedEvent)
        .where(eq(studyAnticipatedEvent.id, anticipatedEventId))
        .limit(1);
      if (!v) throw new CoreError("not_found", "anticipated event not found");
      if (v.effectiveTo) throw new CoreError("conflict", "anticipated event already ended");
      await tx
        .update(studyAnticipatedEvent)
        .set({ effectiveTo })
        .where(eq(studyAnticipatedEvent.id, anticipatedEventId));
    }),
  );
}

export async function createDestination(
  db: Db,
  actor: Actor,
  input: {
    sponsorOrgId?: string | null;
    name: string;
    kind: "regulator" | "ethics_committee" | "investigator_group" | "partner";
    country?: string | null;
    e2bReceiverId?: string | null;
    defaultFormat?:
      | "cioms_i_pdf"
      | "medwatch_3500a_pdf"
      | "e2b_r3_json"
      | "portal_manual"
      | "email";
  },
) {
  return guarded(() =>
    withActor(
      db,
      actor,
      async (tx) =>
        (
          await tx
            .insert(reportingDestination)
            .values({
              sponsorOrgId: input.sponsorOrgId ?? null,
              name: input.name,
              kind: input.kind,
              country: input.country ?? null,
              e2bReceiverId: input.e2bReceiverId ?? null,
              defaultFormat: input.defaultFormat ?? "cioms_i_pdf",
            })
            .returning({ id: reportingDestination.id })
        )[0]!,
    ),
  );
}

export async function createPerson(
  db: Db,
  actor: Actor,
  input: { givenName: string; familyName: string; email: string; credentials?: string | null },
) {
  return guarded(() =>
    withActor(
      db,
      actor,
      async (tx) =>
        (
          await tx
            .insert(person)
            .values({
              givenName: input.givenName,
              familyName: input.familyName,
              email: input.email,
              credentials: input.credentials ?? null,
            })
            .returning({ id: person.id })
        )[0]!,
    ),
  );
}

export async function grantAccess(
  db: Db,
  actor: Actor,
  input: {
    personId: string;
    role: AccessRole;
    organizationId?: string | null;
    studyId?: string | null;
  },
) {
  return guarded(() =>
    withActor(
      db,
      actor,
      async (tx) =>
        (
          await tx
            .insert(accessGrant)
            .values({
              personId: input.personId,
              role: input.role,
              organizationId: input.organizationId ?? null,
              studyId: input.studyId ?? null,
            })
            .returning({ id: accessGrant.id })
        )[0]!,
    ),
  );
}

export async function revokeAccess(db: Db, actor: Actor, grantId: string) {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [g] = await tx
        .select({ id: accessGrant.id, revokedAt: accessGrant.revokedAt })
        .from(accessGrant)
        .where(eq(accessGrant.id, grantId))
        .limit(1);
      if (!g) throw new CoreError("not_found", "grant not found");
      if (g.revokedAt) throw new CoreError("conflict", "grant already revoked");
      await tx
        .update(accessGrant)
        .set({ revokedAt: new Date() })
        .where(eq(accessGrant.id, grantId));
    }),
  );
}
