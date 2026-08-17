import type { Sql } from "@pv-core/db";

/**
 * Role-based authorization over access_grant rows (ADR-0015, ADR-0016). Roles
 * map to operations here, in one place; scope narrowing (sponsor organization,
 * study) comes from the grant row.
 */

export type Operation = "read" | "enter" | "assess" | "sign" | "submit" | "administer";
export type AccessRole = "admin" | "case_processor" | "medical_reviewer" | "read_only" | "ingest";

const ROLE_OPERATIONS: Record<AccessRole, readonly Operation[]> = {
  admin: ["read", "enter", "assess", "sign", "submit", "administer"],
  // Intake, data entry, follow-ups, submissions and acknowledgements.
  case_processor: ["read", "enter", "submit"],
  // Assessments, expectedness overrides, unblinding facts, waivers, signing;
  // may also correct data (narrative, sender comments) before signing.
  medical_reviewer: ["read", "enter", "assess", "sign"],
  read_only: ["read"],
  // Machine identities (source-system intake): create cases, children, and
  // attachments; never assess, sign, or submit. No read either: a service
  // pushes records in and reads nothing back beyond its own responses.
  ingest: ["enter"],
};

export interface Grant {
  role: AccessRole;
  organization_id: string | null;
  study_id: string | null;
}

/** The study and sponsor a request touches; empty = not scoped to one resource. */
export interface ResourceScope {
  studyId?: string;
  sponsorOrgId?: string;
}

/** Active (non-revoked) grants for a person. */
export async function grantsFor(sql: Sql, personId: string): Promise<Grant[]> {
  return (await sql`
    SELECT role, organization_id, study_id FROM access_grant
    WHERE person_id = ${personId} AND revoked_at IS NULL`) as unknown as Grant[];
}

/**
 * Does any grant permit `op` on `scope`? A study-scoped grant matches only
 * that study; a sponsor-scoped grant matches any study or product of that
 * sponsor; an unscoped grant matches everything. A scope with no ids (the
 * study list, the queue across studies) is matched by any grant whose role
 * permits the operation; the query layer then narrows rows with
 * readableScope().
 */
export function permits(grants: Grant[], op: Operation, scope: ResourceScope): boolean {
  const unscoped = !scope.studyId && !scope.sponsorOrgId;
  return grants.some((g) => {
    if (!ROLE_OPERATIONS[g.role].includes(op)) return false;
    if (unscoped) return true;
    if (g.study_id) return scope.studyId === g.study_id;
    if (g.organization_id) return scope.sponsorOrgId === g.organization_id;
    return true;
  });
}

/** What a set of grants may read, for row filtering in list queries. */
export interface ReadableScope {
  all: boolean;
  studyIds: string[];
  sponsorOrgIds: string[];
}

export function readableScope(grants: Grant[]): ReadableScope {
  const readers = grants.filter((g) => ROLE_OPERATIONS[g.role].includes("read"));
  return {
    all: readers.some((g) => !g.study_id && !g.organization_id),
    studyIds: readers.flatMap((g) => (g.study_id ? [g.study_id] : [])),
    sponsorOrgIds: readers.flatMap((g) => (g.organization_id ? [g.organization_id] : [])),
  };
}

/** Param names the API uses to reference scoped resources. */
export type ScopeParam =
  | "studyId"
  | "caseId"
  | "versionId"
  | "expectedSubmissionId"
  | "submissionId"
  | "attachmentSha256"
  | "organizationId"
  | "productId"
  | "destinationId"
  | "ruleId"
  | "grantId"
  | "rsiVersionId"
  | "anticipatedEventId";

/**
 * Resolve a path parameter to the study/sponsor it belongs to (one indexed
 * lookup). Returns null when the id doesn't exist; the route handler owns the
 * 404, and authorization falls back to unscoped matching.
 */
export async function resolveScope(
  sql: Sql,
  param: ScopeParam,
  id: string,
): Promise<ResourceScope | null> {
  const ofStudy = (r: { study_id: string | null; sponsor_org_id: string | null } | undefined) =>
    r ? { studyId: r.study_id ?? undefined, sponsorOrgId: r.sponsor_org_id ?? undefined } : null;
  switch (param) {
    case "studyId": {
      const [r] = await sql`SELECT id AS study_id, sponsor_org_id FROM study WHERE id = ${id}`;
      return ofStudy(r as { study_id: string; sponsor_org_id: string } | undefined);
    }
    case "caseId": {
      const [r] = await sql`
        SELECT c.study_id, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM "case" c LEFT JOIN study st ON st.id = c.study_id LEFT JOIN product pr ON pr.id = c.product_id
        WHERE c.id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
    case "versionId": {
      const [r] = await sql`
        SELECT c.study_id, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM case_version cv JOIN "case" c ON c.id = cv.case_id
        LEFT JOIN study st ON st.id = c.study_id LEFT JOIN product pr ON pr.id = c.product_id
        WHERE cv.id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
    case "expectedSubmissionId": {
      const [r] = await sql`
        SELECT c.study_id, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM expected_submission es JOIN "case" c ON c.id = es.case_id
        LEFT JOIN study st ON st.id = c.study_id LEFT JOIN product pr ON pr.id = c.product_id
        WHERE es.id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
    case "submissionId": {
      const [r] = await sql`
        SELECT c.study_id, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM submission s JOIN case_version cv ON cv.id = s.case_version_id JOIN "case" c ON c.id = cv.case_id
        LEFT JOIN study st ON st.id = c.study_id LEFT JOIN product pr ON pr.id = c.product_id
        WHERE s.id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
    case "attachmentSha256": {
      // The narrowest case that holds these bytes decides; a blob shared by
      // two cases is readable through either.
      const rows = await sql`
        SELECT c.study_id, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM case_attachment a JOIN "case" c ON c.id = a.case_id
        LEFT JOIN study st ON st.id = c.study_id LEFT JOIN product pr ON pr.id = c.product_id
        WHERE a.sha256 = ${id} LIMIT 1`;
      return ofStudy(
        rows[0] as { study_id: string | null; sponsor_org_id: string | null } | undefined,
      );
    }
    case "organizationId":
      return { sponsorOrgId: id };
    case "productId": {
      const [r] = await sql`SELECT sponsor_org_id FROM product WHERE id = ${id}`;
      return r ? { sponsorOrgId: r.sponsor_org_id as string } : null;
    }
    case "rsiVersionId": {
      const [r] = await sql`
        SELECT p.sponsor_org_id FROM product_rsi_version v JOIN product p ON p.id = v.product_id WHERE v.id = ${id}`;
      return r ? { sponsorOrgId: r.sponsor_org_id as string } : null;
    }
    case "anticipatedEventId": {
      const [r] = await sql`
        SELECT ae.study_id, st.sponsor_org_id FROM study_anticipated_event ae JOIN study st ON st.id = ae.study_id WHERE ae.id = ${id}`;
      return ofStudy(r as { study_id: string; sponsor_org_id: string } | undefined);
    }
    case "destinationId": {
      const [r] = await sql`SELECT sponsor_org_id FROM reporting_destination WHERE id = ${id}`;
      return r ? { sponsorOrgId: (r.sponsor_org_id as string | null) ?? undefined } : null;
    }
    case "ruleId": {
      const [r] = await sql`
        SELECT rr.study_id, coalesce(rr.sponsor_org_id, st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
        FROM reporting_rule rr LEFT JOIN study st ON st.id = rr.study_id LEFT JOIN product pr ON pr.id = rr.product_id
        WHERE rr.id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
    case "grantId": {
      const [r] =
        await sql`SELECT study_id, organization_id AS sponsor_org_id FROM access_grant WHERE id = ${id}`;
      return ofStudy(r as { study_id: string | null; sponsor_org_id: string | null } | undefined);
    }
  }
}
