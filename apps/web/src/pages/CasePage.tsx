import {
  Archive,
  ArrowLeft,
  Ban,
  Braces,
  EyeOff,
  FileClock,
  FileText,
  Layers,
  Link2,
  Link2Off,
  Lock,
  Paperclip,
  PenLine,
  Send,
  Stethoscope,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type AttachmentKind,
  type CaseDetail,
  type CaseUnblinding,
  type CaseVersion,
  can,
  type Me,
  openInNewTab,
  type SignatureMeaning,
  useCase,
  useCaseAudit,
  useMe,
  useNullify,
  useOpenVersion,
  useRuleMatches,
  useSign,
  useTransition,
  useUnblind,
  useUpdateVersionHeader,
  useUploadAttachment,
  type WorkflowState,
} from "../api";
import { AuditTimeline } from "../audit";
import { authMode } from "../auth";
import { CaseStateChip, DaysRemaining, ExpeditedChip } from "../status";
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
  LockNotice,
  localToday,
  Notice,
  n,
  PageState,
  primaryCls,
  tdCls,
  thCls,
} from "../ui";
import { ObligationsPanel, SubmissionDialog, type SubmissionPrefill } from "./CaseObligations";
import { SectionTabs } from "./CaseSections";

type DialogKind =
  | { kind: "transition"; to: WorkflowState }
  | { kind: "sign"; meaning: SignatureMeaning }
  | { kind: "submission"; prefill: SubmissionPrefill }
  | { kind: "version"; versionKind: "follow_up" | "amendment" }
  | { kind: "nullify" }
  | { kind: "unblind" };

export default function CasePage() {
  const { caseId } = useParams();
  const caseQuery = useCase(caseId);
  const c = caseQuery.data;
  const { data: me } = useMe();
  const { data: audit } = useCaseAudit(caseId);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [openErr, setOpenErr] = useState<unknown>(null);

  if (!c) return <PageState query={caseQuery} label="case" />;

  const versions = [...c.versions].sort((a, b) => a.version_number - b.version_number);
  const latest = versions[versions.length - 1]!;
  const v = versions.find((x) => x.id === versionId) ?? latest;
  const isLatest = v.id === latest.id;
  // Editable = the latest version, unsigned, on a live case. The server's 423
  // is the authority; this only decides which affordances render.
  const editable = isLatest && !v.is_locked && !c.is_nullified;
  const close = () => setDialog(null);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink2 hover:underline">
          <ArrowLeft size={14} aria-hidden />
          Case queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{c.sender_case_id}</h1>
          <span className="mono text-xs text-muted">{c.worldwide_unique_id}</span>
          <CaseStateChip state={c.state} />
          <ExpeditedChip cls={c.expedited_class} reason={c.reportability_reason} />
          <span className="text-xs text-ink2">{c.reportability_reason}</span>
          {c.is_blinded && !c.is_unblinded && (
            <Chip label="blinded" cssVar="--muted" hollow icon={<EyeOff size={11} aria-hidden />} />
          )}
          {c.is_unblinded && (
            <Chip label="unblinded" cssVar="--info" icon={<Unlock size={11} aria-hidden />} />
          )}
          {c.is_nullified && (
            <Chip
              label="nullified"
              cssVar="--status-critical"
              icon={<Ban size={11} aria-hidden />}
            />
          )}
          <Chip
            label={`${versions.length} version${versions.length === 1 ? "" : "s"}`}
            cssVar="--muted"
            hollow
            icon={<Layers size={11} aria-hidden />}
          />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink2">
          <span>
            {c.protocol_number ?? "no study"}
            {c.product_name ? ` · ${c.product_name}` : ""}
            {c.study_title ? ` · ${c.study_title}` : ""}
          </span>
          <span className="text-muted">first received {fmtDate(c.first_received_date)}</span>
          {c.next_due_date && (
            <span>
              next due <DaysRemaining days={c.days_remaining} due={c.next_due_date} />
            </span>
          )}
          <span className="text-muted">
            {n(c.open_obligations)} open / {n(c.overdue_obligations)} overdue obligations
          </span>
        </div>
      </div>

      <ActionBar c={c} latest={latest} me={me} open={setDialog} />

      <Card
        title="Version"
        aside={
          <>
            {versions.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setVersionId(x.id)}
                aria-pressed={x.id === v.id}
                className={`rounded-md border px-2 py-0.5 text-xs ${
                  x.id === v.id
                    ? "border-current font-medium text-ink"
                    : "border-hairline text-ink2"
                }`}
                title={`${humanize(x.kind)} · ${x.is_locked ? "locked" : "open"}`}
              >
                v{x.version_number}
                {x.is_locked && <Lock size={10} className="ml-1 inline" aria-hidden />}
              </button>
            ))}
            <button
              type="button"
              className={buttonCls}
              onClick={() => {
                setOpenErr(null);
                openInNewTab(`/case-versions/${v.id}/e2b.json`).catch(setOpenErr);
              }}
              title="E2B(R3)-shaped JSON export of this version (opens in a new tab)"
            >
              <Braces size={12} aria-hidden />
              E2B JSON
            </button>
          </>
        }
      >
        <VersionHeader
          v={v}
          isLatest={isLatest}
          editable={editable && can(me, "enter")}
          nullified={c.is_nullified}
        />
        <ErrorNote error={openErr} className="px-4 pb-3" />
      </Card>

      <Card>
        <SectionTabs
          c={c}
          v={v}
          editable={editable}
          canEnter={can(me, "enter")}
          canAssess={can(me, "assess")}
        />
      </Card>

      <ObligationsPanel
        c={c}
        me={me}
        onRecordSubmission={(prefill) => setDialog({ kind: "submission", prefill })}
      />

      <RuleMatches versionId={v.id} versionNumber={v.version_number} />

      <Attachments c={c} v={v} me={me} />

      <Signatures versions={versions} />

      <Facts c={c} versions={versions} />

      <Card
        title={
          <>
            Audit trail{" "}
            <span className="text-xs font-normal text-muted">
              append-only, hash-chained; written by database triggers
            </span>
          </>
        }
      >
        {audit ? <AuditTimeline events={audit} /> : <Empty>Loading audit trail…</Empty>}
      </Card>

      {dialog?.kind === "transition" && (
        <TransitionDialog c={c} latest={latest} to={dialog.to} onClose={close} />
      )}
      {dialog?.kind === "sign" && (
        <SignDialog latest={latest} meaning={dialog.meaning} me={me} onClose={close} />
      )}
      {dialog?.kind === "submission" && (
        <SubmissionDialog c={c} prefill={dialog.prefill} onClose={close} />
      )}
      {dialog?.kind === "version" && (
        <OpenVersionDialog c={c} versionKind={dialog.versionKind} onClose={close} />
      )}
      {dialog?.kind === "nullify" && <NullifyDialog c={c} onClose={close} />}
      {dialog?.kind === "unblind" && <UnblindDialog c={c} onClose={close} />}
    </div>
  );
}

// --- Action bar --------------------------------------------------------------------------

function ActionBar({
  c,
  latest,
  me,
  open,
}: {
  c: CaseDetail;
  latest: CaseVersion;
  me: Me | undefined;
  open: (d: DialogKind) => void;
}) {
  const s = c.state;
  const live = !c.is_nullified;
  const reviewSigned = latest.signatures.some((x) => x.meaning === "medical_review");
  const approved = latest.signatures.some((x) => x.meaning === "approval");
  const noOpen = n(c.open_obligations) === 0;
  const items: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    primary?: boolean;
    title?: string;
  }[] = [];

  if (live && can(me, "enter") && s === "data_entry" && !latest.is_locked)
    items.push({
      label: "Send to medical review",
      icon: <Stethoscope size={12} aria-hidden />,
      onClick: () => open({ kind: "transition", to: "medical_review" }),
      primary: true,
    });
  if (live && can(me, "assess") && s === "medical_review")
    items.push({
      label: "Return to data entry",
      icon: <Undo2 size={12} aria-hidden />,
      onClick: () => open({ kind: "transition", to: "data_entry" }),
    });
  if (live && can(me, "sign") && s === "medical_review" && !reviewSigned)
    items.push({
      label: "Sign medical review",
      icon: <PenLine size={12} aria-hidden />,
      onClick: () => open({ kind: "sign", meaning: "medical_review" }),
      primary: true,
    });
  if (live && can(me, "sign") && s === "medical_review" && reviewSigned && !approved)
    items.push({
      label: "Approve",
      icon: <PenLine size={12} aria-hidden />,
      onClick: () => open({ kind: "sign", meaning: "approval" }),
      primary: true,
    });
  if (live && can(me, "submit") && (s === "approved" || s === "submitted"))
    items.push({
      label: "Record submission",
      icon: <Send size={12} aria-hidden />,
      onClick: () =>
        open({
          kind: "submission",
          prefill: { versionId: latest.id, versionNumber: latest.version_number },
        }),
      primary: s === "approved",
    });
  if (live && can(me, "enter") && latest.is_locked) {
    items.push({
      label: "Open follow-up",
      icon: <FileClock size={12} aria-hidden />,
      onClick: () => open({ kind: "version", versionKind: "follow_up" }),
    });
    items.push({
      label: "Open amendment",
      icon: <FileText size={12} aria-hidden />,
      onClick: () => open({ kind: "version", versionKind: "amendment" }),
    });
  }
  if (live && can(me, "assess") && c.is_blinded && !c.is_unblinded)
    items.push({
      label: "Record unblinding",
      icon: <Unlock size={12} aria-hidden />,
      onClick: () => open({ kind: "unblind" }),
    });
  if (
    live &&
    can(me, "submit") &&
    s !== "closed" &&
    s !== "intake" &&
    (s === "approved" || s === "submitted" || noOpen)
  )
    items.push({
      label: "Close",
      icon: <Archive size={12} aria-hidden />,
      onClick: () => open({ kind: "transition", to: "closed" }),
      title: noOpen ? undefined : "Open obligations remain; closing records intent only",
    });
  if (live && can(me, "enter"))
    items.push({
      label: "Nullify",
      icon: <Ban size={12} aria-hidden />,
      onClick: () => open({ kind: "nullify" }),
    });

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted">
        {c.is_nullified
          ? "Nullified: no further changes are accepted."
          : "No actions available for your role in this state."}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.onClick}
          title={it.title}
          className={it.primary ? primaryCls : buttonCls}
          style={it.primary ? { background: "var(--info)" } : undefined}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

// --- Version header (receipt date, day zero) --------------------------------------------------

function VersionHeader({
  v,
  isLatest,
  editable,
  nullified,
}: {
  v: CaseVersion;
  isLatest: boolean;
  editable: boolean;
  nullified: boolean;
}) {
  const update = useUpdateVersionHeader();
  const [editing, setEditing] = useState(false);
  const [received, setReceived] = useState(v.info_received_date);
  const [awareness, setAwareness] = useState(v.awareness_date);
  const [rationale, setRationale] = useState(v.awareness_rationale ?? "");
  const [err, setErr] = useState<unknown>(null);
  const needsRationale = awareness !== received;

  return (
    <div className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">
          v{v.version_number} · {humanize(v.kind)}
        </span>
        {!editing && (
          <>
            <span className="text-ink2">
              received <span className="mono">{fmtDate(v.info_received_date)}</span>
            </span>
            <span className="text-ink2">
              awareness (day 0) <span className="mono">{fmtDate(v.awareness_date)}</span>
            </span>
            {v.awareness_rationale && (
              <span className="text-xs text-muted">rationale: {v.awareness_rationale}</span>
            )}
          </>
        )}
        <span className="text-xs text-muted">
          {v.dictionary_version ? `MedDRA ${v.dictionary_version}` : "no dictionary"}
          {v.is_demo_subset ? " (demo subset)" : ""}
        </span>
        <span className="mono text-xs text-muted" title={`version hash ${v.sha256}`}>
          {v.sha256.slice(0, 12)}…
        </span>
        <span className="text-xs text-muted">
          by {v.created_by_name ?? "unknown"} {fmtTime(v.created_at)}
        </span>
        {editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`ml-auto ${buttonCls}`}>
            <PenLine size={12} aria-hidden />
            Edit dates
          </button>
        )}
      </div>
      {editing && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsRationale && !rationale.trim()) return;
            setErr(null);
            update.mutate(
              {
                versionId: v.id,
                info_received_date: received,
                awareness_date: awareness,
                awareness_rationale: needsRationale ? rationale.trim() : null,
              },
              { onError: setErr, onSuccess: () => setEditing(false) },
            );
          }}
        >
          <Field label="Information received">
            <input
              type="date"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Awareness date (day 0)">
            <input
              type="date"
              value={awareness}
              onChange={(e) => setAwareness(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          {needsRationale && (
            <Field label="Rationale" hint="required when day 0 differs">
              <input
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                className={`w-72 ${inputCls}`}
                required
              />
            </Field>
          )}
          <button type="submit" disabled={update.isPending} className={buttonCls}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={buttonCls}>
            Cancel
          </button>
          <ErrorNote error={err} className="w-full" />
        </form>
      )}
      {v.is_locked ? (
        <LockNotice />
      ) : !isLatest ? (
        <Notice tone="muted">Older version: read-only.</Notice>
      ) : nullified ? (
        <Notice tone="muted">Nullified: no further changes are accepted.</Notice>
      ) : null}
      {!v.minimum_criteria_met && (
        <Notice tone="warn">
          Below the E2B(R3) minimum criteria for a valid ICSR. Missing: {v.missing.join(", ")}. No
          signature, medical review, or submission is possible until these are entered.
        </Notice>
      )}
    </div>
  );
}

// --- Rule matches ---------------------------------------------------------------------------

function RuleMatches({ versionId, versionNumber }: { versionId: string; versionNumber: number }) {
  const q = useRuleMatches(versionId);
  return (
    <Card
      title="Rule matches"
      aside={<span className="text-xs text-muted">why each rule applies to v{versionNumber}</span>}
    >
      {!q.data ? (
        <div className="px-4 py-3">
          <PageState query={q} label="rule matches" />
        </div>
      ) : q.data.length === 0 ? (
        <Empty>No reporting rule matches this version.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thCls}>Rule</th>
                <th className={thCls}>Destination</th>
                <th className={thCls}>Kind</th>
                <th className={`${thCls} text-right`}>Timeline</th>
                <th className={thCls}>Day 0</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {q.data.map((m) => (
                <tr key={`${m.reporting_rule_id}-${m.obligation_kind}`}>
                  <td className={tdCls}>
                    <div>{m.rule_name}</div>
                    {m.citation && <div className="text-xs text-muted">{m.citation}</div>}
                  </td>
                  <td className={tdCls}>{m.destination_name}</td>
                  <td className={tdCls}>{humanize(m.obligation_kind)}</td>
                  <td className={`${tdCls} mono text-right`}>{m.timeline_days} d</td>
                  <td className={`${tdCls} mono`}>{fmtDate(m.clock_start_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --- Attachments ------------------------------------------------------------------------------

const ATTACHMENT_KINDS: AttachmentKind[] = [
  "source_document",
  "correspondence",
  "submission_payload",
];

function Attachments({ c, v, me }: { c: CaseDetail; v: CaseVersion; me: Me | undefined }) {
  const upload = useUploadAttachment();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>("source_document");
  const [err, setErr] = useState<unknown>(null);
  const [openErr, setOpenErr] = useState<unknown>(null);
  return (
    <Card
      title="Attachments"
      aside={
        can(me, "enter") &&
        !c.is_nullified && (
          <>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AttachmentKind)}
              className={inputCls}
              aria-label="Attachment kind"
            >
              {ATTACHMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setErr(null);
                upload.mutate({ caseId: c.id, file, kind, versionId: v.id }, { onError: setErr });
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className={buttonCls}
              title={`Attach to v${v.version_number}`}
            >
              <Upload size={12} aria-hidden />
              {upload.isPending ? "Uploading…" : `Upload to v${v.version_number}`}
            </button>
          </>
        )
      }
    >
      <ErrorNote error={err ?? openErr} className="px-4 pt-2" />
      {c.attachments.length === 0 ? (
        <Empty>No attachments.</Empty>
      ) : (
        <ul className="divide-y divide-hairline">
          {c.attachments.map((a) => {
            const ver = c.versions.find((x) => x.id === a.case_version_id);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
              >
                <Paperclip size={13} className="text-muted" aria-hidden />
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => {
                    setOpenErr(null);
                    openInNewTab(`/files/${a.sha256}`).catch(setOpenErr);
                  }}
                  title="Open (authenticated fetch of the content-addressed bytes)"
                >
                  {a.file_name}
                </button>
                <Chip label={humanize(a.kind)} cssVar="--muted" hollow />
                <span className="text-xs text-muted">
                  {(a.size_bytes / 1024).toFixed(1)} kB · {a.mime_type}
                  {ver ? ` · v${ver.version_number}` : ""}
                  {a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ""} · {fmtTime(a.created_at)}
                </span>
                <span className="mono ml-auto text-xs text-muted" title={`sha256 ${a.sha256}`}>
                  {a.sha256.slice(0, 12)}…
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// --- Signatures -----------------------------------------------------------------------------

function Signatures({ versions }: { versions: CaseVersion[] }) {
  const sigs = versions.flatMap((v) => v.signatures.map((s) => ({ v, s })));
  return (
    <Card title="Signatures">
      {sigs.length === 0 ? (
        <Empty>No signatures.</Empty>
      ) : (
        <ul className="divide-y divide-hairline">
          {sigs.map(({ v, s }) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <PenLine size={13} style={{ color: "var(--status-good)" }} aria-hidden />
              <span className="font-medium">{s.signer_name ?? s.signer_person_id.slice(0, 8)}</span>
              <span className="text-xs text-ink2">{humanize(s.meaning)}</span>
              <span className="text-xs text-muted">v{v.version_number}</span>
              <span className="mono text-xs text-muted">{fmtTime(s.signed_at)}</span>
              <span className="text-xs text-muted">reauth: {s.reauth_method}</span>
              <span
                className="ml-auto inline-flex items-center gap-1 text-xs"
                style={{ color: s.hash_matches ? "var(--status-good)" : "var(--status-critical)" }}
                title={`signed hash ${s.signed_sha256}; the version's current hash is recomputed on every read`}
              >
                {s.hash_matches ? (
                  <Link2 size={12} aria-hidden />
                ) : (
                  <Link2Off size={12} aria-hidden />
                )}
                {s.hash_matches ? "hash matches" : "HASH MISMATCH"}{" "}
                <span className="mono">{s.signed_sha256.slice(0, 12)}…</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Facts -------------------------------------------------------------------------------------

function Facts({ c, versions }: { c: CaseDetail; versions: CaseVersion[] }) {
  const transitions = versions.flatMap((v) => v.transitions.map((t) => ({ v, t })));
  return (
    <Card title="Facts">
      <div className="space-y-3 px-4 py-3 text-sm">
        <div>
          <div className="text-xs font-medium text-muted">Unblinding</div>
          {c.unblinding ? (
            <p>
              <span className="font-medium">{c.unblinding.arm_label}</span>{" "}
              <span className="text-ink2">({c.unblinding.arm_role})</span> ·{" "}
              <span className="mono text-xs">{fmtTime(c.unblinding.unblinded_at)}</span>
              {c.unblinding.by_name ? ` · ${c.unblinding.by_name}` : ""}
              {c.unblinding.source_system
                ? ` · ${c.unblinding.source_system}${c.unblinding.source_ref ? ` ${c.unblinding.source_ref}` : ""}`
                : ""}
              <span className="block text-xs text-ink2">{c.unblinding.reason}</span>
            </p>
          ) : (
            <p className="text-muted">{c.is_blinded ? "Still blinded." : "Open-label study."}</p>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-muted">Nullification</div>
          {c.nullification ? (
            <p>
              <span className="mono text-xs">{fmtTime(c.nullification.nullified_at)}</span>
              {c.nullification.by_name ? ` · ${c.nullification.by_name}` : ""}
              <span className="block text-xs text-ink2">{c.nullification.reason}</span>
            </p>
          ) : (
            <p className="text-muted">Not nullified.</p>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-muted">Transitions</div>
          {transitions.length === 0 ? (
            <p className="text-muted">No transitions recorded.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {transitions.map(({ v, t }) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 py-1">
                  <span className="text-xs text-muted">v{v.version_number}</span>
                  <span className="font-medium">{humanize(t.to_state)}</span>
                  <span className="mono text-xs text-muted">{fmtTime(t.transitioned_at)}</span>
                  {t.by_name && <span className="text-xs text-ink2">{t.by_name}</span>}
                  {t.note && <span className="text-xs text-ink2">“{t.note}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// --- Dialogs -----------------------------------------------------------------------------------

const TRANSITION_COPY: Record<WorkflowState, { title: string; body: string; needsNote: boolean }> =
  {
    medical_review: {
      title: "Send to medical review",
      body: "Records the intent transition. The reviewer assesses causality and expectedness, then signs.",
      needsNote: false,
    },
    data_entry: {
      title: "Return to data entry",
      body: "Sends the version back with your note. The note is part of the case's permanent record.",
      needsNote: true,
    },
    closed: {
      title: "Close case",
      body: "Records the closed intent on the latest version. Obligation clocks are unaffected.",
      needsNote: false,
    },
  };

function TransitionDialog({
  c,
  latest,
  to,
  onClose,
}: {
  c: CaseDetail;
  latest: CaseVersion;
  to: WorkflowState;
  onClose: () => void;
}) {
  const transition = useTransition();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const copy = TRANSITION_COPY[to];
  return (
    <Dialog title={copy.title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (copy.needsNote && !note.trim()) return;
          setErr(null);
          transition.mutate(
            { versionId: latest.id, to_state: to, note: note.trim() || undefined },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          {c.sender_case_id} v{latest.version_number}. {copy.body}
        </p>
        <Field label={copy.needsNote ? "Note (required)" : "Note (optional)"}>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`w-full ${inputCls}`}
            required={copy.needsNote}
          />
        </Field>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={transition.isPending || (copy.needsNote && !note.trim())}
            className={primaryCls}
            style={{ background: to === "data_entry" ? "var(--status-serious)" : "var(--info)" }}
          >
            {transition.isPending ? "Recording…" : copy.title}
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

const SIGN_COPY: Record<SignatureMeaning, string> = {
  medical_review:
    'Signing records your name, the date and time, and the meaning "medical review", bound to the hash of this exact version. The first signature locks the version.',
  approval:
    'Signing records your name, the date and time, and the meaning "approval", bound to the hash of this exact version. Submissions require this signature.',
};

function SignDialog({
  latest,
  meaning,
  me,
  onClose,
}: {
  latest: CaseVersion;
  meaning: SignatureMeaning;
  me: Me | undefined;
  onClose: () => void;
}) {
  const sign = useSign();
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog
      title={meaning === "approval" ? "Approve and sign" : "Sign medical review"}
      onClose={onClose}
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink2">{SIGN_COPY[meaning]}</p>
        <Notice tone="info">
          <span className="font-medium">Re-authenticate to sign.</span>{" "}
          {authMode === "dev"
            ? `Dev mode: confirming restates the bearer token for ${me?.label ?? "this identity"} as proof of re-authentication (§11.200).`
            : "You will be asked to sign in again; the fresh token is sent as proof of re-authentication (§11.200)."}
        </Notice>
        <p className="mono text-xs text-muted">
          v{latest.version_number} · {latest.sha256}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sign.isPending}
            onClick={() => {
              setErr(null);
              sign.mutate(
                { versionId: latest.id, meaning },
                { onError: setErr, onSuccess: onClose },
              );
            }}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            <PenLine size={13} aria-hidden />
            {sign.isPending ? "Signing…" : "Confirm identity and sign"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls}>
            Cancel
          </button>
        </div>
        <ErrorNote error={err} />
      </div>
    </Dialog>
  );
}

function OpenVersionDialog({
  c,
  versionKind,
  onClose,
}: {
  c: CaseDetail;
  versionKind: "follow_up" | "amendment";
  onClose: () => void;
}) {
  const openVersion = useOpenVersion();
  const today = localToday();
  const [received, setReceived] = useState(today);
  const [awareness, setAwareness] = useState(today);
  const [rationale, setRationale] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const needsRationale = awareness !== received;
  return (
    <Dialog
      title={versionKind === "follow_up" ? "Open follow-up" : "Open amendment"}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (needsRationale && !rationale.trim()) return;
          setErr(null);
          openVersion.mutate(
            {
              caseId: c.id,
              kind: versionKind,
              info_received_date: received,
              awareness_date: awareness,
              awareness_rationale: needsRationale ? rationale.trim() : null,
            },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          Clones the latest version of {c.sender_case_id} into a new editable version.
          {versionKind === "follow_up"
            ? " New information starts a follow-up clock."
            : " An amendment corrects the record without new information."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Information received">
            <input
              type="date"
              value={received}
              onChange={(e) => {
                if (awareness === received) setAwareness(e.target.value);
                setReceived(e.target.value);
              }}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Awareness date (day 0)">
            <input
              type="date"
              value={awareness}
              onChange={(e) => setAwareness(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          {needsRationale && (
            <Field label="Rationale" className="w-full">
              <input
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                className={`w-full ${inputCls}`}
                required
              />
            </Field>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={openVersion.isPending}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            {openVersion.isPending ? "Opening…" : "Open version"}
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

function NullifyDialog({ c, onClose }: { c: CaseDetail; onClose: () => void }) {
  const nullify = useNullify();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog title="Nullify case" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          setErr(null);
          nullify.mutate(
            { caseId: c.id, reason: reason.trim() },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          Marks {c.sender_case_id} as nullified (E2B(R3) C.1.11.1). No further versions are
          accepted; nullification obligations may materialize.
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
            disabled={nullify.isPending || !reason.trim()}
            className={primaryCls}
            style={{ background: "var(--status-critical)" }}
          >
            <Ban size={13} aria-hidden />
            {nullify.isPending ? "Nullifying…" : "Nullify"}
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

const ARM_ROLES: CaseUnblinding["arm_role"][] = ["imp", "comparator", "placebo", "background"];

function UnblindDialog({ c, onClose }: { c: CaseDetail; onClose: () => void }) {
  const unblind = useUnblind();
  const [arm, setArm] = useState("");
  const [role, setRole] = useState<CaseUnblinding["arm_role"]>("imp");
  const [reason, setReason] = useState("");
  const [system, setSystem] = useState("");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <Dialog title="Record unblinding" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!arm.trim() || !reason.trim()) return;
          setErr(null);
          unblind.mutate(
            {
              caseId: c.id,
              arm_label: arm.trim(),
              arm_role: role,
              reason: reason.trim(),
              source_system: system.trim() || null,
              source_ref: ref.trim() || null,
            },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          Records the unblinding fact for {c.sender_case_id}. The randomization system did the
          code-break; this is the record of what it revealed and why.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Arm label">
            <input
              value={arm}
              onChange={(e) => setArm(e.target.value)}
              className={`w-48 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Arm role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as CaseUnblinding["arm_role"])}
              className={inputCls}
            >
              {ARM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source system">
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="e.g. rtsm-core"
              className={`w-36 ${inputCls}`}
            />
          </Field>
          <Field label="Source ref">
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className={`w-36 ${inputCls}`}
            />
          </Field>
          <Field label="Reason (required)" className="w-full">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`w-full ${inputCls}`}
              required
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={unblind.isPending || !arm.trim() || !reason.trim()}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            <Unlock size={13} aria-hidden />
            {unblind.isPending ? "Recording…" : "Record unblinding"}
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
