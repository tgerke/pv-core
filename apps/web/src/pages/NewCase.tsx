import { ArrowLeft, Check, CircleDashed, FilePlus2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  can,
  type Study,
  useCreateCase,
  useDictionaries,
  useMe,
  useSites,
  useStudies,
} from "../api";
import {
  type DrugDraft,
  DrugsEditor,
  drugsBody,
  type EventDraft,
  EventsEditor,
  emptyDrug,
  emptyEvent,
  emptyNarrative,
  emptyPatient,
  emptySource,
  eventsBody,
  minimumCriteria,
  NarrativeEditor,
  narrativeBody,
  PatientEditor,
  patientBody,
  SourcesEditor,
  sourcesBody,
} from "../sections";
import { Card, ErrorNote, Field, inputCls, localToday, Notice, primaryCls } from "../ui";

export default function NewCase({ study: selectedStudy }: { study: Study | undefined }) {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: studies } = useStudies();
  const { data: sites } = useSites();
  const { data: dictionaries } = useDictionaries();
  const create = useCreateCase();
  const today = localToday();

  const [studyId, setStudyId] = useState(selectedStudy?.id ?? "");
  const [productId, setProductId] = useState(selectedStudy?.products[0]?.id ?? "");
  const [firstReceived, setFirstReceived] = useState(today);
  const [awareness, setAwareness] = useState(today);
  const [rationale, setRationale] = useState("");
  const [patient, setPatient] = useState(emptyPatient);
  const [sources, setSources] = useState(() => [emptySource(true)]);
  const [events, setEvents] = useState<EventDraft[]>(() => [emptyEvent()]);
  const [drugs, setDrugs] = useState<DrugDraft[]>(() => [emptyDrug()]);
  const [narrative, setNarrative] = useState(emptyNarrative);
  const [err, setErr] = useState<unknown>(null);

  const study = studies?.find((s) => s.id === studyId);
  const dictionary = dictionaries?.find((d) => d.is_default) ?? dictionaries?.[0];
  const studySites = (sites ?? [])
    .filter((s) => s.study_id === studyId)
    .map((s) => ({ id: s.study_site_id, label: `${s.site_number} · ${s.name} (${s.country})` }));
  const criteria = minimumCriteria(patient, sources, events, drugs);
  const valid = criteria.patient && criteria.reporter && criteria.event && criteria.suspectDrug;
  const needsRationale = awareness !== firstReceived;

  if (me && !can(me, "enter")) {
    return (
      <Notice tone="warn">
        Your role can read cases but not create them (needs the 'enter' operation).
      </Notice>
    );
  }

  const submit = () => {
    if (!productId || !firstReceived) return;
    if (needsRationale && !rationale.trim()) return;
    setErr(null);
    create.mutate(
      {
        study_id: studyId || null,
        product_id: productId,
        report_type: studyId ? "study" : "spontaneous",
        first_received_date: firstReceived,
        info_received_date: firstReceived,
        awareness_date: awareness || firstReceived,
        awareness_rationale: needsRationale ? rationale.trim() : null,
        ...(dictionary ? { dictionary_id: dictionary.id } : {}),
        patient: patientBody(patient),
        sources: sourcesBody(sources),
        events: eventsBody(events.filter((e) => e.reported_term.trim())),
        drugs: drugsBody(drugs.filter((d) => d.name_as_reported.trim())),
        narrative: narrativeBody(narrative),
      },
      {
        onError: setErr,
        onSuccess: (r) => navigate(`/cases/${r.case_id}`),
      },
    );
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-ink2 hover:underline">
          <ArrowLeft size={14} aria-hidden />
          Case queue
        </Link>
        <h1 className="mt-1 text-xl font-semibold">New case</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink2">
          Enter what arrived. A case below the E2B(R3) minimum criteria is saved as an intake item
          and its clock starts now; it leaves intake when the four criteria are met.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-6">
          <Card title="Receipt">
            <div className="flex flex-wrap items-end gap-3 px-4 py-3">
              <Field label="Study">
                <select
                  value={studyId}
                  onChange={(e) => {
                    const s = studies?.find((x) => x.id === e.target.value);
                    setStudyId(e.target.value);
                    setProductId(s?.products[0]?.id ?? "");
                    setPatient((p) => ({ ...p, study_site_id: "" }));
                  }}
                  className={`w-64 ${inputCls}`}
                  required
                >
                  <option value="">Select a study</option>
                  {studies?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.protocol_number} · {s.sponsor_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Product">
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className={`w-44 ${inputCls}`}
                  required
                  disabled={!study}
                >
                  <option value="">Select a product</option>
                  {study?.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="First received">
                <input
                  type="date"
                  value={firstReceived}
                  onChange={(e) => {
                    if (awareness === firstReceived) setAwareness(e.target.value);
                    setFirstReceived(e.target.value);
                  }}
                  className={inputCls}
                  required
                />
              </Field>
              <Field label="Awareness date" hint="day 0">
                <input
                  type="date"
                  value={awareness}
                  onChange={(e) => setAwareness(e.target.value)}
                  className={inputCls}
                  required
                />
              </Field>
              {needsRationale && (
                <Field
                  label="Awareness rationale"
                  hint="required when day 0 differs"
                  className="w-full"
                >
                  <input
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    className={`w-full ${inputCls}`}
                    required
                  />
                </Field>
              )}
              {study?.is_blinded && (
                <span className="w-full text-xs text-muted">
                  {study.protocol_number} is blinded: mark study drugs as blinded below.
                </span>
              )}
            </div>
          </Card>

          <Card title="Patient">
            <div className="px-4 py-3">
              <PatientEditor value={patient} onChange={setPatient} sites={studySites} />
            </div>
          </Card>

          <Card title="Reporters">
            <div className="px-4 py-3">
              <SourcesEditor value={sources} onChange={setSources} />
            </div>
          </Card>

          <Card
            title="Events"
            aside={
              dictionary && (
                <span className="text-xs text-muted">
                  {dictionary.type} {dictionary.version}
                  {dictionary.is_demo_subset ? " (demo subset)" : ""}
                </span>
              )
            }
          >
            <div className="px-4 py-3">
              <EventsEditor value={events} onChange={setEvents} dictionaryId={dictionary?.id} />
            </div>
          </Card>

          <Card title="Drugs">
            <div className="px-4 py-3">
              <DrugsEditor
                value={drugs}
                onChange={setDrugs}
                products={study?.products ?? []}
                studyBlinded={study?.is_blinded}
              />
            </div>
          </Card>

          <Card title="Narrative">
            <div className="px-4 py-3">
              <NarrativeEditor value={narrative} onChange={setNarrative} />
            </div>
          </Card>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Card title="Valid ICSR">
            <ul className="space-y-1.5 px-4 py-3 text-sm">
              {[
                ["Identifiable patient", criteria.patient],
                ["Identifiable reporter", criteria.reporter],
                ["At least one event", criteria.event],
                ["At least one suspect drug", criteria.suspectDrug],
              ].map(([label, ok]) => (
                <li key={String(label)} className="flex items-center gap-2">
                  {ok ? (
                    <Check size={14} style={{ color: "var(--status-good)" }} aria-hidden />
                  ) : (
                    <CircleDashed size={14} className="text-muted" aria-hidden />
                  )}
                  <span className={ok ? "" : "text-muted"}>{label}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-hairline px-4 py-2 text-xs text-muted">
              {valid
                ? "Meets the E2B(R3) §3.3.1 minimum criteria: saved as data entry."
                : "Below the minimum criteria: saved as an intake item."}
            </p>
          </Card>
          <button
            type="submit"
            disabled={create.isPending || !productId || !firstReceived}
            className={`w-full justify-center ${primaryCls}`}
            style={{ background: "var(--info)" }}
          >
            <FilePlus2 size={13} aria-hidden />
            {create.isPending ? "Saving…" : valid ? "Create case" : "Save as intake"}
          </button>
          <ErrorNote error={err} />
        </aside>
      </div>
    </form>
  );
}
