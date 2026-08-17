import { CircleSlash, Send } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  can,
  type Obligation,
  type ObligationStatus,
  type Study,
  useCase,
  useExpectedSubmissions,
  useMe,
} from "../api";
import {
  DaysRemaining,
  OBLIGATION_STATUS,
  OBLIGATION_STATUSES,
  ObligationStatusChip,
  SpecChip,
} from "../status";
import {
  buttonCls,
  Card,
  Empty,
  fmtDate,
  fmtTime,
  humanize,
  linkCls,
  PageState,
  tdCls,
  thCls,
} from "../ui";
import { defaultKind, RevokeDialog, SubmissionDialog, WaiveDialog } from "./CaseObligations";
import { ComplianceCard } from "./Dashboard";

const OPEN: ObligationStatus[] = ["pending", "due_soon", "overdue"];

export default function Reporting({ study }: { study: Study | undefined }) {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ObligationStatus | null) ?? undefined;
  const q = useExpectedSubmissions(study?.id, status);
  const { data: me } = useMe();
  const [submitting, setSubmitting] = useState<Obligation | null>(null);
  const [waiving, setWaiving] = useState<Obligation | null>(null);
  const [revoking, setRevoking] = useState<Obligation | null>(null);

  const setStatus = (s: ObligationStatus | undefined) =>
    setParams(
      (p) => {
        if (!s || p.get("status") === s) p.delete("status");
        else p.set("status", s);
        return p;
      },
      { replace: true },
    );

  // Grouped by due date, soonest first; the API's row order within a day is kept.
  const groups = new Map<string, Obligation[]>();
  for (const o of q.data ?? []) {
    const list = groups.get(o.due_date) ?? [];
    list.push(o);
    groups.set(o.due_date, list);
  }
  const days = [...groups.keys()].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink2">
          Every expected submission {study ? `for ${study.protocol_number}` : "across studies"},
          grouped by due date. Status and days remaining are derived on every read.
        </p>
      </div>

      <Card
        title="Expected submissions"
        aside={
          <>
            {OBLIGATION_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={status && status !== s ? "opacity-40" : ""}
                aria-pressed={status === s}
              >
                <SpecChip spec={OBLIGATION_STATUS[s]} />
              </button>
            ))}
            {status && (
              <button
                type="button"
                onClick={() => setStatus(undefined)}
                className="text-xs text-muted hover:underline"
              >
                clear
              </button>
            )}
          </>
        }
      >
        {!q.data ? (
          <div className="px-4 py-3">
            <PageState query={q} label="expected submissions" />
          </div>
        ) : q.data.length === 0 ? (
          <Empty>No expected submissions{status ? " with this status" : ""}.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thCls}>Due</th>
                  <th className={thCls}>Case</th>
                  <th className={thCls}>Rule</th>
                  <th className={thCls}>Destination</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              {days.map((day) => {
                const list = groups.get(day) ?? [];
                const anyOverdue = list.some((o) => o.status === "overdue");
                return (
                  <tbody key={day} className="divide-y divide-hairline border-b border-hairline">
                    <tr className="bg-page/60">
                      <td colSpan={7} className="px-3 py-1.5 text-xs font-medium">
                        <span
                          className="mono"
                          style={anyOverdue ? { color: "var(--status-critical)" } : undefined}
                        >
                          {day}
                        </span>
                        <span className="ml-2 text-muted">
                          {list.length} obligation{list.length === 1 ? "" : "s"}
                        </span>
                      </td>
                    </tr>
                    {list.map((o) => {
                      const open = OPEN.includes(o.status);
                      return (
                        <tr key={o.expected_submission_id}>
                          <td className={tdCls}>
                            {open ? (
                              <DaysRemaining days={o.days_remaining} />
                            ) : (
                              <span className="text-xs text-muted">
                                {o.sent_at ? `sent ${fmtTime(o.sent_at)}` : fmtDate(o.due_date)}
                              </span>
                            )}
                          </td>
                          <td className={tdCls}>
                            <Link to={`/cases/${o.case_id}`} className={`font-medium ${linkCls}`}>
                              {o.sender_case_id ?? o.case_id.slice(0, 8)}
                            </Link>
                            <div className="text-xs text-muted">
                              {o.protocol_number ?? ""} · v{o.version_number}
                            </div>
                          </td>
                          <td className={tdCls}>
                            <div>{o.rule_name}</div>
                            {o.citation && <div className="text-xs text-muted">{o.citation}</div>}
                          </td>
                          <td className={tdCls}>{o.destination_name}</td>
                          <td className={tdCls}>{humanize(o.obligation_kind)}</td>
                          <td className={tdCls}>
                            <ObligationStatusChip status={o.status} />
                            {o.waiver_reason && (
                              <div className="max-w-xs text-xs text-muted">{o.waiver_reason}</div>
                            )}
                          </td>
                          <td className={tdCls}>
                            <div className="flex flex-wrap justify-end gap-1">
                              {open && can(me, "submit") && (
                                <button
                                  type="button"
                                  className={buttonCls}
                                  onClick={() => setSubmitting(o)}
                                >
                                  <Send size={12} aria-hidden />
                                  Record submission
                                </button>
                              )}
                              {open && can(me, "assess") && (
                                <button
                                  type="button"
                                  className={buttonCls}
                                  onClick={() => setWaiving(o)}
                                >
                                  <CircleSlash size={12} aria-hidden />
                                  Waive
                                </button>
                              )}
                              {o.status === "not_required" && o.waiver_id && can(me, "assess") && (
                                <button
                                  type="button"
                                  className={buttonCls}
                                  onClick={() => setRevoking(o)}
                                >
                                  Revoke waiver
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </Card>

      <ComplianceCard studyId={study?.id} />

      {submitting && <LoadedSubmissionDialog o={submitting} onClose={() => setSubmitting(null)} />}
      {waiving && <WaiveDialog o={waiving} onClose={() => setWaiving(null)} />}
      {revoking && <RevokeDialog o={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}

/** The submission dialog needs the case's versions and payload attachments; load them first. */
function LoadedSubmissionDialog({ o, onClose }: { o: Obligation; onClose: () => void }) {
  const q = useCase(o.case_id);
  if (!q.data)
    return (
      <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:py-12">
        <div className="card w-full max-w-lg px-4 py-3">
          <PageState query={q} label="case" />
        </div>
      </div>
    );
  return (
    <SubmissionDialog
      c={q.data}
      prefill={{
        versionId: o.case_version_id,
        versionNumber: o.version_number,
        destinationId: o.destination_id,
        kind: defaultKind(o),
      }}
      onClose={onClose}
    />
  );
}
