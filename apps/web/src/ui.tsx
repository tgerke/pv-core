import clsx from "clsx";
import { Check, CircleAlert, ClipboardCopy, Lock, X } from "lucide-react";
import { cloneElement, isValidElement, type ReactNode, useEffect, useId, useState } from "react";
import { errorMessage } from "./api";

// Shared form styling: every field is a visible label above its input, laid
// out with `flex flex-wrap items-end`.
export const inputCls =
  "rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink disabled:opacity-60";
export const buttonCls =
  "inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-xs text-ink2 hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed";
export const primaryCls =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed";
export const fieldCls = "flex flex-col gap-1 text-xs text-ink2";
export const thCls = "px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap";
export const tdCls = "px-3 py-2 align-top text-sm";
export const linkCls = "text-info hover:underline";

/** Counts arrive as strings (Postgres bigint); coerce for arithmetic and display. */
export const n = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v);

/** Dates are YYYY-MM-DD from the API and display as-is. */
export const fmtDate = (d: string | null | undefined): string => (d ? d.slice(0, 10) : "");

/** Timestamps display to the minute, locale-independent, as the API sent them. */
export const fmtTime = (t: string | null | undefined): string =>
  t ? t.replace("T", " ").slice(0, 16) : "";

/** Today as YYYY-MM-DD in the user's time zone. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const humanize = (s: string | null | undefined): string => (s ?? "").replace(/_/g, " ");

export function Card({
  title,
  aside,
  children,
  className,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("card", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
          {title && <h2 className="font-medium">{title}</h2>}
          {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Small colored pill; `cssVar` is a design-token custom property name. */
export function Chip({
  label,
  cssVar = "--muted",
  hollow,
  icon,
  title,
}: {
  label: ReactNode;
  cssVar?: string;
  hollow?: boolean;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(${cssVar})`,
        borderColor: `color-mix(in srgb, var(${cssVar}) 40%, transparent)`,
        background: hollow ? "transparent" : `color-mix(in srgb, var(${cssVar}) 12%, transparent)`,
      }}
    >
      {icon}
      <span className="text-ink2">{label}</span>
    </span>
  );
}

const LABELABLE = new Set(["input", "select", "textarea"]);

/**
 * Visible label above its control. A plain input/select/textarea child gets an
 * explicit htmlFor id; anything else (a group of inputs, a typeahead) stays
 * associated by wrapping.
 */
export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  const generated = useId();
  const labelable =
    isValidElement<{ id?: string }>(children) &&
    typeof children.type === "string" &&
    LABELABLE.has(children.type);
  const id = labelable ? (children.props.id ?? generated) : undefined;
  const control = labelable && !children.props.id ? cloneElement(children, { id }) : children;
  return (
    <label htmlFor={id} className={clsx(fieldCls, className)}>
      <span>
        {label}
        {hint && <span className="ml-1 text-muted">{hint}</span>}
      </span>
      {control}
    </label>
  );
}

/** Plain-language error line for failed mutations; renders nothing when clear. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (error == null) return null;
  return (
    <div
      className={clsx("flex items-start gap-1 text-xs", className)}
      style={{ color: "var(--status-critical)" }}
      role="alert"
    >
      <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

/** Loading / error / not-found states for a page's primary query. */
export function PageState({
  query,
  label,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown };
  label: string;
}) {
  if (query.isError)
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-critical)" }}>
        <CircleAlert size={14} aria-hidden />
        <span>
          Couldn't load the {label}. {errorMessage(query.error)}
        </span>
      </div>
    );
  if (query.isPending) return <div className="text-sm text-ink2">Loading {label}…</div>;
  return (
    <div className="text-sm text-ink2">
      No {label} found. It may have been removed, or the link may be out of date.
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "critical" | "muted";
  className?: string;
}) {
  const cssVar =
    tone === "warn"
      ? "--status-warn"
      : tone === "critical"
        ? "--status-critical"
        : tone === "muted"
          ? "--muted"
          : "--info";
  return (
    <div
      className={clsx("rounded-md border px-3 py-2 text-sm text-ink2", className)}
      style={{
        borderColor: `color-mix(in srgb, var(${cssVar}) 40%, transparent)`,
        background: `color-mix(in srgb, var(${cssVar}) 8%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}

export function LockNotice({ children }: { children?: ReactNode }) {
  return (
    <Notice tone="muted" className="flex items-center gap-2">
      <Lock size={13} className="shrink-0" aria-hidden />
      <span>{children ?? "Locked by signature; open a follow-up to change."}</span>
    </Notice>
  );
}

/** Modal panel; closes on Escape or the close button. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:py-12">
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("card w-full shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <h2 className="font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md p-1 text-ink2 hover:bg-page"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-hairline px-2" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            value === t.id
              ? "border-current font-medium text-ink"
              : "border-transparent text-ink2 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({
  label,
  value,
  cssVar,
  hint,
}: {
  label: string;
  value: ReactNode;
  cssVar?: string;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div
        className="mono mt-1 text-2xl font-semibold"
        style={cssVar ? { color: `var(${cssVar})` } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/** Copies tab-separated rows to the clipboard; the only export DSUR tables need. */
export function CopyTsvButton({ header, rows }: { header: string[]; rows: string[][] }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={buttonCls}
        onClick={async () => {
          setErr(null);
          const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
          const text = [header, ...rows].map((r) => r.map(clean).join("\t")).join("\n");
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch (e) {
            setErr(e);
          }
        }}
      >
        {done ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
        {done ? "Copied" : "Copy as TSV"}
      </button>
      <ErrorNote error={err} />
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-muted">{children}</p>;
}

/** Yes/no/unknown for nullable booleans. */
export const yn = (v: boolean | null | undefined): string =>
  v === true ? "yes" : v === false ? "no" : "unassessed";
