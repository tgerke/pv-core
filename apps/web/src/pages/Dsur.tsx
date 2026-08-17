import { useState } from "react";
import { Link } from "react-router-dom";
import { type Study, useSaeSummary, useSarLineListing } from "../api";
import {
  Card,
  CopyTsvButton,
  Empty,
  Field,
  fmtDate,
  inputCls,
  linkCls,
  n,
  PageState,
  tdCls,
  thCls,
  yn,
} from "../ui";

const SERIOUSNESS_LABEL: Record<number, string> = {
  1: "death",
  2: "life-threatening",
  3: "hospitalization",
  4: "disabling",
  5: "congenital anomaly",
  6: "other medically important",
};

export default function Dsur({ study }: { study: Study | undefined }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const listing = useSarLineListing(study?.id, from || undefined, to || undefined);
  const summary = useSaeSummary(study?.id);

  const rows = listing.data ?? [];
  const listingHeader = [
    "Case",
    "Study",
    "Subject",
    "Sex/age",
    "Country",
    "Arm",
    "Suspect drugs",
    "PT",
    "SOC",
    "Onset",
    "Outcome",
    "Seriousness",
    "Reporter related",
    "Sponsor related",
    "Expectedness",
    "RSI",
    "Other serious reactions",
  ];
  const listingRows = rows.map((r) => [
    r.sender_case_id,
    r.protocol_number,
    r.subject_number ?? "",
    `${r.sex ?? ""}${r.age_value !== null ? ` ${r.age_value} ${r.age_unit ?? ""}` : ""}`.trim(),
    r.site_country ?? "",
    r.arm_label,
    r.suspect_drugs ?? "",
    r.pt_term,
    r.soc_term,
    fmtDate(r.onset_date),
    r.outcome ?? "",
    SERIOUSNESS_LABEL[r.seriousness_rank] ?? String(r.seriousness_rank),
    yn(r.reporter_related),
    yn(r.sponsor_related),
    r.expectedness,
    r.rsi_label ?? "",
    r.other_serious_reactions ?? "",
  ]);

  const sae = summary.data ?? [];
  const saeHeader = ["Study", "Product", "SOC", "Arm", "Events", "Cases", "Reactions", "Fatal/LT"];
  const saeRows = sae.map((r) => [
    r.protocol_number,
    r.product_name ?? "",
    r.soc_term,
    r.arm_label,
    String(n(r.event_count)),
    String(n(r.case_count)),
    String(n(r.reaction_count)),
    String(n(r.fatal_or_life_threatening_count)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">DSUR</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink2">
          ICH E2F tabulations {study ? `for ${study.protocol_number}` : "across studies"}: the line
          listing of serious adverse reactions (§3.7.2) and the cumulative SAE summary by system
          organ class and arm (§3.7.3). Blinded cases report the arm as "blinded" until an
          unblinding fact is recorded.
        </p>
      </div>

      <Card
        title="Serious adverse reactions"
        aside={
          <>
            <Field label="Received from">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="to">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={inputCls}
              />
            </Field>
            <CopyTsvButton header={listingHeader} rows={listingRows} />
          </>
        }
      >
        {!listing.data ? (
          <div className="px-4 py-3">
            <PageState query={listing} label="line listing" />
          </div>
        ) : rows.length === 0 ? (
          <Empty>No serious adverse reactions in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[88rem] text-xs">
              <thead>
                <tr className="border-b border-hairline">
                  {listingHeader.map((h) => (
                    <th key={h} className={thCls}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r, i) => (
                  <tr key={r.case_id}>
                    <td className={`${tdCls} text-xs`}>
                      <Link to={`/cases/${r.case_id}`} className={linkCls}>
                        {r.sender_case_id}
                      </Link>
                      <div className="mono text-muted">{fmtDate(r.first_received_date)}</div>
                    </td>
                    {listingRows[i]!.slice(1).map((cell, j) => (
                      <td
                        key={listingHeader[j + 1]}
                        className={`${tdCls} text-xs ${j + 1 === 9 ? "mono" : ""}`}
                        style={
                          listingHeader[j + 1] === "Expectedness" && cell === "unexpected"
                            ? { color: "var(--status-warn)" }
                            : undefined
                        }
                      >
                        {cell || <span className="text-muted">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Cumulative SAE summary"
        aside={
          <>
            <span className="text-xs text-muted">SOC × arm</span>
            <CopyTsvButton header={saeHeader} rows={saeRows} />
          </>
        }
      >
        {!summary.data ? (
          <div className="px-4 py-3">
            <PageState query={summary} label="SAE summary" />
          </div>
        ) : sae.length === 0 ? (
          <Empty>No serious events.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  {saeHeader.map((h, i) => (
                    <th key={h} className={`${thCls} ${i >= 4 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {sae.map((r) => (
                  <tr key={`${r.study_id}-${r.soc_code ?? r.soc_term}-${r.arm_label}`}>
                    <td className={tdCls}>{r.protocol_number}</td>
                    <td className={tdCls}>{r.product_name ?? "-"}</td>
                    <td className={tdCls}>{r.soc_term}</td>
                    <td className={tdCls}>{r.arm_label}</td>
                    <td className={`${tdCls} mono text-right`}>{n(r.event_count)}</td>
                    <td className={`${tdCls} mono text-right`}>{n(r.case_count)}</td>
                    <td className={`${tdCls} mono text-right`}>{n(r.reaction_count)}</td>
                    <td
                      className={`${tdCls} mono text-right`}
                      style={
                        n(r.fatal_or_life_threatening_count) > 0
                          ? { color: "var(--status-critical)" }
                          : undefined
                      }
                    >
                      {n(r.fatal_or_life_threatening_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
