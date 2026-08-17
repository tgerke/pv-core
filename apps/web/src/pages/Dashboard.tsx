import { EyeOff, FilePlus2, Inbox, TriangleAlert, Unlock } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  type CaseState,
  can,
  type QueueRow,
  type Study,
  useCompliance,
  useMe,
  useQueue,
} from "../api";
import {
  CASE_STATE,
  CASE_STATES,
  CaseStateChip,
  DaysRemaining,
  ExpeditedChip,
  SpecChip,
} from "../status";
import {
  Card,
  Chip,
  Empty,
  linkCls,
  n,
  PageState,
  primaryCls,
  StatTile,
  tdCls,
  thCls,
} from "../ui";

export default function Dashboard({ study }: { study: Study | undefined }) {
  const [params, setParams] = useSearchParams();
  const state = (params.get("state") as CaseState | null) ?? undefined;
  const queueQuery = useQueue(study?.id, state);
  const allQuery = useQueue(study?.id);
  const { data: me } = useMe();
  const rows = queueQuery.data;
  const all = allQuery.data ?? rows ?? [];

  const setState = (s: CaseState | undefined) =>
    setParams(
      (p) => {
        if (!s || p.get("state") === s) p.delete("state");
        else p.set("state", s);
        return p;
      },
      { replace: true },
    );

  // Stat tiles are computed client-side over the unfiltered queue.
  const overdue = all.reduce((acc, r) => acc + n(r.overdue_obligations), 0);
  const dueSoon = all.filter(
    (r) => r.days_remaining !== null && r.days_remaining >= 0 && r.days_remaining <= 3,
  ).length;
  const intake = all.filter((r) => r.state === "intake").length;
  const review = all.filter((r) => r.state === "medical_review").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold">Case queue</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink2">
            {study ? `${study.protocol_number}: ` : "All studies: "}
            every case with its derived state and the nearest reporting clock. Overdue obligations
            sort first.
          </p>
        </div>
        {can(me, "enter") && (
          <Link
            to="/cases/new"
            className={`ml-auto ${primaryCls}`}
            style={{ background: "var(--info)" }}
          >
            <FilePlus2 size={13} aria-hidden />
            New case
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Overdue obligations"
          value={overdue}
          cssVar={overdue > 0 ? "--status-critical" : undefined}
        />
        <StatTile
          label="Cases due in 3 days or fewer"
          value={dueSoon}
          cssVar={dueSoon > 0 ? "--status-warn" : undefined}
        />
        <StatTile
          label="Cases in intake"
          value={intake}
          hint="Below the E2B(R3) minimum criteria"
        />
        <StatTile label="Awaiting medical review" value={review} />
      </div>

      <Card
        title="Cases"
        aside={
          <>
            {CASE_STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setState(s)}
                className={state && state !== s ? "opacity-40" : ""}
                aria-pressed={state === s}
                title={`Filter: ${CASE_STATE[s].label}`}
              >
                <SpecChip spec={CASE_STATE[s]} />
              </button>
            ))}
            {state && (
              <button
                type="button"
                onClick={() => setState(undefined)}
                className="text-xs text-muted hover:underline"
              >
                clear
              </button>
            )}
          </>
        }
      >
        {!rows ? (
          <div className="px-4 py-3">
            <PageState query={queueQuery} label="case queue" />
          </div>
        ) : rows.length === 0 ? (
          <Empty>No cases{state ? " in this state" : ""}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thCls}>Case</th>
                  {!study && <th className={thCls}>Study</th>}
                  <th className={thCls}>Primary event</th>
                  <th className={thCls}>Expedited</th>
                  <th className={thCls}>State</th>
                  <th className={thCls}>Next due</th>
                  <th className={`${thCls} text-right`}>Open / overdue</th>
                  <th className={thCls}>Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <QueueRowView key={r.case_id} r={r} showStudy={!study} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ComplianceCard studyId={study?.id} />
    </div>
  );
}

function QueueRowView({ r, showStudy }: { r: QueueRow; showStudy: boolean }) {
  return (
    <tr>
      <td className={tdCls}>
        <Link to={`/cases/${r.case_id}`} className={`font-medium ${linkCls}`}>
          {r.sender_case_id}
        </Link>
        <div className="mono text-xs text-muted">{r.worldwide_unique_id}</div>
        <div className="text-xs text-muted">
          v{r.latest_version_number}
          {n(r.version_count) > 1 ? ` of ${n(r.version_count)}` : ""}
          {r.subject_number ? ` · ${r.subject_number}` : ""}
        </div>
      </td>
      {showStudy && (
        <td className={tdCls}>
          <div>{r.protocol_number ?? "-"}</div>
          <div className="text-xs text-muted">{r.product_name}</div>
        </td>
      )}
      <td className={tdCls}>
        <div>{r.primary_event_pt ?? <span className="text-muted">no event</span>}</div>
        {r.primary_event_soc && <div className="text-xs text-muted">{r.primary_event_soc}</div>}
      </td>
      <td className={tdCls}>
        <ExpeditedChip cls={r.expedited_class} reason={r.reportability_reason} />
        <div className="mt-0.5 text-xs text-muted">{r.reportability_reason}</div>
      </td>
      <td className={tdCls}>
        <CaseStateChip state={r.state} />
      </td>
      <td className={tdCls}>
        <DaysRemaining days={r.days_remaining} due={r.next_due_date} />
      </td>
      <td className={`${tdCls} mono text-right`}>
        {n(r.open_obligations)}
        {" / "}
        <span
          style={n(r.overdue_obligations) > 0 ? { color: "var(--status-critical)" } : undefined}
        >
          {n(r.overdue_obligations)}
        </span>
      </td>
      <td className={tdCls}>
        <span className="flex flex-wrap gap-1">
          {r.is_blinded && !r.is_unblinded && (
            <Chip label="blinded" cssVar="--muted" hollow icon={<EyeOff size={11} aria-hidden />} />
          )}
          {r.is_unblinded && (
            <Chip label="unblinded" cssVar="--info" icon={<Unlock size={11} aria-hidden />} />
          )}
          {!r.causality_assessed && r.state !== "nullified" && (
            <Chip
              label="causality unassessed"
              cssVar="--status-warn"
              icon={<TriangleAlert size={11} aria-hidden />}
            />
          )}
          {!r.minimum_criteria_met && (
            <Chip
              label="intake"
              cssVar="--status-warn"
              hollow
              icon={<Inbox size={11} aria-hidden />}
            />
          )}
        </span>
      </td>
    </tr>
  );
}

export function ComplianceCard({ studyId }: { studyId: string | undefined }) {
  const q = useCompliance(studyId);
  return (
    <Card
      title="Submission compliance"
      aside={<span className="text-xs text-muted">per destination, closed obligations only</span>}
    >
      {!q.data ? (
        <div className="px-4 py-3">
          <PageState query={q} label="compliance metrics" />
        </div>
      ) : q.data.length === 0 ? (
        <Empty>No obligations yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                {!studyId && <th className={thCls}>Study</th>}
                <th className={thCls}>Destination</th>
                <th className={`${thCls} text-right`}>Closed</th>
                <th className={`${thCls} text-right`}>On time</th>
                <th className={`${thCls} text-right`}>Overdue open</th>
                <th className={`${thCls} text-right`}>Pending open</th>
                <th className={`${thCls} text-right`}>Waived</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {q.data.map((c) => {
                const pct = c.pct_on_time === null ? null : n(c.pct_on_time);
                return (
                  <tr key={`${c.study_id}-${c.destination_id}`}>
                    {!studyId && <td className={tdCls}>{c.protocol_number}</td>}
                    <td className={tdCls}>{c.destination_name}</td>
                    <td className={`${tdCls} mono text-right`}>{n(c.closed)}</td>
                    <td
                      className={`${tdCls} mono text-right`}
                      style={
                        pct !== null && pct < 100 && n(c.closed) > 0
                          ? { color: "var(--status-warn)" }
                          : undefined
                      }
                    >
                      {pct === null || n(c.closed) === 0 ? "-" : `${pct.toFixed(0)}%`}
                    </td>
                    <td
                      className={`${tdCls} mono text-right`}
                      style={
                        n(c.overdue_open) > 0 ? { color: "var(--status-critical)" } : undefined
                      }
                    >
                      {n(c.overdue_open)}
                    </td>
                    <td className={`${tdCls} mono text-right`}>{n(c.pending_open)}</td>
                    <td className={`${tdCls} mono text-right`}>{n(c.waived)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
