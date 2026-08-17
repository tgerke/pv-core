import { ShieldCheck, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuditEvents, useChainStatus, useSignatureIntegrity } from "../api";
import { AuditTimeline } from "../audit";
import {
  buttonCls,
  Card,
  Empty,
  fmtTime,
  humanize,
  inputCls,
  linkCls,
  PageState,
  StatTile,
  tdCls,
  thCls,
} from "../ui";

export default function Audit() {
  const chain = useChainStatus();
  const integrity = useSignatureIntegrity();
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [entityIdInput, setEntityIdInput] = useState("");
  const events = useAuditEvents({
    entityType: entityType || undefined,
    entityId: entityId || undefined,
    limit: 500,
  });
  const allTypes = useAuditEvents({ limit: 500 });
  // Filter options come from the events themselves, not a hardcoded list.
  const types = useMemo(
    () => [...new Set((allTypes.data ?? []).map((e) => e.entity_type))].sort(),
    [allTypes.data],
  );
  const mismatches = (integrity.data ?? []).filter((s) => !s.hash_matches).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink2">
          Every write is an append-only, hash-chained audit row written by database triggers. The
          chain is replayed on demand; every signature's version hash is recomputed on every read.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card px-4 py-3">
          <div className="text-xs text-muted">Audit chain</div>
          {chain.data ? (
            <div
              className="mt-1 flex items-center gap-2 text-lg font-semibold"
              style={{ color: chain.data.ok ? "var(--status-good)" : "var(--status-critical)" }}
            >
              {chain.data.ok ? (
                <ShieldCheck size={18} aria-hidden />
              ) : (
                <ShieldX size={18} aria-hidden />
              )}
              {chain.data.ok ? "verified" : "BROKEN"}
            </div>
          ) : (
            <PageState query={chain} label="chain status" />
          )}
        </div>
        <StatTile label="Chained events" value={chain.data?.events ?? "…"} />
        <StatTile
          label="Signature hash mismatches"
          value={integrity.data ? mismatches : "…"}
          cssVar={mismatches > 0 ? "--status-critical" : "--status-good"}
        />
      </div>

      {chain.data && chain.data.problems.length > 0 && (
        <Card title="Chain problems">
          <pre
            className="mono overflow-x-auto px-4 py-3 text-xs"
            style={{ color: "var(--status-critical)" }}
          >
            {JSON.stringify(chain.data.problems, null, 2)}
          </pre>
        </Card>
      )}

      <Card
        title="Signature integrity"
        aside={
          <span className="text-xs text-muted">
            §11.70: signed hash versus the version hash now
          </span>
        }
      >
        {!integrity.data ? (
          <div className="px-4 py-3">
            <PageState query={integrity} label="signature integrity" />
          </div>
        ) : integrity.data.length === 0 ? (
          <Empty>No signatures.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  <th className={thCls}>Case</th>
                  <th className={thCls}>Meaning</th>
                  <th className={thCls}>Signed</th>
                  <th className={thCls}>Signed hash</th>
                  <th className={thCls}>Current hash</th>
                  <th className={thCls}>Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {integrity.data.map((s) => (
                  <tr key={s.signature_id}>
                    <td className={tdCls}>
                      <Link to={`/cases/${s.case_id}`} className={linkCls}>
                        {s.sender_case_id}
                      </Link>
                    </td>
                    <td className={tdCls}>{humanize(s.meaning)}</td>
                    <td className={`${tdCls} mono text-xs`}>{fmtTime(s.signed_at)}</td>
                    <td className={`${tdCls} mono text-xs`} title={s.signed_sha256}>
                      {s.signed_sha256.slice(0, 16)}…
                    </td>
                    <td className={`${tdCls} mono text-xs`} title={s.current_sha256}>
                      {s.current_sha256.slice(0, 16)}…
                    </td>
                    <td className={tdCls}>
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium"
                        style={{
                          color: s.hash_matches ? "var(--status-good)" : "var(--status-critical)",
                        }}
                      >
                        {s.hash_matches ? (
                          <ShieldCheck size={13} aria-hidden />
                        ) : (
                          <ShieldX size={13} aria-hidden />
                        )}
                        {s.hash_matches ? "matches" : "MISMATCH"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Recent events"
        aside={
          <>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className={inputCls}
              aria-label="Filter by record type"
            >
              <option value="">All record types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setEntityId(entityIdInput.trim());
              }}
            >
              <input
                value={entityIdInput}
                onChange={(e) => setEntityIdInput(e.target.value)}
                placeholder="entity id"
                className={`mono w-72 ${inputCls}`}
                aria-label="Filter by entity id"
              />
              <button type="submit" className={buttonCls}>
                Filter
              </button>
              {(entityId || entityType) && (
                <button
                  type="button"
                  className="text-xs text-muted hover:underline"
                  onClick={() => {
                    setEntityId("");
                    setEntityIdInput("");
                    setEntityType("");
                  }}
                >
                  clear
                </button>
              )}
            </form>
          </>
        }
      >
        {!events.data ? (
          <div className="px-4 py-3">
            <PageState query={events} label="audit events" />
          </div>
        ) : (
          <AuditTimeline
            events={events.data}
            onPickEntity={(t, id) => {
              setEntityType(t);
              setEntityId(id);
              setEntityIdInput(id);
            }}
          />
        )}
      </Card>
    </div>
  );
}
