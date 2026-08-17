import { CircleSlash, FileDown, MailCheck, Send, Undo2 } from "lucide-react";
import { useState } from "react";
import {
  type AckCode,
  type CaseDetail,
  can,
  type Me,
  type Obligation,
  openInNewTab,
  type Submission,
  type SubmissionFormat,
  type SubmissionKind,
  useDestinations,
  useRecordAcknowledgement,
  useRecordSubmission,
  useRevokeWaiver,
  useWaive,
} from "../api";
import { DaysRemaining, ObligationStatusChip } from "../status";
import {
  buttonCls,
  Card,
  Chip,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  fmtDate,
  fmtTime,
  humanize,
  inputCls,
  primaryCls,
  tdCls,
  thCls,
} from "../ui";

export const SUBMISSION_KINDS: SubmissionKind[] = [
  "initial_notification",
  "initial_report",
  "follow_up_report",
  "amendment",
  "nullification",
  "notification_letter",
];
export const SUBMISSION_FORMATS: SubmissionFormat[] = [
  "e2b_r3_json",
  "cioms_i_pdf",
  "medwatch_3500a_pdf",
  "portal_manual",
  "email",
];
const ACK_CODES: AckCode[] = ["AA", "AE", "AR", "CA", "CR", "manual_receipt"];

const OPEN: Obligation["status"][] = ["pending", "due_soon", "overdue"];

export interface SubmissionPrefill {
  versionId: string;
  versionNumber: number;
  destinationId?: string;
  kind?: SubmissionKind;
}

/** Default submission kind for an obligation, refined by destination kind. */
export function defaultKind(o: Obligation): SubmissionKind {
  if (o.destination_kind === "investigator_group") return "notification_letter";
  if (o.obligation_kind === "follow_up") return "follow_up_report";
  if (o.obligation_kind === "nullification") return "nullification";
  return "initial_report";
}

export function ObligationsPanel({
  c,
  me,
  onRecordSubmission,
}: {
  c: CaseDetail;
  me: Me | undefined;
  onRecordSubmission: (prefill: SubmissionPrefill) => void;
}) {
  const [waiving, setWaiving] = useState<Obligation | null>(null);
  const [revoking, setRevoking] = useState<Obligation | null>(null);
  const approvedVersions = new Set(
    c.versions.filter((v) => v.signatures.some((s) => s.meaning === "approval")).map((v) => v.id),
  );
  const canSubmit = can(me, "submit") && !c.is_nullified;
  const canAssess = can(me, "assess") && !c.is_nullified;
  const obligations = [...c.obligations].sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <>
      <Card
        title="Obligations"
        aside={<span className="text-xs text-muted">clocks derived on every read (ADR-0007)</span>}
      >
        {obligations.length === 0 ? (
          <Empty>No reporting obligation applies.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thCls}>Rule</th>
                  <th className={thCls}>Destination</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>Day 0</th>
                  <th className={thCls}>Due</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>On time</th>
                  <th className={thCls}>Waiver</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {obligations.map((o) => {
                  const open = OPEN.includes(o.status);
                  const approved = approvedVersions.has(o.case_version_id);
                  return (
                    <tr key={o.expected_submission_id}>
                      <td className={tdCls}>
                        <div>{o.rule_name}</div>
                        {o.citation && <div className="text-xs text-muted">{o.citation}</div>}
                      </td>
                      <td className={tdCls}>
                        <div>{o.destination_name}</div>
                        <div className="text-xs text-muted">{humanize(o.destination_kind)}</div>
                      </td>
                      <td className={tdCls}>
                        {humanize(o.obligation_kind)}
                        <div className="text-xs text-muted">v{o.version_number}</div>
                      </td>
                      <td className={`${tdCls} mono`}>{fmtDate(o.clock_start_date)}</td>
                      <td className={tdCls}>
                        {open ? (
                          <DaysRemaining days={o.days_remaining} due={o.due_date} />
                        ) : (
                          <span className="mono">{fmtDate(o.due_date)}</span>
                        )}
                        <div className="text-xs text-muted">{o.timeline_days}-day clock</div>
                      </td>
                      <td className={tdCls}>
                        <ObligationStatusChip status={o.status} />
                        {o.sent_at && (
                          <div className="mono text-xs text-muted">sent {fmtTime(o.sent_at)}</div>
                        )}
                      </td>
                      <td className={tdCls}>
                        {o.on_time === null ? (
                          <span className="text-muted">-</span>
                        ) : (
                          <span
                            style={{
                              color: o.on_time ? "var(--status-good)" : "var(--status-critical)",
                            }}
                          >
                            {o.on_time ? "yes" : "late"}
                          </span>
                        )}
                      </td>
                      <td className={`${tdCls} max-w-xs text-xs text-ink2`}>
                        {o.waiver_reason ?? <span className="text-muted">-</span>}
                      </td>
                      <td className={tdCls}>
                        <div className="flex flex-wrap justify-end gap-1">
                          {open && canSubmit && (
                            <button
                              type="button"
                              className={buttonCls}
                              disabled={!approved}
                              title={
                                approved
                                  ? `Record what was sent to ${o.destination_name}`
                                  : `v${o.version_number} needs an approval signature first`
                              }
                              onClick={() =>
                                onRecordSubmission({
                                  versionId: o.case_version_id,
                                  versionNumber: o.version_number,
                                  destinationId: o.destination_id,
                                  kind: defaultKind(o),
                                })
                              }
                            >
                              <Send size={12} aria-hidden />
                              Record submission
                            </button>
                          )}
                          {open && canAssess && (
                            <button
                              type="button"
                              className={buttonCls}
                              onClick={() => setWaiving(o)}
                            >
                              <CircleSlash size={12} aria-hidden />
                              Waive
                            </button>
                          )}
                          {o.status === "not_required" && o.waiver_id && canAssess && (
                            <button
                              type="button"
                              className={buttonCls}
                              onClick={() => setRevoking(o)}
                            >
                              <Undo2 size={12} aria-hidden />
                              Revoke waiver
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Submissions">
        {c.submissions.length === 0 ? (
          <Empty>Nothing sent yet.</Empty>
        ) : (
          <ul className="divide-y divide-hairline">
            {[...c.submissions]
              .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
              .map((s) => (
                <SubmissionRow key={s.id} s={s} canSubmit={canSubmit} />
              ))}
          </ul>
        )}
      </Card>

      {waiving && <WaiveDialog o={waiving} onClose={() => setWaiving(null)} />}
      {revoking && <RevokeDialog o={revoking} onClose={() => setRevoking(null)} />}
    </>
  );
}

function SubmissionRow({ s, canSubmit }: { s: Submission; canSubmit: boolean }) {
  const ack = useRecordAcknowledgement();
  const [showAck, setShowAck] = useState(false);
  const [code, setCode] = useState<AckCode>("AA");
  const [msgId, setMsgId] = useState("");
  const [errText, setErrText] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [openErr, setOpenErr] = useState<unknown>(null);
  return (
    <li className="space-y-1.5 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Send size={13} className="text-muted" aria-hidden />
        <span className="font-medium">{s.destination_name}</span>
        <Chip label={humanize(s.kind)} cssVar="--info" hollow />
        <Chip label={humanize(s.format)} cssVar="--muted" hollow />
        <span className="text-xs text-muted">v{s.version_number}</span>
        <span className="mono text-xs text-muted">{fmtTime(s.sent_at)}</span>
        {s.sent_by_name && <span className="text-xs text-ink2">{s.sent_by_name}</span>}
        {s.message_id && <span className="mono text-xs text-muted">{s.message_id}</span>}
        {s.payload_sha256 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs hover:underline"
            title={`payload sha256 ${s.payload_sha256} (opens /api/files/${s.payload_sha256.slice(0, 12)}…)`}
            onClick={() => {
              setOpenErr(null);
              openInNewTab(`/files/${s.payload_sha256}`).catch(setOpenErr);
            }}
          >
            <FileDown size={12} aria-hidden />
            payload
          </button>
        )}
        <span
          className="mono ml-auto text-xs text-muted"
          title={`version hash sent ${s.case_version_sha256}`}
        >
          {s.case_version_sha256.slice(0, 12)}…
        </span>
      </div>
      {s.note && <div className="text-xs text-ink2">{s.note}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {(s.acknowledgements ?? []).map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1">
            <MailCheck
              size={12}
              style={{
                color:
                  a.ack_code === "AR" || a.ack_code === "CR"
                    ? "var(--status-critical)"
                    : "var(--status-good)",
              }}
              aria-hidden
            />
            <span className="mono">{a.ack_code}</span>
            <span className="text-muted">{fmtTime(a.received_at)}</span>
            {a.error_text && (
              <span style={{ color: "var(--status-critical)" }}>{a.error_text}</span>
            )}
          </span>
        ))}
        {(s.acknowledgements ?? []).length === 0 && (
          <span className="text-muted">no acknowledgement</span>
        )}
        {canSubmit && !showAck && (
          <button
            type="button"
            className="text-muted hover:underline"
            onClick={() => setShowAck(true)}
          >
            record acknowledgement
          </button>
        )}
      </div>
      {showAck && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            ack.mutate(
              {
                submissionId: s.id,
                ack_code: code,
                ack_message_id: msgId.trim() || null,
                error_text: errText.trim() || null,
              },
              {
                onError: setErr,
                onSuccess: () => {
                  setShowAck(false);
                  setMsgId("");
                  setErrText("");
                },
              },
            );
          }}
        >
          <Field label="Ack code">
            <select
              value={code}
              onChange={(e) => setCode(e.target.value as AckCode)}
              className={inputCls}
            >
              {ACK_CODES.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ack message id">
            <input
              value={msgId}
              onChange={(e) => setMsgId(e.target.value)}
              className={`w-40 ${inputCls}`}
            />
          </Field>
          <Field label="Error text">
            <input
              value={errText}
              onChange={(e) => setErrText(e.target.value)}
              className={`w-56 ${inputCls}`}
            />
          </Field>
          <button type="submit" disabled={ack.isPending} className={buttonCls}>
            <MailCheck size={12} aria-hidden />
            {ack.isPending ? "Recording…" : "Record"}
          </button>
          <button type="button" onClick={() => setShowAck(false)} className={buttonCls}>
            Cancel
          </button>
          <ErrorNote error={err} className="w-full" />
        </form>
      )}
      <ErrorNote error={openErr} />
    </li>
  );
}

export function WaiveDialog({ o, onClose }: { o: Obligation; onClose: () => void }) {
  const waive = useWaive();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog title="Waive obligation" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          setErr(null);
          waive.mutate(
            { expectedSubmissionId: o.expected_submission_id, reason: reason.trim() },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          {o.rule_name} to {o.destination_name} (due {fmtDate(o.due_date)}). A waiver is a judgment
          with a reason; it stops the clock and stays in the record.
        </p>
        <Field label="Reason (required)">
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`w-full ${inputCls}`}
            required
          />
        </Field>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={waive.isPending || !reason.trim()}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            {waive.isPending ? "Recording…" : "Waive"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls}>
            Cancel
          </button>
        </div>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}

export function RevokeDialog({ o, onClose }: { o: Obligation; onClose: () => void }) {
  const revoke = useRevokeWaiver();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog title="Revoke waiver" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim() || !o.waiver_id) return;
          setErr(null);
          revoke.mutate(
            {
              expectedSubmissionId: o.expected_submission_id,
              waiverId: o.waiver_id,
              reason: reason.trim(),
            },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          {o.rule_name} to {o.destination_name}. Revoking is a dated fact; the obligation's clock
          resumes from its original day 0.
        </p>
        {o.waiver_reason && <p className="text-xs text-muted">Waived because: {o.waiver_reason}</p>}
        <Field label="Reason (required)">
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`w-full ${inputCls}`}
            required
          />
        </Field>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={revoke.isPending || !reason.trim()}
            className={primaryCls}
            style={{ background: "var(--status-serious)" }}
          >
            {revoke.isPending ? "Revoking…" : "Revoke waiver"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls}>
            Cancel
          </button>
        </div>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}

export function SubmissionDialog({
  c,
  prefill,
  onClose,
}: {
  c: CaseDetail;
  prefill: SubmissionPrefill;
  onClose: () => void;
}) {
  const { data: destinations } = useDestinations();
  const record = useRecordSubmission();
  const [destinationId, setDestinationId] = useState(prefill.destinationId ?? "");
  const [kind, setKind] = useState<SubmissionKind>(prefill.kind ?? "initial_report");
  const [format, setFormat] = useState<SubmissionFormat | "">("");
  const [payloadId, setPayloadId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const destination = destinations?.find((d) => d.id === destinationId);
  const effectiveFormat: SubmissionFormat | "" = format || destination?.default_format || "";
  const payloads = c.attachments.filter(
    (a) => a.kind === "submission_payload" && a.case_version_id === prefill.versionId,
  );
  const version = c.versions.find((v) => v.id === prefill.versionId);
  const approved = !!version?.signatures.some((s) => s.meaning === "approval");

  return (
    <Dialog title={`Record submission of v${prefill.versionNumber}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!destinationId || !effectiveFormat) return;
          setErr(null);
          record.mutate(
            {
              versionId: prefill.versionId,
              destination_id: destinationId,
              kind,
              format: effectiveFormat,
              payload_attachment_id: payloadId || null,
              message_id: messageId.trim() || null,
              note: note.trim() || null,
            },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          Records what was sent, bound to the version hash{" "}
          <span className="mono text-xs">{version?.sha256.slice(0, 12)}…</span>. For E2B(R3) JSON
          with no payload chosen, the server renders the export and stores the exact bytes.
        </p>
        {!approved && (
          <ErrorNote
            error={
              new Error(
                `v${prefill.versionNumber} has no approval signature; the server will refuse.`,
              )
            }
          />
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Destination">
            <select
              value={destinationId}
              onChange={(e) => {
                setDestinationId(e.target.value);
                setFormat("");
              }}
              className={`w-64 ${inputCls}`}
              required
            >
              <option value="">Select a destination</option>
              {destinations?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SubmissionKind)}
              className={inputCls}
            >
              {SUBMISSION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Format"
            hint={destination ? `default ${humanize(destination.default_format)}` : undefined}
          >
            <select
              value={effectiveFormat}
              onChange={(e) => setFormat(e.target.value as SubmissionFormat)}
              className={inputCls}
              required
            >
              <option value="">Select a format</option>
              {SUBMISSION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {humanize(f)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payload attachment" hint="optional">
            <select
              value={payloadId}
              onChange={(e) => setPayloadId(e.target.value)}
              className={`w-56 ${inputCls}`}
            >
              <option value="">
                {effectiveFormat === "e2b_r3_json" ? "Server renders E2B JSON" : "None recorded"}
              </option>
              {payloads.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.file_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Message id">
            <input
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
              className={`w-56 ${inputCls}`}
            />
          </Field>
          <Field label="Note" className="w-full">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`w-full ${inputCls}`}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={record.isPending || !destinationId || !effectiveFormat}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            <Send size={13} aria-hidden />
            {record.isPending ? "Recording…" : "Record submission"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls}>
            Cancel
          </button>
        </div>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
