import type { AuditEvent } from "./api";
import { fmtTime, humanize } from "./ui";

const show = (v: unknown): string =>
  v === null || v === undefined
    ? "null"
    : typeof v === "string"
      ? v
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);

/**
 * Before/after view of one audit row: for updates, only the keys that changed;
 * for inserts and deletes, the whole image on the side that has one.
 */
function Diff({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = keys.filter((k) => show(before[k]) !== show(after[k]));
  const both = Object.keys(before).length > 0 && Object.keys(after).length > 0;
  const rows = both ? changed : keys;
  return (
    <div className="mt-1 overflow-x-auto rounded bg-page">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted">
            <th className="px-2 py-1 text-left font-medium">field</th>
            <th className="px-2 py-1 text-left font-medium">before</th>
            <th className="px-2 py-1 text-left font-medium">after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k} className="border-t border-hairline align-top">
              <td className="mono px-2 py-1 text-ink2">{k}</td>
              <td className="mono max-w-xs break-all px-2 py-1 text-muted">
                {k in before ? show(before[k]) : ""}
              </td>
              <td className="mono max-w-xs break-all px-2 py-1 text-ink">
                {k in after ? show(after[k]) : ""}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-2 py-1 text-muted">
                no field changed
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Append-only audit rows with hash-chain fragments; used per-case and globally. */
export function AuditTimeline({
  events,
  onPickEntity,
}: {
  events: AuditEvent[] | undefined;
  onPickEntity?: (entityType: string, entityId: string) => void;
}) {
  if (!events) return null;
  if (events.length === 0) return <p className="px-4 py-3 text-sm text-muted">No events.</p>;
  return (
    <ol className="divide-y divide-hairline">
      {events.map((e) => {
        const before = e.before ?? null;
        const after = e.after ?? null;
        return (
          <li key={String(e.id)} className="px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="mono text-xs text-muted">#{e.id}</span>
              <span className="rounded bg-page px-1.5 py-0.5 text-xs font-medium">{e.action}</span>
              <span className="text-xs text-ink2">{e.actor_name ?? e.actor_label}</span>
              <span className="mono text-xs text-muted">{fmtTime(e.occurred_at)}</span>
              <span className="text-xs text-muted">
                {humanize(e.entity_type)}
                {e.entity_id && onPickEntity ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="mono hover:underline"
                      onClick={() => onPickEntity(e.entity_type, e.entity_id!)}
                      title="Filter to this record"
                    >
                      {e.entity_id.slice(0, 8)}
                    </button>
                  </>
                ) : e.entity_id ? (
                  <span className="mono"> {e.entity_id.slice(0, 8)}</span>
                ) : null}
              </span>
              <span
                className="mono ml-auto text-xs text-muted"
                title={`Each entry is chained to the one before it (prev ${e.prev_hash}). A break in the chain means the trail was altered.`}
              >
                {e.prev_hash.slice(0, 8)} → {e.hash.slice(0, 8)}
              </span>
            </div>
            {(before || after) && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted">what changed</summary>
                <Diff before={before ?? {}} after={after ?? {}} />
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
