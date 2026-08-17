import { PenLine, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  type AnticipatedEvent,
  type AssessmentBody,
  type Assessor,
  type CaseAssessment,
  type CaseDetail,
  type CaseEvent,
  type CaseVersion,
  type Expectedness,
  type Rechallenge,
  type SectionsBody,
  useAnticipatedEvents,
  useStudy,
  useUpdateAssessments,
  useUpdateDesignations,
  useUpdateSections,
} from "../api";
import {
  DrugsEditor,
  drugFromRow,
  drugsBody,
  EventsEditor,
  eventFromRow,
  eventsBody,
  NarrativeEditor,
  narrativeBody,
  narrativeFromRow,
  PatientEditor,
  patientBody,
  patientFromRow,
  SERIOUSNESS,
  SourcesEditor,
  sourceFromRow,
  sourcesBody,
  TestsEditor,
  testFromRow,
  testsBody,
} from "../sections";
import {
  buttonCls,
  Chip,
  Empty,
  ErrorNote,
  fmtDate,
  humanize,
  inputCls,
  Notice,
  Tabs,
  tdCls,
  thCls,
  yn,
} from "../ui";

type TabId = "sources" | "patient" | "events" | "drugs" | "assessments" | "tests" | "narrative";

const TABS: { id: TabId; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "patient", label: "Patient" },
  { id: "events", label: "Events" },
  { id: "drugs", label: "Drugs" },
  { id: "assessments", label: "Assessments" },
  { id: "tests", label: "Tests" },
  { id: "narrative", label: "Narrative" },
];

export function SectionTabs({
  c,
  v,
  editable,
  canEnter,
  canAssess,
}: {
  c: CaseDetail;
  v: CaseVersion;
  editable: boolean;
  canEnter: boolean;
  canAssess: boolean;
}) {
  const [tab, setTab] = useState<TabId>("events");
  const { data: study } = useStudy(c.study_id ?? undefined);
  const sites = (study?.sites ?? []).map((s) => ({
    id: s.id,
    label: `${s.site_number} · ${s.name} (${s.country})`,
  }));
  const products = study?.products ?? [];
  const edit = editable && canEnter;
  const counts: Partial<Record<TabId, number>> = {
    sources: v.sources.length,
    events: v.events.length,
    drugs: v.drugs.length,
    assessments: v.assessments.length,
    tests: v.tests.length,
  };
  return (
    <>
      <Tabs
        tabs={TABS.map((t) => ({
          id: t.id,
          label: (
            <>
              {t.label}
              {counts[t.id] !== undefined && (
                <span className="mono ml-1 text-xs text-muted">{counts[t.id]}</span>
              )}
            </>
          ),
        }))}
        value={tab}
        onChange={setTab}
      />
      {/* Remount on version change so drafts never leak across versions. */}
      <div key={v.id} className="px-4 py-3">
        {tab === "sources" && <SourcesTab v={v} editable={edit} />}
        {tab === "patient" && <PatientTab v={v} editable={edit} sites={sites} />}
        {tab === "events" && (
          <EventsTab
            v={v}
            editable={edit}
            studyId={c.study_id}
            canDesignate={editable && canAssess}
          />
        )}
        {tab === "drugs" && (
          <DrugsTab v={v} editable={edit} products={products} studyBlinded={!!c.is_blinded} />
        )}
        {tab === "assessments" && <AssessmentsTab v={v} editable={editable && canAssess} />}
        {tab === "tests" && <TestsTab v={v} editable={edit} />}
        {tab === "narrative" && <NarrativeTab v={v} editable={edit} />}
      </div>
    </>
  );
}

/** View / edit shell for one section: the edit affordance, save and cancel, and the error line. */
function Section({
  editable,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  error,
  children,
}: {
  editable: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: unknown;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button type="button" onClick={onSave} disabled={saving} className={buttonCls}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={onCancel} disabled={saving} className={buttonCls}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={onEdit} className={buttonCls}>
              <PenLine size={12} aria-hidden />
              Edit
            </button>
          )}
          <ErrorNote error={error} />
        </div>
      )}
      {children}
    </div>
  );
}

function useSectionSave(versionId: string) {
  const update = useUpdateSections();
  const [err, setErr] = useState<unknown>(null);
  const save = (sections: SectionsBody, done: () => void) => {
    setErr(null);
    update.mutate({ versionId, sections }, { onError: setErr, onSuccess: done });
  };
  return { save, saving: update.isPending, err, setErr };
}

// --- Sources ---------------------------------------------------------------------------------

function SourcesTab({ v, editable }: { v: CaseVersion; editable: boolean }) {
  const [draft, setDraft] = useState<ReturnType<typeof sourceFromRow>[] | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(v.sources.map(sourceFromRow))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ sources: sourcesBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <SourcesEditor value={draft} onChange={setDraft} />
      ) : v.sources.length === 0 ? (
        <Empty>No reporter recorded.</Empty>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>#</th>
              <th className={thCls}>Name</th>
              <th className={thCls}>Organization</th>
              <th className={thCls}>Country</th>
              <th className={thCls}>Qualification</th>
              <th className={thCls}>Primary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {v.sources.map((s) => (
              <tr key={s.id}>
                <td className={`${tdCls} mono text-muted`}>{s.seq}</td>
                <td className={tdCls}>
                  {[s.given_name, s.family_name].filter(Boolean).join(" ") || (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className={tdCls}>{s.organization ?? "-"}</td>
                <td className={tdCls}>{s.country ?? "-"}</td>
                <td className={tdCls}>{humanize(s.qualification) || "-"}</td>
                <td className={tdCls}>{s.is_primary_for_regulatory ? "yes" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// --- Patient ---------------------------------------------------------------------------------

function PatientTab({
  v,
  editable,
  sites,
}: {
  v: CaseVersion;
  editable: boolean;
  sites: { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState<ReturnType<typeof patientFromRow> | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  const p = v.patient;
  const site = sites.find((s) => s.id === p?.study_site_id);
  const rows: [string, ReactNode][] = [
    ["Initials", p?.initials],
    ["Subject number", p?.subject_number],
    ["Site", site?.label ?? p?.study_site_id],
    [
      "Age",
      p?.age_value !== null && p?.age_value !== undefined
        ? `${p.age_value} ${p.age_unit ?? ""}`
        : null,
    ],
    ["Age group", p?.age_group],
    ["Sex", p?.sex],
    ["Weight", p?.weight_kg ? `${p.weight_kg} kg` : null],
    ["Height", p?.height_cm ? `${p.height_cm} cm` : null],
    [
      "Death",
      p?.death_date
        ? `${p.death_date}${p.death_cause_text ? ` · ${p.death_cause_text}` : ""}`
        : null,
    ],
    ["Medical history", p?.medical_history_text],
  ];
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(patientFromRow(p))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ patient: patientBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <PatientEditor value={draft} onChange={setDraft} sites={sites} />
      ) : (
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className={val ? "" : "text-muted"}>{val || "-"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

// --- Events ---------------------------------------------------------------------------------

function EventVerdict({ e }: { e: CaseEvent }) {
  const unassessed = !e.reporter_assessed && !e.sponsor_assessed;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        label={e.serious ? "serious" : "non-serious"}
        cssVar={e.serious ? "--status-serious" : "--muted"}
        hollow={!e.serious}
      />
      {e.fatal_or_life_threatening && (
        <Chip label="fatal / life-threatening" cssVar="--status-critical" />
      )}
      <Chip
        label={
          e.expectedness
            ? `${e.expectedness} · ${humanize(e.expectedness_basis)}${e.rsi_label ? ` · ${e.rsi_label}` : ""}`
            : "expectedness unknown"
        }
        cssVar={e.expectedness === "unexpected" ? "--status-warn" : "--muted"}
        hollow={e.expectedness !== "unexpected"}
        title="Expectedness against the RSI in effect on day 0, unless a reviewer override applies"
      />
      <Chip
        label={`reporter: ${e.reporter_assessed ? (e.reporter_related ? "related" : "not related") : "unassessed"}`}
        cssVar={e.reporter_related ? "--info" : "--muted"}
        hollow={!e.reporter_related}
      />
      <Chip
        label={`sponsor: ${e.sponsor_assessed ? (e.sponsor_related ? "related" : "not related") : "unassessed"}`}
        cssVar={e.sponsor_related ? "--info" : "--muted"}
        hollow={!e.sponsor_related}
      />
      {unassessed && (
        <Chip
          label="causality unassessed"
          cssVar="--status-warn"
          icon={<TriangleAlert size={11} aria-hidden />}
        />
      )}
      {e.causality_disagreement && (
        <Chip
          label="investigator and sponsor differ"
          cssVar="--status-warn"
          hollow
          title="Both opinions stay on the record and travel with the report; which one starts a clock is each rule's causality basis"
        />
      )}
      {e.anticipated && (
        <Chip
          label={`anticipated in the study population${
            e.anticipated_plan_reference ? ` · ${e.anticipated_plan_reference}` : ""
          }`}
          cssVar="--info"
          title={`${e.anticipated_label ?? "anticipated"}${
            e.anticipated_basis === "added_during_trial" ? " (concept added during the trial)" : ""
          }: not reported to FDA as an individual IND safety report; reviewed in aggregate`}
        />
      )}
      {!e.anticipated && !e.designation_id && e.anticipated_candidate && (
        <Chip
          label="PT is on the study's anticipated-event list"
          cssVar="--muted"
          hollow
          title="A hint for the sponsor's review, not a designation"
        />
      )}
    </div>
  );
}

const inEffectOn = (concepts: AnticipatedEvent[], day: string) =>
  concepts.filter((c) => c.effective_from <= day && (!c.effective_to || c.effective_to >= day));

/**
 * The sponsor's per-event designation: anticipated in the study population
 * (naming a concept on the study's list) or explicitly not. Sponsor-only; the
 * server gates it with `assess`.
 */
function DesignationsPanel({
  v,
  studyId,
  canDesignate,
}: {
  v: CaseVersion;
  studyId: string | null;
  canDesignate: boolean;
}) {
  const concepts = useAnticipatedEvents(studyId ?? undefined);
  const update = useUpdateDesignations();
  const [draft, setDraft] = useState<Record<number, { choice: string; rationale: string }> | null>(
    null,
  );
  const [err, setErr] = useState<unknown>(null);
  if (!studyId) return null;
  const inEffect = inEffectOn(concepts.data ?? [], v.awareness_date);
  const designated = v.events.filter((e) => e.designation_id);
  if (!canDesignate && designated.length === 0) return null;
  const startEdit = () =>
    setDraft(
      Object.fromEntries(
        v.events.map((e) => [
          e.seq,
          {
            choice: e.designation_id ? (e.anticipated ? (e.anticipated_event_id ?? "") : "no") : "",
            rationale: e.designation_rationale ?? "",
          },
        ]),
      ),
    );
  const onSave = () => {
    if (!draft) return;
    setErr(null);
    update.mutate(
      {
        versionId: v.id,
        designations: v.events
          .filter((e) => (draft[e.seq]?.choice ?? "") !== "")
          .map((e) => ({
            event_seq: e.seq,
            anticipated: draft[e.seq]!.choice !== "no",
            anticipated_event_id: draft[e.seq]!.choice === "no" ? null : draft[e.seq]!.choice,
            rationale: draft[e.seq]!.rationale.trim() || null,
          })),
      },
      { onError: setErr, onSuccess: () => setDraft(null) },
    );
  };
  return (
    <div className="mt-4 space-y-2 rounded-md border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">
          Sponsor designation: anticipated in the study population
        </h3>
        {canDesignate && !draft && (
          <button type="button" onClick={startEdit} className={buttonCls}>
            <PenLine size={12} aria-hidden />
            Designate
          </button>
        )}
        {draft && (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={update.isPending}
              className={buttonCls}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setErr(null);
              }}
              disabled={update.isPending}
              className={buttonCls}
            >
              Cancel
            </button>
          </>
        )}
        <ErrorNote error={err} />
      </div>
      <p className="text-xs text-muted">
        An event the sponsor designates anticipated (a consequence of the disease or the population,
        listed in the safety surveillance plan) is held back from every rule that excludes
        anticipated events and reviewed in aggregate; other rules run as usual. Distinct from
        expectedness, which is judged against the RSI.
        {inEffect.length === 0 &&
          " This study lists no anticipated-event concept in effect on the awareness date."}
      </p>
      {draft ? (
        <ul className="space-y-2">
          {v.events.map((e) => {
            const d = draft[e.seq] ?? { choice: "", rationale: "" };
            const set = (patch: Partial<typeof d>) =>
              setDraft((cur) => (cur ? { ...cur, [e.seq]: { ...d, ...patch } } : cur));
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="mono text-xs text-muted">#{e.seq}</span>
                <span className="font-medium">{e.pt_term ?? e.reported_term}</span>
                <select
                  value={d.choice}
                  onChange={(ev) => set({ choice: ev.target.value })}
                  className={inputCls}
                  aria-label={`Designation for event ${e.seq}`}
                >
                  <option value="">no designation</option>
                  <option value="no">not anticipated</option>
                  {inEffect.map((c) => (
                    <option key={c.id} value={c.id}>
                      anticipated: {c.label}
                      {c.plan_reference ? ` (${c.plan_reference})` : ""}
                      {c.terms?.some((t) => t.pt_code === e.pt_code) ? " · PT on the list" : ""}
                    </option>
                  ))}
                </select>
                <input
                  value={d.rationale}
                  onChange={(ev) => set({ rationale: ev.target.value })}
                  placeholder="rationale (optional)"
                  className={`w-80 ${inputCls}`}
                  aria-label={`Designation rationale for event ${e.seq}`}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="space-y-1 text-sm">
          {v.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="mono text-xs text-muted">#{e.seq}</span>
              <span>{e.pt_term ?? e.reported_term}:</span>
              {e.designation_id ? (
                e.anticipated ? (
                  <span>
                    <span className="font-medium">anticipated</span>
                    {e.anticipated_label ? ` · ${e.anticipated_label}` : ""}
                    {e.anticipated_plan_reference ? ` (${e.anticipated_plan_reference})` : ""}
                    {e.anticipated_basis === "added_during_trial"
                      ? " · added during the trial"
                      : ""}
                  </span>
                ) : (
                  <span>not anticipated</span>
                )
              ) : (
                <span className="text-muted">no designation</span>
              )}
              {e.designation_rationale && (
                <span className="text-xs text-ink2">— {e.designation_rationale}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventsTab({
  v,
  editable,
  studyId,
  canDesignate,
}: {
  v: CaseVersion;
  editable: boolean;
  studyId: string | null;
  canDesignate: boolean;
}) {
  const [draft, setDraft] = useState<ReturnType<typeof eventFromRow>[] | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(v.events.map(eventFromRow))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ events: eventsBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <EventsEditor value={draft} onChange={setDraft} dictionaryId={v.dictionary_id} />
      ) : v.events.length === 0 ? (
        <Empty>No events recorded.</Empty>
      ) : (
        <ul className="divide-y divide-hairline">
          {v.events.map((e) => {
            const crit = SERIOUSNESS.filter((s) => e[s.key]).map((s) => s.label);
            return (
              <li key={e.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="mono text-xs text-muted">#{e.seq}</span>
                  <span className="font-medium">{e.reported_term}</span>
                  {e.pt_term ? (
                    <span className="text-xs text-ink2">
                      {e.llt_term && e.llt_term !== e.pt_term ? `LLT ${e.llt_term} › ` : ""}
                      PT {e.pt_term}
                      {e.hlt_term ? ` › HLT ${e.hlt_term}` : ""}
                      {e.hlgt_term ? ` › HLGT ${e.hlgt_term}` : ""}
                      {e.soc_term ? ` › SOC ${e.soc_term}` : ""}
                      {e.pt_code ? <span className="mono text-muted"> {e.pt_code}</span> : null}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">not coded</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
                  <span>
                    {crit.length > 0 ? (
                      crit.join(", ")
                    ) : (
                      <span className="text-muted">no seriousness criterion</span>
                    )}
                  </span>
                  <span className="mono">
                    {fmtDate(e.onset_date) || "?"} → {fmtDate(e.end_date) || "ongoing"}
                  </span>
                  <span>outcome: {humanize(e.outcome)}</span>
                  {e.occur_country && <span>in {e.occur_country}</span>}
                  {e.medically_confirmed !== null && (
                    <span>medically confirmed: {yn(e.medically_confirmed)}</span>
                  )}
                </div>
                <EventVerdict e={e} />
              </li>
            );
          })}
        </ul>
      )}
      {!draft && v.events.length > 0 && (
        <DesignationsPanel v={v} studyId={studyId} canDesignate={canDesignate} />
      )}
    </Section>
  );
}

// --- Drugs ---------------------------------------------------------------------------------

function DrugsTab({
  v,
  editable,
  products,
  studyBlinded,
}: {
  v: CaseVersion;
  editable: boolean;
  products: { id: string; name: string; role: string }[];
  studyBlinded: boolean;
}) {
  const [draft, setDraft] = useState<ReturnType<typeof drugFromRow>[] | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(v.drugs.map(drugFromRow))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ drugs: drugsBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <DrugsEditor
          value={draft}
          onChange={setDraft}
          products={products}
          studyBlinded={studyBlinded}
        />
      ) : v.drugs.length === 0 ? (
        <Empty>No drugs recorded.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thCls}>#</th>
                <th className={thCls}>Role</th>
                <th className={thCls}>Drug</th>
                <th className={thCls}>Dose / route</th>
                <th className={thCls}>Indication</th>
                <th className={thCls}>Dates</th>
                <th className={thCls}>Action taken</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {v.drugs.map((d) => (
                <tr key={d.id}>
                  <td className={`${tdCls} mono text-muted`}>{d.seq}</td>
                  <td className={tdCls}>
                    <Chip
                      label={humanize(d.role)}
                      cssVar={
                        d.role === "suspect" || d.role === "interacting"
                          ? "--status-serious"
                          : "--muted"
                      }
                      hollow={d.role !== "suspect" && d.role !== "interacting"}
                    />
                  </td>
                  <td className={tdCls}>
                    <div>{d.name_as_reported}</div>
                    <div className="text-xs text-muted">
                      {d.product_name ? `product ${d.product_name}` : "not a study product"}
                      {d.is_blinded ? " · blinded" : ""}
                      {d.lot_number ? ` · lot ${d.lot_number}` : ""}
                    </div>
                  </td>
                  <td className={tdCls}>
                    {d.dose_text ?? "-"}
                    {d.route ? <span className="text-xs text-muted"> · {d.route}</span> : null}
                  </td>
                  <td className={tdCls}>{d.indication_pt_term ?? "-"}</td>
                  <td className={`${tdCls} mono text-xs`}>
                    {fmtDate(d.start_date) || "?"} → {fmtDate(d.end_date) || "ongoing"}
                  </td>
                  <td className={tdCls}>{humanize(d.action_taken) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// --- Assessments (drug × event × assessor) --------------------------------------------------------

interface CellDraft {
  related: "" | "yes" | "no";
  causality_method: string;
  causality_result: string;
  rechallenge: Rechallenge | "";
  expectedness_override: Expectedness | "";
  expectedness_rationale: string;
}

const RECHALLENGE: Rechallenge[] = [
  "recurred",
  "did_not_recur",
  "outcome_unknown",
  "not_rechallenged",
];
const ASSESSORS: Assessor[] = ["reporter", "sponsor"];
const cellKey = (drugSeq: number, eventSeq: number, assessor: Assessor) =>
  `${drugSeq}:${eventSeq}:${assessor}`;

const cellFrom = (a: CaseAssessment | undefined): CellDraft => ({
  related: a ? (a.reasonable_possibility ? "yes" : "no") : "",
  causality_method: a?.causality_method ?? "",
  causality_result: a?.causality_result ?? "",
  rechallenge: a?.rechallenge ?? "",
  expectedness_override: a?.expectedness_override ?? "",
  expectedness_rationale: a?.expectedness_rationale ?? "",
});

function AssessmentsTab({ v, editable }: { v: CaseVersion; editable: boolean }) {
  const update = useUpdateAssessments();
  const [draft, setDraft] = useState<Record<string, CellDraft> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  // Causality is assessed for suspect and interacting drugs; keep any drug that
  // already carries an assessment so a save never silently drops one.
  const drugs = v.drugs.filter(
    (d) =>
      d.role === "suspect" ||
      d.role === "interacting" ||
      v.assessments.some((a) => a.drug_seq === d.seq),
  );
  const cells = drugs.flatMap((d) =>
    v.events.flatMap((e) =>
      ASSESSORS.map((assessor) => ({
        d,
        e,
        assessor,
        key: cellKey(d.seq, e.seq, assessor),
        existing: v.assessments.find(
          (a) => a.drug_seq === d.seq && a.event_seq === e.seq && a.assessor === assessor,
        ),
      })),
    ),
  );
  const startEdit = () =>
    setDraft(Object.fromEntries(cells.map((c) => [c.key, cellFrom(c.existing)])));
  const onSave = () => {
    if (!draft) return;
    const assessments: AssessmentBody[] = cells.flatMap((c) => {
      const cell = draft[c.key];
      if (!cell || cell.related === "") return [];
      return [
        {
          drug_seq: c.d.seq,
          event_seq: c.e.seq,
          assessor: c.assessor,
          reasonable_possibility: cell.related === "yes",
          causality_method: cell.causality_method.trim() || null,
          causality_result: cell.causality_result.trim() || null,
          rechallenge: cell.rechallenge || null,
          expectedness_override: cell.expectedness_override || null,
          expectedness_rationale: cell.expectedness_rationale.trim() || null,
        },
      ];
    });
    setErr(null);
    update.mutate(
      { versionId: v.id, assessments },
      { onError: setErr, onSuccess: () => setDraft(null) },
    );
  };

  if (cells.length === 0)
    return <Empty>Assessments need at least one suspect drug and one event.</Empty>;

  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={startEdit}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={onSave}
      saving={update.isPending}
      error={err}
    >
      <p className="text-xs text-muted">
        Reasonable possibility of a causal relationship, per drug, event, and assessor. An
        expectedness override replaces the RSI-derived verdict and needs a rationale.
      </p>
      {v.any_causality_disagreement && (
        <Notice tone="warn">
          Investigator and sponsor differ on causality. Both opinions stay on the record and travel
          with the report; the sponsor never edits the reporter's row. Which opinion starts a clock
          is each rule's causality basis (the FDA IND rules use the sponsor's, ICH E2A and the EU
          rules either party's). To ask the site to reconsider, query it through the EDC or by
          letter; the answer arrives as follow-up information and opens a new version.
        </Notice>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>Drug</th>
              <th className={thCls}>Event</th>
              <th className={thCls}>Assessor</th>
              <th className={thCls}>Related</th>
              <th className={thCls}>Method</th>
              <th className={thCls}>Result</th>
              <th className={thCls}>Rechallenge</th>
              <th className={thCls}>Expectedness override</th>
              <th className={thCls}>Rationale</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {cells.map((c) => {
              const cell = draft?.[c.key];
              const set = (patch: Partial<CellDraft>) =>
                setDraft((d) =>
                  d ? { ...d, [c.key]: { ...cellFrom(undefined), ...d[c.key], ...patch } } : d,
                );
              return (
                <tr key={c.key} className={c.assessor === "reporter" ? "" : "bg-page/60"}>
                  <td className={tdCls}>
                    <span className="mono text-xs text-muted">#{c.d.seq}</span>{" "}
                    {c.d.name_as_reported}
                  </td>
                  <td className={tdCls}>
                    <span className="mono text-xs text-muted">#{c.e.seq}</span>{" "}
                    {c.e.pt_term ?? c.e.reported_term}
                  </td>
                  <td className={tdCls}>{c.assessor}</td>
                  {cell ? (
                    <>
                      <td className={tdCls}>
                        <select
                          value={cell.related}
                          onChange={(e) => set({ related: e.target.value as CellDraft["related"] })}
                          className={inputCls}
                          aria-label="Reasonable possibility"
                        >
                          <option value="">unassessed</option>
                          <option value="yes">yes</option>
                          <option value="no">no</option>
                        </select>
                      </td>
                      <td className={tdCls}>
                        <input
                          value={cell.causality_method}
                          onChange={(e) => set({ causality_method: e.target.value })}
                          className={`w-32 ${inputCls}`}
                          aria-label="Causality method"
                        />
                      </td>
                      <td className={tdCls}>
                        <input
                          value={cell.causality_result}
                          onChange={(e) => set({ causality_result: e.target.value })}
                          className={`w-32 ${inputCls}`}
                          aria-label="Causality result"
                        />
                      </td>
                      <td className={tdCls}>
                        <select
                          value={cell.rechallenge}
                          onChange={(e) => set({ rechallenge: e.target.value as Rechallenge | "" })}
                          className={inputCls}
                          aria-label="Rechallenge"
                        >
                          <option value="">-</option>
                          {RECHALLENGE.map((r) => (
                            <option key={r} value={r}>
                              {humanize(r)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={tdCls}>
                        <select
                          value={cell.expectedness_override}
                          onChange={(e) =>
                            set({ expectedness_override: e.target.value as Expectedness | "" })
                          }
                          className={inputCls}
                          aria-label="Expectedness override"
                        >
                          <option value="">none (RSI)</option>
                          <option value="expected">expected</option>
                          <option value="unexpected">unexpected</option>
                        </select>
                      </td>
                      <td className={tdCls}>
                        <input
                          value={cell.expectedness_rationale}
                          onChange={(e) => set({ expectedness_rationale: e.target.value })}
                          className={`w-40 ${inputCls}`}
                          aria-label="Expectedness rationale"
                          required={cell.expectedness_override !== ""}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={tdCls}>
                        {c.existing ? (
                          <Chip
                            label={c.existing.reasonable_possibility ? "yes" : "no"}
                            cssVar={c.existing.reasonable_possibility ? "--info" : "--muted"}
                            hollow={!c.existing.reasonable_possibility}
                          />
                        ) : (
                          <Chip
                            label="unassessed"
                            cssVar="--status-warn"
                            icon={<TriangleAlert size={11} aria-hidden />}
                          />
                        )}
                      </td>
                      <td className={tdCls}>{c.existing?.causality_method ?? "-"}</td>
                      <td className={tdCls}>{c.existing?.causality_result ?? "-"}</td>
                      <td className={tdCls}>{humanize(c.existing?.rechallenge) || "-"}</td>
                      <td className={tdCls}>{c.existing?.expectedness_override ?? "-"}</td>
                      <td className={`${tdCls} text-xs text-ink2`}>
                        {c.existing?.expectedness_rationale ?? "-"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// --- Tests -----------------------------------------------------------------------------------

function TestsTab({ v, editable }: { v: CaseVersion; editable: boolean }) {
  const [draft, setDraft] = useState<ReturnType<typeof testFromRow>[] | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(v.tests.map(testFromRow))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ tests: testsBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <TestsEditor value={draft} onChange={setDraft} />
      ) : v.tests.length === 0 ? (
        <Empty>No tests recorded.</Empty>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>#</th>
              <th className={thCls}>Date</th>
              <th className={thCls}>Test</th>
              <th className={thCls}>Result</th>
              <th className={thCls}>Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {v.tests.map((t) => (
              <tr key={t.id}>
                <td className={`${tdCls} mono text-muted`}>{t.seq}</td>
                <td className={`${tdCls} mono`}>{fmtDate(t.test_date) || "-"}</td>
                <td className={tdCls}>{t.test_name}</td>
                <td className={tdCls}>
                  {t.result_text ?? "-"}
                  {t.unit ? <span className="text-xs text-muted"> {t.unit}</span> : null}
                </td>
                <td className={`${tdCls} text-xs text-ink2`}>{t.comments ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// --- Narrative --------------------------------------------------------------------------------

function NarrativeTab({ v, editable }: { v: CaseVersion; editable: boolean }) {
  const [draft, setDraft] = useState<ReturnType<typeof narrativeFromRow> | null>(null);
  const { save, saving, err, setErr } = useSectionSave(v.id);
  const nr = v.narrative;
  return (
    <Section
      editable={editable}
      editing={draft !== null}
      onEdit={() => setDraft(narrativeFromRow(nr))}
      onCancel={() => {
        setDraft(null);
        setErr(null);
      }}
      onSave={() => draft && save({ narrative: narrativeBody(draft) }, () => setDraft(null))}
      saving={saving}
      error={err}
    >
      {draft ? (
        <NarrativeEditor value={draft} onChange={setDraft} />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap">
            {nr?.narrative || <span className="text-muted">No narrative yet.</span>}
          </p>
          {nr?.reporter_comments && (
            <p className="text-ink2">
              <span className="text-xs text-muted">Reporter comments: </span>
              {nr.reporter_comments}
            </p>
          )}
          {nr?.sender_comments && (
            <p className="text-ink2">
              <span className="text-xs text-muted">Sender comments: </span>
              {nr.sender_comments}
            </p>
          )}
          {nr?.sender_diagnosis_pt_term && (
            <p className="text-ink2">
              <span className="text-xs text-muted">Sender diagnosis: </span>
              {nr.sender_diagnosis_pt_term}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
