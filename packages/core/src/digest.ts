import type { Sql } from "@pv-core/db";

/**
 * Reminders digest (ADR-0014): the derived views for one study, composed into
 * one plain-text email. Stateless: nothing is stored, nothing is marked sent;
 * the record itself is what the message describes.
 */

export interface DigestObligationRow {
  sender_case_id: string;
  rule_name: string;
  destination_name: string;
  obligation_kind: string;
  clock_start_date: string;
  due_date: string;
  days_remaining: number;
  status: string;
}

export interface DigestCaseRow {
  sender_case_id: string;
  state: string;
  expedited_class: string;
  reportability_reason: string;
  awareness_date: string;
  first_received_date: string;
  causality_assessed: boolean;
}

export interface DigestData {
  study: { id: string; protocol_number: string; title: string; sponsor_name: string };
  generatedOn: string;
  overdue: DigestObligationRow[];
  dueSoon: DigestObligationRow[];
  intake: DigestCaseRow[];
  awaitingReview: DigestCaseRow[];
  unassessed: DigestCaseRow[];
  counts: {
    cases: number;
    open_obligations: number;
    submitted: number;
    acknowledged: number;
    on_time_pct: number | null;
  };
  chain: { valid: boolean; events: number };
}

const REVIEW_STALE_DAYS = 3;

export async function collectDigest(sql: Sql, studyId: string): Promise<DigestData> {
  const [study] = (await sql`
    SELECT st.id, st.protocol_number, st.title, org.name AS sponsor_name
    FROM study st JOIN organization org ON org.id = st.sponsor_org_id WHERE st.id = ${studyId}`) as DigestData["study"][];
  if (!study) throw new Error(`study ${studyId} not found`);
  const today = ((await sql`SELECT CURRENT_DATE::text AS today`) as { today: string }[])[0]!.today;

  const obligations = (await sql`
    SELECT c.sender_case_id, es.rule_name, es.destination_name, es.obligation_kind::text AS obligation_kind,
      es.clock_start_date::text AS clock_start_date, es.due_date::text AS due_date, es.days_remaining, es.status
    FROM v_expected_submission_status es JOIN "case" c ON c.id = es.case_id
    WHERE c.study_id = ${studyId} AND es.status IN ('overdue', 'due_soon')
    ORDER BY es.due_date, c.sender_case_id, es.destination_name`) as unknown as DigestObligationRow[];

  const cases = (await sql`
    SELECT q.sender_case_id, q.state, q.expedited_class, q.reportability_reason,
      q.awareness_date::text AS awareness_date, q.first_received_date::text AS first_received_date, q.causality_assessed,
      (SELECT max(t.transitioned_at)::date FROM case_transition t WHERE t.case_version_id = q.latest_version_id AND t.to_state = 'medical_review') AS review_since
    FROM v_case_queue q WHERE q.study_id = ${studyId}
    ORDER BY q.first_received_date`) as unknown as (DigestCaseRow & {
    review_since: string | null;
  })[];

  const [counts] = (await sql`
    SELECT count(*)::int AS cases,
      coalesce(sum(q.open_obligations), 0)::int AS open_obligations
    FROM v_case_queue q WHERE q.study_id = ${studyId}`) as {
    cases: number;
    open_obligations: number;
  }[];
  const [subs] = (await sql`
    SELECT count(*) FILTER (WHERE es.status = 'submitted')::int AS submitted,
      count(*) FILTER (WHERE es.status = 'acknowledged')::int AS acknowledged,
      CASE WHEN count(*) FILTER (WHERE es.status IN ('submitted','acknowledged','overdue')) = 0 THEN NULL
        ELSE round(100.0 * count(*) FILTER (WHERE es.status IN ('submitted','acknowledged') AND es.on_time)
             / count(*) FILTER (WHERE es.status IN ('submitted','acknowledged','overdue')), 1) END AS on_time_pct
    FROM v_expected_submission_status es JOIN "case" c ON c.id = es.case_id WHERE c.study_id = ${studyId}`) as {
    submitted: number;
    acknowledged: number;
    on_time_pct: string | null;
  }[];
  const problems = await sql`SELECT count(*)::int AS n FROM pv_verify_audit_chain()`;
  const events = await sql`SELECT count(*)::int AS n FROM audit_event`;

  const staleBefore = new Date(`${today}T00:00:00Z`);
  staleBefore.setUTCDate(staleBefore.getUTCDate() - REVIEW_STALE_DAYS);
  return {
    study,
    generatedOn: today,
    overdue: obligations.filter((o) => o.status === "overdue"),
    dueSoon: obligations.filter((o) => o.status === "due_soon"),
    intake: cases.filter((c) => c.state === "intake"),
    awaitingReview: cases.filter(
      (c) =>
        c.state === "medical_review" &&
        c.review_since &&
        new Date(`${c.review_since}T00:00:00Z`) <= staleBefore,
    ),
    unassessed: cases.filter(
      (c) =>
        !c.causality_assessed &&
        c.state !== "nullified" &&
        c.state !== "closed" &&
        c.state !== "intake",
    ),
    counts: {
      cases: counts!.cases,
      open_obligations: counts!.open_obligations,
      submitted: subs!.submitted,
      acknowledged: subs!.acknowledged,
      on_time_pct: subs!.on_time_pct == null ? null : Number(subs!.on_time_pct),
    },
    chain: { valid: Number(problems[0]!.n) === 0, events: Number(events[0]!.n) },
  };
}

/** Everything the digest asks a human to act on (chain breakage counts once). */
export function attentionCount(d: DigestData): number {
  return (
    d.overdue.length +
    d.dueSoon.length +
    d.intake.length +
    d.awaitingReview.length +
    d.unassessed.length +
    (d.chain.valid ? 0 : 1)
  );
}

export function renderDigest(d: DigestData): { subject: string; text: string } {
  const n = attentionCount(d);
  const subject = `[pv-core] ${d.study.protocol_number} safety digest: ${
    n === 0 ? "all clear" : `${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`
  } (${d.generatedOn})`;

  const lines: string[] = [];
  lines.push(`${d.study.protocol_number}: ${d.study.title}`);
  lines.push(`${d.study.sponsor_name}. Safety digest for ${d.generatedOn}. Every status below is`);
  lines.push("derived from the live record at send time; the queue always has the current view.");
  lines.push("");

  if (!d.chain.valid) {
    lines.push(`*** AUDIT CHAIN BROKEN: verification failed over ${d.chain.events} events.`);
    lines.push("*** Investigate before anything else: the append-only record no longer");
    lines.push("*** verifies end to end.");
    lines.push("");
  }

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    lines.push(`${title} (${rows.length})`);
    for (const r of rows) lines.push(`  - ${r}`);
    lines.push("");
  };
  const ob = (o: DigestObligationRow) =>
    `${o.sender_case_id}: ${o.rule_name} to ${o.destination_name}, due ${o.due_date} (${
      o.days_remaining < 0
        ? `${-o.days_remaining} day${o.days_remaining === -1 ? "" : "s"} overdue`
        : `${o.days_remaining} day${o.days_remaining === 1 ? "" : "s"} left`
    })`;

  section("Overdue submissions", d.overdue.map(ob));
  section("Due within the warning window", d.dueSoon.map(ob));
  section(
    "Intake items not yet a valid ICSR",
    d.intake.map(
      (c) => `${c.sender_case_id}: received ${c.first_received_date}, ${c.reportability_reason}`,
    ),
  );
  section(
    `In medical review for more than ${REVIEW_STALE_DAYS} days`,
    d.awaitingReview.map(
      (c) =>
        `${c.sender_case_id}: ${c.expedited_class === "none" ? "not expedited" : `${c.expedited_class} clock`}, ${c.reportability_reason}`,
    ),
  );
  section(
    "Causality not yet assessed by the sponsor (treated as related)",
    d.unassessed.map(
      (c) => `${c.sender_case_id}: ${c.state.replace(/_/g, " ")}, ${c.reportability_reason}`,
    ),
  );

  if (n === 0) {
    lines.push("Nothing needs attention today.");
    lines.push("");
  }

  const c = d.counts;
  lines.push(
    `Standing counts: ${c.cases} cases; ${c.open_obligations} open obligations; ${c.submitted} submitted awaiting acknowledgement; ${c.acknowledged} acknowledged; on-time rate ${c.on_time_pct == null ? "n/a" : `${c.on_time_pct}%`}.`,
  );
  lines.push(
    d.chain.valid
      ? `Audit chain verified: ${d.chain.events} events.`
      : "Audit chain: BROKEN (see above).",
  );
  return { subject, text: lines.join("\n") };
}

/**
 * Who gets the digest: people holding an active admin, case_processor, or
 * medical_reviewer grant that covers the study (unscoped, sponsor-scoped for
 * the study's sponsor, or scoped to this study). The read-only auditor and
 * the intake service are excluded: the digest is a work list.
 */
export async function digestRecipients(sql: Sql, studyId: string) {
  return (await sql`
    SELECT DISTINCT p.email, p.given_name, p.family_name
    FROM access_grant ag
    JOIN person p ON p.id = ag.person_id
    JOIN study st ON st.id = ${studyId}
    WHERE ag.revoked_at IS NULL
      AND ag.role IN ('admin', 'case_processor', 'medical_reviewer')
      AND (
        (ag.organization_id IS NULL AND ag.study_id IS NULL)
        OR ag.organization_id = st.sponsor_org_id
        OR ag.study_id = st.id
      )
    ORDER BY p.email`) as unknown as { email: string; given_name: string; family_name: string }[];
}
