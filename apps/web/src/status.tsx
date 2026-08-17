import {
  Archive,
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  Hourglass,
  Inbox,
  type LucideIcon,
  PenLine,
  Send,
  Stethoscope,
} from "lucide-react";
import type { CaseState, ExpeditedClass, ObligationStatus } from "./api";
import { Chip } from "./ui";

/** Status is never color-alone: every rendering pairs icon + label. */
export interface StatusSpec {
  label: string;
  icon: LucideIcon;
  cssVar: string;
  hollow?: boolean;
}

/** Derived case states (v_case_queue precedence): never stored, always recomputed. */
export const CASE_STATE: Record<CaseState, StatusSpec> = {
  intake: { label: "Intake", icon: Inbox, cssVar: "--status-warn", hollow: true },
  data_entry: { label: "Data entry", icon: PenLine, cssVar: "--info" },
  medical_review: { label: "Medical review", icon: Stethoscope, cssVar: "--status-serious" },
  approved: { label: "Approved", icon: CircleCheck, cssVar: "--status-good" },
  submitted: { label: "Submitted", icon: Send, cssVar: "--status-good" },
  closed: { label: "Closed", icon: Archive, cssVar: "--muted" },
  nullified: { label: "Nullified", icon: Ban, cssVar: "--muted", hollow: true },
};

export const CASE_STATES = Object.keys(CASE_STATE) as CaseState[];

/** Obligation clocks (v_expected_submission_status), derived on every read. */
export const OBLIGATION_STATUS: Record<ObligationStatus, StatusSpec> = {
  overdue: { label: "Overdue", icon: CircleAlert, cssVar: "--status-critical" },
  due_soon: { label: "Due soon", icon: Clock, cssVar: "--status-warn" },
  pending: { label: "Pending", icon: Hourglass, cssVar: "--info", hollow: true },
  submitted: { label: "Submitted", icon: Send, cssVar: "--status-good" },
  acknowledged: { label: "Acknowledged", icon: Check, cssVar: "--status-good" },
  superseded_by_follow_up: { label: "Superseded", icon: CircleDashed, cssVar: "--muted" },
  not_required: { label: "Waived", icon: CircleSlash, cssVar: "--muted" },
};

export const OBLIGATION_STATUSES = Object.keys(OBLIGATION_STATUS) as ObligationStatus[];

export function SpecChip({ spec, title }: { spec: StatusSpec; title?: string }) {
  const Icon = spec.icon;
  return (
    <Chip
      label={spec.label}
      cssVar={spec.cssVar}
      hollow={spec.hollow}
      title={title}
      icon={<Icon size={12} strokeWidth={2.5} aria-hidden />}
    />
  );
}

export function CaseStateChip({ state }: { state: CaseState }) {
  const spec = CASE_STATE[state] ?? { label: state, icon: CircleDashed, cssVar: "--muted" };
  return <SpecChip spec={spec} />;
}

export function ObligationStatusChip({ status }: { status: ObligationStatus }) {
  const spec = OBLIGATION_STATUS[status] ?? {
    label: status,
    icon: CircleDashed,
    cssVar: "--muted",
  };
  return <SpecChip spec={spec} />;
}

/** Expedited class from the reportability verdict: 7-day, 15-day, or none. */
export function ExpeditedChip({ cls, reason }: { cls: ExpeditedClass; reason?: string }) {
  if (cls === "none") return <Chip label="not expedited" cssVar="--muted" hollow title={reason} />;
  return (
    <Chip
      label={cls === "7d" ? "7-day" : "15-day"}
      cssVar={cls === "7d" ? "--status-critical" : "--status-serious"}
      title={reason}
    />
  );
}

/** Days remaining on the nearest open clock: red when overdue, amber when three days or fewer. */
export function DaysRemaining({ days, due }: { days: number | null; due?: string | null }) {
  if (days === null || days === undefined) return <span className="text-muted">-</span>;
  const cssVar = days < 0 ? "--status-critical" : days <= 3 ? "--status-warn" : "--ink2";
  const text = days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `${days}d left`;
  return (
    <span
      className="whitespace-nowrap"
      style={{ color: `var(${cssVar})` }}
      title={due ?? undefined}
    >
      {due && <span className="mono mr-1 text-xs">{due}</span>}
      <span className="text-xs font-medium">{text}</span>
    </span>
  );
}
