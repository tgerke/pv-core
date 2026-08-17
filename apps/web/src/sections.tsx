import { Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  type ActionTaken,
  type AgeGroup,
  type AgeUnit,
  type CaseDrug,
  type CaseEvent,
  type CaseNarrative,
  type CasePatient,
  type CaseSource,
  type CaseTest,
  type DictionaryTerm,
  type DrugBody,
  type DrugRole,
  type EventBody,
  type EventOutcome,
  type NarrativeBody,
  type PatientBody,
  type Qualification,
  type Sex,
  type SourceBody,
  type StudyProduct,
  type TestBody,
  useTermSearch,
} from "./api";
import { buttonCls, Field, humanize, inputCls } from "./ui";

// Draft shapes hold strings for every input; the *Body converters turn them
// into the API's nullable typed fields. Rows carry a client key for React.

const newKey = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const nz = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const str = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

export const AGE_UNITS: AgeUnit[] = ["years", "months", "weeks", "days", "hours"];
export const AGE_GROUPS: AgeGroup[] = [
  "foetus",
  "neonate",
  "infant",
  "child",
  "adolescent",
  "adult",
  "elderly",
];
export const SEXES: Sex[] = ["male", "female", "unknown"];
export const QUALIFICATIONS: Qualification[] = [
  "physician",
  "pharmacist",
  "other_health_professional",
  "lawyer",
  "consumer",
];
export const OUTCOMES: EventOutcome[] = [
  "recovered",
  "recovering",
  "not_recovered",
  "recovered_with_sequelae",
  "fatal",
  "unknown",
];
export const DRUG_ROLES: DrugRole[] = ["suspect", "concomitant", "interacting", "not_administered"];
export const ACTIONS_TAKEN: ActionTaken[] = [
  "drug_withdrawn",
  "dose_reduced",
  "dose_increased",
  "dose_not_changed",
  "unknown",
  "not_applicable",
];

export const SERIOUSNESS: { key: keyof EventSeriousness; label: string }[] = [
  { key: "serious_death", label: "Death" },
  { key: "serious_life_threatening", label: "Life-threatening" },
  { key: "serious_hospitalization", label: "Hospitalization" },
  { key: "serious_disabling", label: "Disabling" },
  { key: "serious_congenital_anomaly", label: "Congenital anomaly" },
  { key: "serious_other_medically_important", label: "Other medically important" },
];

interface EventSeriousness {
  serious_death: boolean;
  serious_life_threatening: boolean;
  serious_hospitalization: boolean;
  serious_disabling: boolean;
  serious_congenital_anomaly: boolean;
  serious_other_medically_important: boolean;
}

// --- Patient --------------------------------------------------------------------------

export interface PatientDraft {
  initials: string;
  subject_number: string;
  study_site_id: string;
  age_value: string;
  age_unit: AgeUnit | "";
  age_group: AgeGroup | "";
  sex: Sex | "";
  weight_kg: string;
  height_cm: string;
  medical_history_text: string;
  death_date: string;
  death_cause_text: string;
}

export const emptyPatient = (): PatientDraft => ({
  initials: "",
  subject_number: "",
  study_site_id: "",
  age_value: "",
  age_unit: "years",
  age_group: "",
  sex: "",
  weight_kg: "",
  height_cm: "",
  medical_history_text: "",
  death_date: "",
  death_cause_text: "",
});

export const patientFromRow = (p: CasePatient | null): PatientDraft => ({
  ...emptyPatient(),
  ...(p
    ? {
        initials: str(p.initials),
        subject_number: str(p.subject_number),
        study_site_id: str(p.study_site_id),
        age_value: str(p.age_value),
        age_unit: p.age_unit ?? "years",
        age_group: p.age_group ?? "",
        sex: p.sex ?? "",
        weight_kg: str(p.weight_kg),
        height_cm: str(p.height_cm),
        medical_history_text: str(p.medical_history_text),
        death_date: str(p.death_date),
        death_cause_text: str(p.death_cause_text),
      }
    : {}),
});

export const patientBody = (d: PatientDraft): PatientBody => ({
  initials: nz(d.initials),
  subject_number: nz(d.subject_number),
  study_site_id: nz(d.study_site_id),
  age_value: num(d.age_value),
  age_unit: num(d.age_value) === null ? null : d.age_unit || null,
  age_group: d.age_group || null,
  sex: d.sex || null,
  weight_kg: num(d.weight_kg),
  height_cm: num(d.height_cm),
  medical_history_text: nz(d.medical_history_text),
  death_date: nz(d.death_date),
  death_cause_text: nz(d.death_cause_text),
});

// --- Sources (reporters) -----------------------------------------------------------------

export interface SourceDraft {
  key: string;
  given_name: string;
  family_name: string;
  organization: string;
  country: string;
  qualification: Qualification | "";
  is_primary_for_regulatory: boolean;
}

export const emptySource = (primary = false): SourceDraft => ({
  key: newKey(),
  given_name: "",
  family_name: "",
  organization: "",
  country: "",
  qualification: "",
  is_primary_for_regulatory: primary,
});

export const sourceFromRow = (s: CaseSource): SourceDraft => ({
  key: s.id,
  given_name: str(s.given_name),
  family_name: str(s.family_name),
  organization: str(s.organization),
  country: str(s.country),
  qualification: s.qualification ?? "",
  is_primary_for_regulatory: s.is_primary_for_regulatory,
});

export const sourcesBody = (list: SourceDraft[]): SourceBody[] =>
  list.map((s, i) => ({
    seq: i + 1,
    given_name: nz(s.given_name),
    family_name: nz(s.family_name),
    organization: nz(s.organization),
    country: nz(s.country)?.toUpperCase() ?? null,
    qualification: s.qualification || null,
    is_primary_for_regulatory: s.is_primary_for_regulatory,
  }));

// --- Events ---------------------------------------------------------------------------

export interface EventDraft extends EventSeriousness {
  key: string;
  reported_term: string;
  llt_code: string;
  llt_label: string;
  onset_date: string;
  end_date: string;
  outcome: EventOutcome;
  occur_country: string;
}

export const emptyEvent = (): EventDraft => ({
  key: newKey(),
  reported_term: "",
  llt_code: "",
  llt_label: "",
  serious_death: false,
  serious_life_threatening: false,
  serious_hospitalization: false,
  serious_disabling: false,
  serious_congenital_anomaly: false,
  serious_other_medically_important: false,
  onset_date: "",
  end_date: "",
  outcome: "unknown",
  occur_country: "",
});

export const eventFromRow = (e: CaseEvent): EventDraft => ({
  key: e.id,
  reported_term: e.reported_term,
  llt_code: str(e.llt_code),
  llt_label: e.llt_term ? `${e.llt_term} (${e.pt_term ?? ""} / ${e.soc_term ?? ""})` : "",
  serious_death: e.serious_death,
  serious_life_threatening: e.serious_life_threatening,
  serious_hospitalization: e.serious_hospitalization,
  serious_disabling: e.serious_disabling,
  serious_congenital_anomaly: e.serious_congenital_anomaly,
  serious_other_medically_important: e.serious_other_medically_important,
  onset_date: str(e.onset_date),
  end_date: str(e.end_date),
  outcome: e.outcome,
  occur_country: str(e.occur_country),
});

export const eventsBody = (list: EventDraft[]): EventBody[] =>
  list.map((e, i) => ({
    seq: i + 1,
    reported_term: e.reported_term.trim(),
    llt_code: nz(e.llt_code),
    serious_death: e.serious_death,
    serious_life_threatening: e.serious_life_threatening,
    serious_hospitalization: e.serious_hospitalization,
    serious_disabling: e.serious_disabling,
    serious_congenital_anomaly: e.serious_congenital_anomaly,
    serious_other_medically_important: e.serious_other_medically_important,
    onset_date: nz(e.onset_date),
    end_date: nz(e.end_date),
    outcome: e.outcome,
    occur_country: nz(e.occur_country)?.toUpperCase() ?? null,
  }));

// --- Drugs ---------------------------------------------------------------------------

export interface DrugDraft {
  key: string;
  role: DrugRole;
  product_id: string;
  name_as_reported: string;
  is_blinded: boolean;
  lot_number: string;
  indication_pt_term: string;
  dose_text: string;
  route: string;
  start_date: string;
  end_date: string;
  action_taken: ActionTaken | "";
}

export const emptyDrug = (): DrugDraft => ({
  key: newKey(),
  role: "suspect",
  product_id: "",
  name_as_reported: "",
  is_blinded: false,
  lot_number: "",
  indication_pt_term: "",
  dose_text: "",
  route: "",
  start_date: "",
  end_date: "",
  action_taken: "",
});

export const drugFromRow = (d: CaseDrug): DrugDraft => ({
  key: d.id,
  role: d.role,
  product_id: str(d.product_id),
  name_as_reported: d.name_as_reported,
  is_blinded: d.is_blinded,
  lot_number: str(d.lot_number),
  indication_pt_term: str(d.indication_pt_term),
  dose_text: str(d.dose_text),
  route: str(d.route),
  start_date: str(d.start_date),
  end_date: str(d.end_date),
  action_taken: d.action_taken ?? "",
});

export const drugsBody = (list: DrugDraft[]): DrugBody[] =>
  list.map((d, i) => ({
    seq: i + 1,
    role: d.role,
    product_id: nz(d.product_id),
    name_as_reported: d.name_as_reported.trim(),
    is_blinded: d.is_blinded,
    lot_number: nz(d.lot_number),
    indication_pt_term: nz(d.indication_pt_term),
    dose_text: nz(d.dose_text),
    route: nz(d.route),
    start_date: nz(d.start_date),
    end_date: nz(d.end_date),
    action_taken: d.action_taken || null,
  }));

// --- Tests ---------------------------------------------------------------------------

export interface TestDraft {
  key: string;
  test_date: string;
  test_name: string;
  result_text: string;
  unit: string;
  comments: string;
}

export const emptyTest = (): TestDraft => ({
  key: newKey(),
  test_date: "",
  test_name: "",
  result_text: "",
  unit: "",
  comments: "",
});

export const testFromRow = (t: CaseTest): TestDraft => ({
  key: t.id,
  test_date: str(t.test_date),
  test_name: t.test_name,
  result_text: str(t.result_text),
  unit: str(t.unit),
  comments: str(t.comments),
});

export const testsBody = (list: TestDraft[]): TestBody[] =>
  list.map((t, i) => ({
    seq: i + 1,
    test_date: nz(t.test_date),
    test_name: t.test_name.trim(),
    result_text: nz(t.result_text),
    unit: nz(t.unit),
    comments: nz(t.comments),
  }));

// --- Narrative -----------------------------------------------------------------------

export interface NarrativeDraft {
  narrative: string;
  reporter_comments: string;
  sender_comments: string;
}

export const emptyNarrative = (): NarrativeDraft => ({
  narrative: "",
  reporter_comments: "",
  sender_comments: "",
});

export const narrativeFromRow = (nr: CaseNarrative | null): NarrativeDraft => ({
  narrative: str(nr?.narrative),
  reporter_comments: str(nr?.reporter_comments),
  sender_comments: str(nr?.sender_comments),
});

export const narrativeBody = (d: NarrativeDraft): NarrativeBody => ({
  narrative: nz(d.narrative),
  reporter_comments: nz(d.reporter_comments),
  sender_comments: nz(d.sender_comments),
});

// --- Minimum criteria (mirror of v_case_minimum_criteria; the view is the authority) -----------

export interface MinimumCriteria {
  patient: boolean;
  reporter: boolean;
  event: boolean;
  suspectDrug: boolean;
}

export function minimumCriteria(
  p: PatientDraft,
  sources: SourceDraft[],
  events: EventDraft[],
  drugs: DrugDraft[],
): MinimumCriteria {
  return {
    patient: !!(
      nz(p.initials) ||
      nz(p.subject_number) ||
      num(p.age_value) !== null ||
      p.age_group ||
      p.sex
    ),
    reporter: sources.some(
      (s) =>
        nz(s.given_name) ||
        nz(s.family_name) ||
        nz(s.organization) ||
        s.qualification ||
        nz(s.country),
    ),
    event: events.some((e) => nz(e.reported_term)),
    suspectDrug: drugs.some(
      (d) => (d.role === "suspect" || d.role === "interacting") && nz(d.name_as_reported),
    ),
  };
}

// --- Editors ---------------------------------------------------------------------------

function RowBox({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline p-3">
      <div className="mb-2 flex items-center">
        <span className="text-xs font-medium text-ink2">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
          aria-label={`Remove ${title}`}
        >
          <Trash2 size={12} aria-hidden />
          remove
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={buttonCls}>
      <Plus size={12} aria-hidden />
      {label}
    </button>
  );
}

const replaceAt = <T,>(list: T[], i: number, next: T): T[] =>
  list.map((x, j) => (j === i ? next : x));
const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, j) => j !== i);

export function PatientEditor({
  value,
  onChange,
  sites,
}: {
  value: PatientDraft;
  onChange: (p: PatientDraft) => void;
  sites: { id: string; label: string }[];
}) {
  const set = <K extends keyof PatientDraft>(k: K, v: PatientDraft[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Initials">
        <input
          value={value.initials}
          onChange={(e) => set("initials", e.target.value)}
          maxLength={10}
          className={`w-20 ${inputCls}`}
        />
      </Field>
      <Field label="Subject number">
        <input
          value={value.subject_number}
          onChange={(e) => set("subject_number", e.target.value)}
          className={`w-36 ${inputCls}`}
        />
      </Field>
      <Field label="Site">
        <select
          value={value.study_site_id}
          onChange={(e) => set("study_site_id", e.target.value)}
          className={`w-56 ${inputCls}`}
        >
          <option value="">Not specified</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Age">
        <span className="flex gap-1">
          <input
            type="number"
            min={0}
            value={value.age_value}
            onChange={(e) => set("age_value", e.target.value)}
            className={`w-20 ${inputCls}`}
          />
          <select
            value={value.age_unit}
            onChange={(e) => set("age_unit", e.target.value as AgeUnit)}
            className={inputCls}
            aria-label="Age unit"
          >
            {AGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </span>
      </Field>
      <Field label="Age group">
        <select
          value={value.age_group}
          onChange={(e) => set("age_group", e.target.value as AgeGroup | "")}
          className={inputCls}
        >
          <option value="">Not specified</option>
          {AGE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sex">
        <select
          value={value.sex}
          onChange={(e) => set("sex", e.target.value as Sex | "")}
          className={inputCls}
        >
          <option value="">Not specified</option>
          {SEXES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Weight (kg)">
        <input
          type="number"
          min={0}
          step="any"
          value={value.weight_kg}
          onChange={(e) => set("weight_kg", e.target.value)}
          className={`w-24 ${inputCls}`}
        />
      </Field>
      <Field label="Height (cm)">
        <input
          type="number"
          min={0}
          step="any"
          value={value.height_cm}
          onChange={(e) => set("height_cm", e.target.value)}
          className={`w-24 ${inputCls}`}
        />
      </Field>
      <Field label="Death date">
        <input
          type="date"
          value={value.death_date}
          onChange={(e) => set("death_date", e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Cause of death">
        <input
          value={value.death_cause_text}
          onChange={(e) => set("death_cause_text", e.target.value)}
          className={`w-56 ${inputCls}`}
        />
      </Field>
      <Field label="Medical history" className="w-full">
        <textarea
          rows={2}
          value={value.medical_history_text}
          onChange={(e) => set("medical_history_text", e.target.value)}
          className={`w-full ${inputCls}`}
        />
      </Field>
    </div>
  );
}

export function SourcesEditor({
  value,
  onChange,
}: {
  value: SourceDraft[];
  onChange: (s: SourceDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((s, i) => {
        const set = <K extends keyof SourceDraft>(k: K, v: SourceDraft[K]) =>
          onChange(replaceAt(value, i, { ...s, [k]: v }));
        return (
          <RowBox
            key={s.key}
            title={`Reporter ${i + 1}`}
            onRemove={() => onChange(removeAt(value, i))}
          >
            <Field label="Given name">
              <input
                value={s.given_name}
                onChange={(e) => set("given_name", e.target.value)}
                className={`w-32 ${inputCls}`}
              />
            </Field>
            <Field label="Family name">
              <input
                value={s.family_name}
                onChange={(e) => set("family_name", e.target.value)}
                className={`w-32 ${inputCls}`}
              />
            </Field>
            <Field label="Organization">
              <input
                value={s.organization}
                onChange={(e) => set("organization", e.target.value)}
                className={`w-56 ${inputCls}`}
              />
            </Field>
            <Field label="Country" hint="ISO-2">
              <input
                value={s.country}
                onChange={(e) => set("country", e.target.value.toUpperCase())}
                maxLength={2}
                className={`w-16 uppercase ${inputCls}`}
              />
            </Field>
            <Field label="Qualification">
              <select
                value={s.qualification}
                onChange={(e) => set("qualification", e.target.value as Qualification | "")}
                className={inputCls}
              >
                <option value="">Not specified</option>
                {QUALIFICATIONS.map((q) => (
                  <option key={q} value={q}>
                    {humanize(q)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-ink2">
              <input
                type="checkbox"
                checked={s.is_primary_for_regulatory}
                onChange={(e) => {
                  // One primary reporter for regulatory purposes.
                  const checked = e.target.checked;
                  onChange(
                    value.map((x, j) => ({
                      ...x,
                      is_primary_for_regulatory:
                        j === i ? checked : checked ? false : x.is_primary_for_regulatory,
                    })),
                  );
                }}
              />
              Primary for regulatory
            </label>
          </RowBox>
        );
      })}
      <AddRow
        label="Add reporter"
        onClick={() => onChange([...value, emptySource(value.length === 0)])}
      />
    </div>
  );
}

/** Typeahead over the dictionary's LLTs; the API ranks exact matches first. */
export function TermSearch({
  dictionaryId,
  value,
  onSelect,
  placeholder,
}: {
  dictionaryId: string | undefined;
  value: { code: string; label: string };
  onSelect: (t: DictionaryTerm | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = useTermSearch(dictionaryId, q);
  if (value.code) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-page px-2 py-1 text-xs">
        <span className="mono text-muted">{value.code}</span>
        <span>{value.label}</span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label="Clear dictionary term"
          className="ml-1 text-muted hover:text-ink"
        >
          <X size={12} aria-hidden />
        </button>
      </span>
    );
  }
  return (
    <span className="relative inline-block">
      <Search
        size={12}
        className="pointer-events-none absolute left-2 top-2 text-muted"
        aria-hidden
      />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? (dictionaryId ? "Search dictionary…" : "No dictionary")}
        disabled={!dictionaryId}
        className={`w-64 pl-6 ${inputCls}`}
        aria-label="Search dictionary terms"
      />
      {open && q.trim().length >= 2 && (
        <ul className="card absolute left-0 top-full z-20 mt-1 max-h-64 w-96 overflow-y-auto shadow-lg">
          {results.isPending && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
          {results.data?.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted">No matching terms.</li>
          )}
          {results.data?.map((t) => (
            <li key={t.code}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(t);
                  setQ("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-page"
              >
                <span>
                  {t.term} <span className="mono text-muted">{t.code}</span>
                </span>
                <span className="text-muted">
                  PT {t.pt_term} · {t.soc_term ?? "no SOC"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function EventsEditor({
  value,
  onChange,
  dictionaryId,
}: {
  value: EventDraft[];
  onChange: (e: EventDraft[]) => void;
  dictionaryId: string | undefined;
}) {
  return (
    <div className="space-y-2">
      {value.map((ev, i) => {
        const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) =>
          onChange(replaceAt(value, i, { ...ev, [k]: v }));
        return (
          <RowBox
            key={ev.key}
            title={`Event ${i + 1}`}
            onRemove={() => onChange(removeAt(value, i))}
          >
            <Field label="Reported term">
              <input
                value={ev.reported_term}
                onChange={(e) => set("reported_term", e.target.value)}
                className={`w-64 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Dictionary term (LLT)">
              <TermSearch
                dictionaryId={dictionaryId}
                value={{ code: ev.llt_code, label: ev.llt_label }}
                onSelect={(t) =>
                  onChange(
                    replaceAt(value, i, {
                      ...ev,
                      llt_code: t?.code ?? "",
                      llt_label: t ? `${t.term} (${t.pt_term} / ${t.soc_term ?? ""})` : "",
                    }),
                  )
                }
              />
            </Field>
            <Field label="Onset">
              <input
                type="date"
                value={ev.onset_date}
                onChange={(e) => set("onset_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="End">
              <input
                type="date"
                value={ev.end_date}
                onChange={(e) => set("end_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Outcome">
              <select
                value={ev.outcome}
                onChange={(e) => set("outcome", e.target.value as EventOutcome)}
                className={inputCls}
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Country" hint="ISO-2">
              <input
                value={ev.occur_country}
                onChange={(e) => set("occur_country", e.target.value.toUpperCase())}
                maxLength={2}
                className={`w-16 uppercase ${inputCls}`}
              />
            </Field>
            <fieldset className="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
              <legend className="mb-1">Seriousness</legend>
              {SERIOUSNESS.map((s) => (
                <label key={s.key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={ev[s.key]}
                    onChange={(e) => set(s.key, e.target.checked)}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
          </RowBox>
        );
      })}
      <AddRow label="Add event" onClick={() => onChange([...value, emptyEvent()])} />
    </div>
  );
}

export function DrugsEditor({
  value,
  onChange,
  products,
  studyBlinded,
}: {
  value: DrugDraft[];
  onChange: (d: DrugDraft[]) => void;
  products: StudyProduct[];
  studyBlinded?: boolean;
}) {
  return (
    <div className="space-y-2">
      {value.map((d, i) => {
        const set = <K extends keyof DrugDraft>(k: K, v: DrugDraft[K]) =>
          onChange(replaceAt(value, i, { ...d, [k]: v }));
        return (
          <RowBox key={d.key} title={`Drug ${i + 1}`} onRemove={() => onChange(removeAt(value, i))}>
            <Field label="Role">
              <select
                value={d.role}
                onChange={(e) => set("role", e.target.value as DrugRole)}
                className={inputCls}
              >
                {DRUG_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Study product">
              <select
                value={d.product_id}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  onChange(
                    replaceAt(value, i, {
                      ...d,
                      product_id: e.target.value,
                      name_as_reported: d.name_as_reported || p?.name || "",
                    }),
                  );
                }}
                className={`w-44 ${inputCls}`}
              >
                <option value="">Other / free text</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name as reported">
              <input
                value={d.name_as_reported}
                onChange={(e) => set("name_as_reported", e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              />
            </Field>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-ink2">
              <input
                type="checkbox"
                checked={d.is_blinded}
                onChange={(e) => set("is_blinded", e.target.checked)}
              />
              Blinded{studyBlinded === false ? " (open-label study)" : ""}
            </label>
            <Field label="Dose">
              <input
                value={d.dose_text}
                onChange={(e) => set("dose_text", e.target.value)}
                placeholder="e.g. 300 mg twice daily"
                className={`w-44 ${inputCls}`}
              />
            </Field>
            <Field label="Route">
              <input
                value={d.route}
                onChange={(e) => set("route", e.target.value)}
                className={`w-28 ${inputCls}`}
              />
            </Field>
            <Field label="Indication">
              <input
                value={d.indication_pt_term}
                onChange={(e) => set("indication_pt_term", e.target.value)}
                className={`w-44 ${inputCls}`}
              />
            </Field>
            <Field label="Lot">
              <input
                value={d.lot_number}
                onChange={(e) => set("lot_number", e.target.value)}
                className={`w-24 ${inputCls}`}
              />
            </Field>
            <Field label="Start">
              <input
                type="date"
                value={d.start_date}
                onChange={(e) => set("start_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="End">
              <input
                type="date"
                value={d.end_date}
                onChange={(e) => set("end_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Action taken">
              <select
                value={d.action_taken}
                onChange={(e) => set("action_taken", e.target.value as ActionTaken | "")}
                className={inputCls}
              >
                <option value="">Not specified</option>
                {ACTIONS_TAKEN.map((a) => (
                  <option key={a} value={a}>
                    {humanize(a)}
                  </option>
                ))}
              </select>
            </Field>
          </RowBox>
        );
      })}
      <AddRow label="Add drug" onClick={() => onChange([...value, emptyDrug()])} />
    </div>
  );
}

export function TestsEditor({
  value,
  onChange,
}: {
  value: TestDraft[];
  onChange: (t: TestDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((t, i) => {
        const set = <K extends keyof TestDraft>(k: K, v: TestDraft[K]) =>
          onChange(replaceAt(value, i, { ...t, [k]: v }));
        return (
          <RowBox key={t.key} title={`Test ${i + 1}`} onRemove={() => onChange(removeAt(value, i))}>
            <Field label="Date">
              <input
                type="date"
                value={t.test_date}
                onChange={(e) => set("test_date", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Test">
              <input
                value={t.test_name}
                onChange={(e) => set("test_name", e.target.value)}
                className={`w-48 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Result">
              <input
                value={t.result_text}
                onChange={(e) => set("result_text", e.target.value)}
                className={`w-32 ${inputCls}`}
              />
            </Field>
            <Field label="Unit">
              <input
                value={t.unit}
                onChange={(e) => set("unit", e.target.value)}
                className={`w-20 ${inputCls}`}
              />
            </Field>
            <Field label="Comments">
              <input
                value={t.comments}
                onChange={(e) => set("comments", e.target.value)}
                className={`w-56 ${inputCls}`}
              />
            </Field>
          </RowBox>
        );
      })}
      <AddRow label="Add test" onClick={() => onChange([...value, emptyTest()])} />
    </div>
  );
}

export function NarrativeEditor({
  value,
  onChange,
}: {
  value: NarrativeDraft;
  onChange: (n: NarrativeDraft) => void;
}) {
  const set = <K extends keyof NarrativeDraft>(k: K, v: NarrativeDraft[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <Field label="Case narrative">
        <textarea
          rows={6}
          value={value.narrative}
          onChange={(e) => set("narrative", e.target.value)}
          className={`w-full ${inputCls}`}
        />
      </Field>
      <Field label="Reporter comments">
        <textarea
          rows={2}
          value={value.reporter_comments}
          onChange={(e) => set("reporter_comments", e.target.value)}
          className={`w-full ${inputCls}`}
        />
      </Field>
      <Field label="Sender comments">
        <textarea
          rows={2}
          value={value.sender_comments}
          onChange={(e) => set("sender_comments", e.target.value)}
          className={`w-full ${inputCls}`}
        />
      </Field>
    </div>
  );
}
