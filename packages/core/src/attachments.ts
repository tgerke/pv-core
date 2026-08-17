import type { Db, Sql } from "@pv-core/db";
import { caseAttachment, getBlob, putBlob } from "@pv-core/db";
import { type Actor, withActor } from "./actor.js";
import { CoreError, fromPgError } from "./errors.js";

export type AttachmentKind = "source_document" | "correspondence" | "submission_payload";

export interface AttachmentInput {
  caseId: string;
  caseVersionId?: string | null;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  uploadedBy: string;
  sourceSystem?: string | null;
  sourceRef?: string | null;
}

/**
 * Store bytes content-addressed and record the immutable attachment row
 * (ADR-0013). Identical bytes deduplicate by construction.
 */
export async function addAttachment(
  db: Db,
  actor: Actor,
  input: AttachmentInput,
): Promise<{ id: string; sha256: string; sizeBytes: number }> {
  const { sha256, sizeBytes } = await putBlob(input.bytes);
  try {
    return await withActor(db, actor, async (tx) => {
      const [row] = await tx
        .insert(caseAttachment)
        .values({
          caseId: input.caseId,
          caseVersionId: input.caseVersionId ?? null,
          kind: input.kind,
          sha256,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes,
          uploadedBy: input.uploadedBy,
          sourceSystem: input.sourceSystem ?? null,
          sourceRef: input.sourceRef ?? null,
        })
        .returning({ id: caseAttachment.id });
      return { id: row!.id, sha256, sizeBytes };
    });
  } catch (err) {
    throw fromPgError(err) ?? err;
  }
}

export interface AttachmentRow {
  id: string;
  case_id: string;
  case_version_id: string | null;
  kind: AttachmentKind;
  sha256: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_by_name: string;
  source_system: string | null;
  source_ref: string | null;
  created_at: string;
}

export async function listAttachments(sql: Sql, caseId: string): Promise<AttachmentRow[]> {
  return (await sql`
    SELECT a.*, p.given_name || ' ' || p.family_name AS uploaded_by_name
    FROM case_attachment a JOIN person p ON p.id = a.uploaded_by
    WHERE a.case_id = ${caseId} ORDER BY a.created_at`) as unknown as AttachmentRow[];
}

/** The bytes for a hash, plus the metadata of one attachment row that names them. */
export async function attachmentBytes(
  sql: Sql,
  sha256: string,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string } | null> {
  const [meta] =
    await sql`SELECT file_name, mime_type FROM case_attachment WHERE sha256 = ${sha256} LIMIT 1`;
  if (!meta) return null;
  const bytes = await getBlob(sha256);
  if (!bytes)
    throw new CoreError("not_found", `bytes for ${sha256} are missing from the blob store`);
  return { bytes, fileName: meta.file_name as string, mimeType: meta.mime_type as string };
}
