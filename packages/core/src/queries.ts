import type { Sql } from "@pv-core/db";
import type { ReadableScope } from "./authz.js";

/**
 * View-backed reads. The `v_*` views are the public query surface
 * (docs/02-data-model.md); everything here is a SELECT over them, narrowed by
 * the caller's readable scope (ADR-0015).
 */

type Row = Record<string, unknown>;

/** SQL fragment restricting rows to what the grants can read. */
function scopeFilter(sql: Sql, scope: ReadableScope, studyCol: string, sponsorCol: string) {
  if (scope.all) return sql`true`;
  const studies = scope.studyIds.length ? scope.studyIds : ["00000000-0000-0000-0000-000000000000"];
  const sponsors = scope.sponsorOrgIds.length
    ? scope.sponsorOrgIds
    : ["00000000-0000-0000-0000-000000000000"];
  return sql`(${sql.unsafe(studyCol)} = ANY(${studies}::uuid[]) OR ${sql.unsafe(sponsorCol)} = ANY(${sponsors}::uuid[]))`;
}

export async function listStudies(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  return sql`
    SELECT st.*, org.name AS sponsor_name,
      (SELECT count(*) FROM v_case_queue q WHERE q.study_id = st.id) AS case_count,
      (SELECT count(*) FROM v_case_queue q WHERE q.study_id = st.id AND q.overdue_obligations > 0) AS overdue_case_count,
      (SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'role', sp.role) ORDER BY p.name)
         FROM study_product sp JOIN product p ON p.id = sp.product_id WHERE sp.study_id = st.id) AS products
    FROM study st JOIN organization org ON org.id = st.sponsor_org_id
    WHERE ${scopeFilter(sql, scope, "st.id", "st.sponsor_org_id")}
    ORDER BY st.protocol_number` as unknown as Promise<Row[]>;
}

export async function studyDetail(sql: Sql, studyId: string): Promise<Row | null> {
  const [r] = await sql`
    SELECT st.*, org.name AS sponsor_name,
      (SELECT json_agg(json_build_object('id', ss.id, 'site_number', ss.site_number, 'name', s.name, 'country', s.country, 'status', ss.status) ORDER BY ss.site_number)
         FROM study_site ss JOIN site s ON s.id = ss.site_id WHERE ss.study_id = st.id) AS sites,
      (SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'role', sp.role) ORDER BY p.name)
         FROM study_product sp JOIN product p ON p.id = sp.product_id WHERE sp.study_id = st.id) AS products
    FROM study st JOIN organization org ON org.id = st.sponsor_org_id WHERE st.id = ${studyId}`;
  return (r as Row | undefined) ?? null;
}

export async function caseQueue(
  sql: Sql,
  scope: ReadableScope,
  filter: { studyId?: string; state?: string } = {},
): Promise<Row[]> {
  return sql`
    SELECT q.* FROM v_case_queue q
    WHERE ${scopeFilter(sql, scope, "q.study_id", "q.sponsor_org_id")}
      AND (${filter.studyId ?? null}::uuid IS NULL OR q.study_id = ${filter.studyId ?? null}::uuid)
      AND (${filter.state ?? null}::text IS NULL OR q.state = ${filter.state ?? null}::text)
    ORDER BY (q.overdue_obligations > 0) DESC, q.next_due_date NULLS LAST, q.first_received_date DESC` as unknown as Promise<
    Row[]
  >;
}

export async function expectedSubmissions(
  sql: Sql,
  scope: ReadableScope,
  filter: { studyId?: string; status?: string } = {},
): Promise<Row[]> {
  return sql`
    SELECT es.*, c.sender_case_id, c.study_id, st.protocol_number, coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id
    FROM v_expected_submission_status es
    JOIN "case" c ON c.id = es.case_id
    LEFT JOIN study st ON st.id = c.study_id
    LEFT JOIN product pr ON pr.id = c.product_id
    WHERE ${scopeFilter(sql, scope, "c.study_id", "coalesce(st.sponsor_org_id, pr.sponsor_org_id)")}
      AND (${filter.studyId ?? null}::uuid IS NULL OR c.study_id = ${filter.studyId ?? null}::uuid)
      AND (${filter.status ?? null}::text IS NULL OR es.status = ${filter.status ?? null}::text)
    ORDER BY CASE es.status WHEN 'overdue' THEN 0 WHEN 'due_soon' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, es.due_date, c.sender_case_id` as unknown as Promise<
    Row[]
  >;
}

export async function reportability(
  sql: Sql,
  scope: ReadableScope,
  studyId?: string,
): Promise<Row[]> {
  return sql`
    SELECT r.*, c.sender_case_id FROM v_case_reportability r JOIN "case" c ON c.id = r.case_id
    WHERE ${scopeFilter(sql, scope, "r.study_id", "r.sponsor_org_id")}
      AND (${studyId ?? null}::uuid IS NULL OR r.study_id = ${studyId ?? null}::uuid)
    ORDER BY c.sender_case_id, r.version_number` as unknown as Promise<Row[]>;
}

export async function ruleMatches(sql: Sql, versionId: string): Promise<Row[]> {
  return sql`
    SELECT m.*, rr.name AS rule_name, rr.citation, d.name AS destination_name
    FROM v_rule_match m JOIN reporting_rule rr ON rr.id = m.reporting_rule_id JOIN reporting_destination d ON d.id = rr.destination_id
    WHERE m.case_version_id = ${versionId} ORDER BY rr.name` as unknown as Promise<Row[]>;
}

export async function dsurSarLineListing(
  sql: Sql,
  scope: ReadableScope,
  filter: { studyId?: string; from?: string; to?: string } = {},
): Promise<Row[]> {
  return sql`
    SELECT l.* FROM v_dsur_sar_line_listing l
    WHERE ${scopeFilter(sql, scope, "l.study_id", "l.sponsor_org_id")}
      AND (${filter.studyId ?? null}::uuid IS NULL OR l.study_id = ${filter.studyId ?? null}::uuid)
      AND (${filter.from ?? null}::date IS NULL OR l.first_received_date >= ${filter.from ?? null}::date)
      AND (${filter.to ?? null}::date IS NULL OR l.first_received_date <= ${filter.to ?? null}::date)
    ORDER BY l.protocol_number, l.soc_term, l.pt_term, l.sender_case_id` as unknown as Promise<
    Row[]
  >;
}

export async function dsurSaeSummary(
  sql: Sql,
  scope: ReadableScope,
  studyId?: string,
): Promise<Row[]> {
  return sql`
    SELECT s.* FROM v_dsur_sae_summary s
    WHERE ${scopeFilter(sql, scope, "s.study_id", "s.sponsor_org_id")}
      AND (${studyId ?? null}::uuid IS NULL OR s.study_id = ${studyId ?? null}::uuid)
    ORDER BY s.protocol_number, s.soc_term, s.arm_label` as unknown as Promise<Row[]>;
}

export async function reportingCompliance(
  sql: Sql,
  scope: ReadableScope,
  studyId?: string,
): Promise<Row[]> {
  return sql`
    SELECT rc.* FROM v_reporting_compliance rc
    WHERE ${scopeFilter(sql, scope, "rc.study_id", "rc.sponsor_org_id")}
      AND (${studyId ?? null}::uuid IS NULL OR rc.study_id = ${studyId ?? null}::uuid)
    ORDER BY rc.protocol_number, rc.destination_name` as unknown as Promise<Row[]>;
}

/** The whole case: identity, every version with its sections, facts, obligations, submissions, attachments. */
export async function caseDetail(sql: Sql, caseId: string): Promise<Row | null> {
  const [c] = await sql`
    SELECT c.*, q.state, q.expedited_class, q.reportability_reason, q.causality_assessed, q.minimum_criteria_met,
      q.is_unblinded, q.is_nullified, q.latest_version_id, q.latest_version_number, q.open_obligations,
      q.overdue_obligations, q.next_due_date, q.days_remaining, q.protocol_number, q.product_name, q.sponsor_org_id,
      q.is_blinded, st.title AS study_title,
      cb.given_name || ' ' || cb.family_name AS created_by_name
    FROM "case" c
    JOIN v_case_queue q ON q.case_id = c.id
    LEFT JOIN study st ON st.id = c.study_id
    JOIN person cb ON cb.id = c.created_by
    WHERE c.id = ${caseId}`;
  if (!c) return null;
  const versions = (await sql`
    SELECT cv.*, d.version AS dictionary_version, d.is_demo_subset,
      mc.minimum_criteria_met, mc.missing,
      r.expedited_class, r.reason AS reportability_reason, r.any_serious, r.any_susar, r.causality_assessed,
      (SELECT count(*) FROM signature s WHERE s.case_version_id = cv.id) > 0 AS is_locked,
      pv_case_version_sha256(cv.id) AS sha256,
      cb.given_name || ' ' || cb.family_name AS created_by_name
    FROM case_version cv
    JOIN dictionary d ON d.id = cv.dictionary_id
    JOIN v_case_minimum_criteria mc ON mc.case_version_id = cv.id
    JOIN v_case_reportability r ON r.case_version_id = cv.id
    JOIN person cb ON cb.id = cv.created_by
    WHERE cv.case_id = ${caseId} ORDER BY cv.version_number`) as Row[];
  for (const v of versions) {
    const id = v.id as string;
    v.patient = (await sql`SELECT * FROM case_patient WHERE case_version_id = ${id}`)[0] ?? null;
    v.sources = await sql`SELECT * FROM case_source WHERE case_version_id = ${id} ORDER BY seq`;
    v.events = await sql`
      SELECT e.*, er.serious, er.fatal_or_life_threatening, er.expectedness, er.expectedness_basis, er.rsi_label,
        er.reporter_assessed, er.sponsor_assessed, er.reporter_related, er.sponsor_related, er.related_either
      FROM case_event e JOIN v_case_event_reportability er ON er.case_event_id = e.id
      WHERE e.case_version_id = ${id} ORDER BY e.seq`;
    v.drugs =
      await sql`SELECT d.*, p.name AS product_name FROM case_drug d LEFT JOIN product p ON p.id = d.product_id WHERE d.case_version_id = ${id} ORDER BY d.seq`;
    v.assessments = await sql`
      SELECT a.*, d.seq AS drug_seq, e.seq AS event_seq FROM case_assessment a
      JOIN case_drug d ON d.id = a.case_drug_id JOIN case_event e ON e.id = a.case_event_id
      WHERE a.case_version_id = ${id} ORDER BY d.seq, e.seq, a.assessor`;
    v.tests = await sql`SELECT * FROM case_test WHERE case_version_id = ${id} ORDER BY seq`;
    v.narrative =
      (await sql`SELECT * FROM case_narrative WHERE case_version_id = ${id}`)[0] ?? null;
    v.signatures = await sql`
      SELECT s.*, p.given_name || ' ' || p.family_name AS signer_name, si.hash_matches
      FROM signature s JOIN person p ON p.id = s.signer_person_id JOIN v_signature_integrity si ON si.signature_id = s.id
      WHERE s.case_version_id = ${id} ORDER BY s.signed_at`;
    v.transitions = await sql`
      SELECT t.*, p.given_name || ' ' || p.family_name AS by_name FROM case_transition t JOIN person p ON p.id = t.transitioned_by
      WHERE t.case_version_id = ${id} ORDER BY t.transitioned_at`;
    v.rule_matches = await ruleMatches(sql, id);
  }
  const obligations = await sql`
    SELECT es.* FROM v_expected_submission_status es WHERE es.case_id = ${caseId}
    ORDER BY es.due_date, es.destination_name`;
  const submissions = await sql`
    SELECT s.*, d.name AS destination_name, p.given_name || ' ' || p.family_name AS sent_by_name, cv.version_number,
      (SELECT json_agg(json_build_object('id', a.id, 'ack_code', a.ack_code, 'received_at', a.received_at, 'error_text', a.error_text) ORDER BY a.received_at)
         FROM submission_acknowledgement a WHERE a.submission_id = s.id) AS acknowledgements
    FROM submission s JOIN case_version cv ON cv.id = s.case_version_id
    JOIN reporting_destination d ON d.id = s.destination_id JOIN person p ON p.id = s.sent_by
    WHERE cv.case_id = ${caseId} ORDER BY s.sent_at`;
  const [unblinding] = await sql`
    SELECT u.id, u.arm_label, u.arm_role, u.unblinded_at, u.reason, u.source_system, u.source_ref,
      p.given_name || ' ' || p.family_name AS by_name
    FROM case_unblinding u JOIN person p ON p.id = u.unblinded_by WHERE u.case_id = ${caseId}`;
  const [nullification] = await sql`
    SELECT n.*, p.given_name || ' ' || p.family_name AS by_name FROM case_nullification n JOIN person p ON p.id = n.nullified_by
    WHERE n.case_id = ${caseId}`;
  const attachments = await sql`
    SELECT a.*, p.given_name || ' ' || p.family_name AS uploaded_by_name FROM case_attachment a JOIN person p ON p.id = a.uploaded_by
    WHERE a.case_id = ${caseId} ORDER BY a.created_at`;
  const waivers = await sql`
    SELECT w.*, p.given_name || ' ' || p.family_name AS by_name FROM expected_submission_waiver w
    JOIN expected_submission es ON es.id = w.expected_submission_id JOIN person p ON p.id = w.waived_by
    WHERE es.case_id = ${caseId} ORDER BY w.waived_at`;
  return {
    ...(c as Row),
    versions,
    obligations,
    submissions,
    unblinding: unblinding ?? null,
    nullification: nullification ?? null,
    attachments,
    waivers,
  };
}

/** Audit events touching a case: the case, its versions, and every child row. */
export async function caseAuditTrail(sql: Sql, caseId: string, limit = 500): Promise<Row[]> {
  return sql`
    WITH ids AS (
      SELECT ${caseId}::text AS id
      UNION SELECT id::text FROM case_version WHERE case_id = ${caseId}
      UNION SELECT p.id::text FROM case_patient p JOIN case_version cv ON cv.id = p.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT s.id::text FROM case_source s JOIN case_version cv ON cv.id = s.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT e.id::text FROM case_event e JOIN case_version cv ON cv.id = e.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT d.id::text FROM case_drug d JOIN case_version cv ON cv.id = d.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT a.id::text FROM case_assessment a JOIN case_version cv ON cv.id = a.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT t.id::text FROM case_test t JOIN case_version cv ON cv.id = t.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT n.id::text FROM case_narrative n JOIN case_version cv ON cv.id = n.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT s.id::text FROM signature s JOIN case_version cv ON cv.id = s.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT t.id::text FROM case_transition t WHERE t.case_id = ${caseId}
      UNION SELECT a.id::text FROM case_attachment a WHERE a.case_id = ${caseId}
      UNION SELECT u.id::text FROM case_unblinding u WHERE u.case_id = ${caseId}
      UNION SELECT n.id::text FROM case_nullification n WHERE n.case_id = ${caseId}
      UNION SELECT es.id::text FROM expected_submission es WHERE es.case_id = ${caseId}
      UNION SELECT w.id::text FROM expected_submission_waiver w JOIN expected_submission es ON es.id = w.expected_submission_id WHERE es.case_id = ${caseId}
      UNION SELECT s.id::text FROM submission s JOIN case_version cv ON cv.id = s.case_version_id WHERE cv.case_id = ${caseId}
      UNION SELECT a.id::text FROM submission_acknowledgement a JOIN submission s ON s.id = a.submission_id JOIN case_version cv ON cv.id = s.case_version_id WHERE cv.case_id = ${caseId}
    )
    SELECT ae.id, ae.occurred_at, ae.actor_id, ae.actor_label, ae.action, ae.entity_type, ae.entity_id, ae.before, ae.after, ae.prev_hash, ae.hash,
      p.given_name || ' ' || p.family_name AS actor_name
    FROM audit_event ae LEFT JOIN person p ON p.id = ae.actor_id
    WHERE ae.entity_id IN (SELECT id FROM ids)
    ORDER BY ae.id DESC LIMIT ${limit}` as unknown as Promise<Row[]>;
}

export async function auditEvents(
  sql: Sql,
  filter: { entityType?: string; entityId?: string; actorId?: string; limit?: number } = {},
): Promise<Row[]> {
  return sql`
    SELECT ae.id, ae.occurred_at, ae.actor_id, ae.actor_label, ae.action, ae.entity_type, ae.entity_id, ae.prev_hash, ae.hash,
      p.given_name || ' ' || p.family_name AS actor_name
    FROM audit_event ae LEFT JOIN person p ON p.id = ae.actor_id
    WHERE (${filter.entityType ?? null}::text IS NULL OR ae.entity_type = ${filter.entityType ?? null}::text)
      AND (${filter.entityId ?? null}::text IS NULL OR ae.entity_id = ${filter.entityId ?? null}::text)
      AND (${filter.actorId ?? null}::uuid IS NULL OR ae.actor_id = ${filter.actorId ?? null}::uuid)
    ORDER BY ae.id DESC LIMIT ${filter.limit ?? 200}` as unknown as Promise<Row[]>;
}

export async function verifyAuditChain(
  sql: Sql,
): Promise<{ ok: boolean; events: number; problems: Row[] }> {
  const problems = (await sql`SELECT * FROM pv_verify_audit_chain()`) as Row[];
  const counts = (await sql`SELECT count(*)::int AS n FROM audit_event`) as { n: number }[];
  return { ok: problems.length === 0, events: counts[0]?.n ?? 0, problems };
}

export async function signatureIntegrity(sql: Sql, caseId?: string): Promise<Row[]> {
  return sql`
    SELECT si.*, c.sender_case_id FROM v_signature_integrity si JOIN "case" c ON c.id = si.case_id
    WHERE (${caseId ?? null}::uuid IS NULL OR si.case_id = ${caseId ?? null}::uuid)
    ORDER BY si.signed_at DESC` as unknown as Promise<Row[]>;
}

// --- admin reads --------------------------------------------------------------

export async function listOrganizations(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  if (scope.all)
    return sql`SELECT * FROM organization ORDER BY kind, name` as unknown as Promise<Row[]>;
  return sql`
    SELECT * FROM organization o
    WHERE o.id = ANY(${scope.sponsorOrgIds.length ? scope.sponsorOrgIds : ["00000000-0000-0000-0000-000000000000"]}::uuid[])
       OR o.id IN (SELECT sponsor_org_id FROM study WHERE id = ANY(${scope.studyIds.length ? scope.studyIds : ["00000000-0000-0000-0000-000000000000"]}::uuid[]))
    ORDER BY kind, name` as unknown as Promise<Row[]>;
}

export async function listProducts(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  return sql`
    SELECT p.*, org.name AS sponsor_name,
      (SELECT json_agg(json_build_object('id', v.id, 'label', v.label, 'effective_from', v.effective_from, 'effective_to', v.effective_to,
          'listed_terms', (SELECT json_agg(json_build_object('pt_code', t.pt_code, 'pt_term', t.pt_term, 'listedness_note', t.listedness_note) ORDER BY t.pt_term)
                             FROM rsi_listed_term t WHERE t.rsi_version_id = v.id)) ORDER BY v.effective_from DESC)
         FROM product_rsi_version v WHERE v.product_id = p.id) AS rsi_versions
    FROM product p JOIN organization org ON org.id = p.sponsor_org_id
    WHERE ${scopeFilter(sql, scope, "(SELECT null::uuid)", "p.sponsor_org_id")}
       OR p.id IN (SELECT product_id FROM study_product WHERE study_id = ANY(${scope.studyIds.length ? scope.studyIds : ["00000000-0000-0000-0000-000000000000"]}::uuid[]))
    ORDER BY org.name, p.name` as unknown as Promise<Row[]>;
}

export async function listDestinations(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  return sql`
    SELECT d.*, org.name AS sponsor_name FROM reporting_destination d LEFT JOIN organization org ON org.id = d.sponsor_org_id
    WHERE d.sponsor_org_id IS NULL OR ${scopeFilter(sql, scope, "(SELECT null::uuid)", "d.sponsor_org_id")}
    ORDER BY d.kind, d.name` as unknown as Promise<Row[]>;
}

export async function listRules(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  return sql`
    SELECT rr.*, d.name AS destination_name, st.protocol_number, p.name AS product_name, org.name AS sponsor_name
    FROM reporting_rule rr
    JOIN reporting_destination d ON d.id = rr.destination_id
    LEFT JOIN study st ON st.id = rr.study_id
    LEFT JOIN product p ON p.id = rr.product_id
    LEFT JOIN organization org ON org.id = coalesce(rr.sponsor_org_id, st.sponsor_org_id, p.sponsor_org_id)
    WHERE ${scopeFilter(sql, scope, "rr.study_id", "coalesce(rr.sponsor_org_id, st.sponsor_org_id, p.sponsor_org_id)")}
    ORDER BY (rr.effective_to IS NOT NULL), d.name, rr.timeline_days, rr.name` as unknown as Promise<
    Row[]
  >;
}

export async function listPeople(sql: Sql): Promise<Row[]> {
  return sql`
    SELECT p.*, (SELECT json_agg(json_build_object('id', g.id, 'role', g.role, 'organization_id', g.organization_id, 'study_id', g.study_id,
        'granted_at', g.granted_at, 'revoked_at', g.revoked_at) ORDER BY g.granted_at) FROM access_grant g WHERE g.person_id = p.id) AS grants
    FROM person p ORDER BY p.family_name, p.given_name` as unknown as Promise<Row[]>;
}

export async function listSites(sql: Sql, scope: ReadableScope): Promise<Row[]> {
  return sql`
    SELECT ss.id AS study_site_id, ss.study_id, ss.site_number, ss.status, s.id AS site_id, s.name, s.city, s.country, st.protocol_number
    FROM study_site ss JOIN site s ON s.id = ss.site_id JOIN study st ON st.id = ss.study_id
    WHERE ${scopeFilter(sql, scope, "ss.study_id", "st.sponsor_org_id")}
    ORDER BY st.protocol_number, ss.site_number` as unknown as Promise<Row[]>;
}
