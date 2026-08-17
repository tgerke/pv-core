import type { Db } from "@pv-core/db";
import {
  caseVersion,
  expectedSubmission,
  expectedSubmissionWaiver,
  reportingRule,
  submission,
  submissionAcknowledgement,
} from "@pv-core/db";
import { eq, sql } from "drizzle-orm";
import { type Actor, withActor } from "./actor.js";
import { addAttachment } from "./attachments.js";
import { syncVersion, versionHash } from "./cases.js";
import { CoreError, fromPgError } from "./errors.js";

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw fromPgError(err) ?? err;
  }
}

export type ObligationKind = "initial" | "follow_up" | "nullification";
export type SubmissionKind =
  | "initial_notification"
  | "initial_report"
  | "follow_up_report"
  | "amendment"
  | "nullification"
  | "notification_letter";
export type SubmissionFormat =
  | "cioms_i_pdf"
  | "medwatch_3500a_pdf"
  | "e2b_r3_json"
  | "portal_manual"
  | "email";

export interface RuleInput {
  sponsorOrgId?: string | null;
  studyId?: string | null;
  productId?: string | null;
  destinationId: string;
  name: string;
  citation?: string | null;
  reportTypes?: string[] | null;
  versionKinds?: string[] | null;
  obligationKind?: ObligationKind;
  serious?: boolean | null;
  unexpected?: boolean | null;
  related?: boolean | null;
  fatalOrLifeThreatening?: boolean | null;
  causalityBasis?: "either" | "sponsor" | "reporter";
  /** An event the sponsor designated anticipated in the study population does not satisfy this rule. */
  excludesAnticipated?: boolean;
  requiresPriorSubmission?: boolean;
  timelineDays: number;
  dueSoonDays?: number;
  satisfyingKinds: SubmissionKind[];
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/** Rules are rows (ADR-0007): create one, never edit a timeline in place. */
export async function createRule(db: Db, actor: Actor, input: RuleInput): Promise<{ id: string }> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [row] = await tx
        .insert(reportingRule)
        .values({
          sponsorOrgId: input.sponsorOrgId ?? null,
          studyId: input.studyId ?? null,
          productId: input.productId ?? null,
          destinationId: input.destinationId,
          name: input.name,
          citation: input.citation ?? null,
          reportTypes: input.reportTypes ?? null,
          versionKinds: input.versionKinds ?? null,
          obligationKind: input.obligationKind ?? "initial",
          serious: input.serious ?? null,
          unexpected: input.unexpected ?? null,
          related: input.related ?? null,
          fatalOrLifeThreatening: input.fatalOrLifeThreatening ?? null,
          causalityBasis: input.causalityBasis ?? "either",
          excludesAnticipated: input.excludesAnticipated ?? false,
          requiresPriorSubmission: input.requiresPriorSubmission ?? false,
          timelineDays: input.timelineDays,
          dueSoonDays: input.dueSoonDays ?? 3,
          satisfyingKinds: input.satisfyingKinds,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
        })
        .returning({ id: reportingRule.id });
      return { id: row!.id };
    }),
  );
}

/** End a rule: the one permitted mutation. */
export async function endRule(
  db: Db,
  actor: Actor,
  ruleId: string,
  effectiveTo: string,
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [r] = await tx
        .select({ id: reportingRule.id, effectiveTo: reportingRule.effectiveTo })
        .from(reportingRule)
        .where(eq(reportingRule.id, ruleId))
        .limit(1);
      if (!r) throw new CoreError("not_found", "rule not found");
      if (r.effectiveTo) throw new CoreError("conflict", "rule already ended");
      await tx.update(reportingRule).set({ effectiveTo }).where(eq(reportingRule.id, ruleId));
    }),
  );
}

/** Re-materialize every open version's obligations (nightly re-sync, rule changes). */
export async function resyncAll(db: Db, actor: Actor): Promise<number> {
  return withActor(db, actor, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT ON (cv.case_id) cv.id FROM case_version cv ORDER BY cv.case_id, cv.version_number DESC`);
    let n = 0;
    for (const r of rows) n += await syncVersion(tx, r.id as string);
    return n;
  });
}

export interface WaiverInput {
  expectedSubmissionId: string;
  reason: string;
  by: string;
}

export async function waiveObligation(
  db: Db,
  actor: Actor,
  input: WaiverInput,
): Promise<{ id: string }> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [es] = await tx
        .select({ id: expectedSubmission.id })
        .from(expectedSubmission)
        .where(eq(expectedSubmission.id, input.expectedSubmissionId))
        .limit(1);
      if (!es) throw new CoreError("not_found", "obligation not found");
      const [row] = await tx
        .insert(expectedSubmissionWaiver)
        .values({
          expectedSubmissionId: input.expectedSubmissionId,
          waivedBy: input.by,
          reason: input.reason,
        })
        .returning({ id: expectedSubmissionWaiver.id });
      return { id: row!.id };
    }),
  );
}

export async function revokeWaiver(
  db: Db,
  actor: Actor,
  input: { waiverId: string; reason: string; by: string },
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [w] = await tx
        .select({ id: expectedSubmissionWaiver.id, revokedAt: expectedSubmissionWaiver.revokedAt })
        .from(expectedSubmissionWaiver)
        .where(eq(expectedSubmissionWaiver.id, input.waiverId))
        .limit(1);
      if (!w) throw new CoreError("not_found", "waiver not found");
      if (w.revokedAt) throw new CoreError("conflict", "waiver already revoked");
      await tx
        .update(expectedSubmissionWaiver)
        .set({ revokedBy: input.by, revokedAt: new Date(), revokeReason: input.reason })
        .where(eq(expectedSubmissionWaiver.id, input.waiverId));
    }),
  );
}

export interface SubmissionInput {
  caseVersionId: string;
  destinationId: string;
  kind: SubmissionKind;
  format: SubmissionFormat;
  sentBy: string;
  sentAt?: Date;
  /** The exact bytes sent (rendered PDF, E2B JSON, letter). Stored content-addressed. */
  payload?: { bytes: Uint8Array; fileName: string; mimeType: string } | null;
  messageId?: string | null;
  transmissionRef?: string | null;
  note?: string | null;
}

/**
 * Record what was sent. The database requires an approval signature bound to
 * the version's current hash and copies that hash onto the row.
 */
export async function recordSubmission(
  db: Db,
  actor: Actor,
  input: SubmissionInput,
): Promise<{ id: string; payloadSha256: string | null }> {
  return guarded(async () => {
    const [v] = await db
      .select({ caseId: caseVersion.caseId })
      .from(caseVersion)
      .where(eq(caseVersion.id, input.caseVersionId))
      .limit(1);
    if (!v) throw new CoreError("not_found", "case version not found");
    let payloadSha256: string | null = null;
    if (input.payload) {
      const a = await addAttachment(db, actor, {
        caseId: v.caseId,
        caseVersionId: input.caseVersionId,
        kind: "submission_payload",
        fileName: input.payload.fileName,
        mimeType: input.payload.mimeType,
        bytes: input.payload.bytes,
        uploadedBy: input.sentBy,
      });
      payloadSha256 = a.sha256;
    }
    return withActor(db, actor, async (tx) => {
      const [row] = await tx
        .insert(submission)
        .values({
          caseVersionId: input.caseVersionId,
          destinationId: input.destinationId,
          kind: input.kind,
          format: input.format,
          sentAt: input.sentAt ?? new Date(),
          sentBy: input.sentBy,
          payloadSha256,
          caseVersionSha256: await versionHash(tx, input.caseVersionId),
          messageId: input.messageId ?? null,
          transmissionRef: input.transmissionRef ?? null,
          note: input.note ?? null,
        })
        .returning({ id: submission.id });
      return { id: row!.id, payloadSha256 };
    });
  });
}

export interface AckInput {
  submissionId: string;
  ackCode: "AA" | "AE" | "AR" | "CA" | "CR" | "manual_receipt";
  ackMessageId?: string | null;
  errorText?: string | null;
  receivedAt?: Date;
  recordedBy: string;
}

export async function recordAcknowledgement(
  db: Db,
  actor: Actor,
  input: AckInput,
): Promise<{ id: string }> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [s] = await tx
        .select({ id: submission.id })
        .from(submission)
        .where(eq(submission.id, input.submissionId))
        .limit(1);
      if (!s) throw new CoreError("not_found", "submission not found");
      const [row] = await tx
        .insert(submissionAcknowledgement)
        .values({
          submissionId: input.submissionId,
          receivedAt: input.receivedAt ?? new Date(),
          ackCode: input.ackCode,
          ackMessageId: input.ackMessageId ?? null,
          errorText: input.errorText ?? null,
          recordedBy: input.recordedBy,
        })
        .returning({ id: submissionAcknowledgement.id });
      return { id: row!.id };
    }),
  );
}
