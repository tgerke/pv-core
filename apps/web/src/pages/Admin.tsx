import { KeyRound, ListPlus, Plus, Power, RefreshCw, ShieldOff, X } from "lucide-react";
import { useState } from "react";
import {
  ACCESS_ROLE_LABEL,
  type AccessRole,
  type CausalityBasis,
  type CreateRuleBody,
  can,
  type DestinationKind,
  type ObligationKind,
  type OrgKind,
  type Product,
  type ReportingRule,
  type StudyStatus,
  type SubmissionFormat,
  type SubmissionKind,
  useAddRsiVersion,
  useCreateDestination,
  useCreateOrganization,
  useCreatePerson,
  useCreateProduct,
  useCreateRule,
  useCreateSite,
  useCreateStudy,
  useDestinations,
  useDictionaries,
  useEndRsiVersion,
  useEndRule,
  useGrantAccess,
  useImportDictionary,
  useMe,
  useOrganizations,
  usePeople,
  useProducts,
  useReportingRules,
  useResync,
  useRevokeGrant,
  useSites,
  useStudies,
  useUpdateStudy,
} from "../api";
import { TermSearch } from "../sections";
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
  localToday,
  Notice,
  n,
  PageState,
  primaryCls,
  Tabs,
  tdCls,
  thCls,
} from "../ui";
import { SUBMISSION_FORMATS, SUBMISSION_KINDS } from "./CaseObligations";

type TabId =
  | "studies"
  | "sites"
  | "products"
  | "destinations"
  | "rules"
  | "people"
  | "dictionaries";
const TABS: { id: TabId; label: string }[] = [
  { id: "studies", label: "Studies" },
  { id: "sites", label: "Sites" },
  { id: "products", label: "Products & RSI" },
  { id: "destinations", label: "Destinations" },
  { id: "rules", label: "Reporting rules" },
  { id: "people", label: "People & grants" },
  { id: "dictionaries", label: "Dictionaries" },
];

const ORG_KINDS: OrgKind[] = ["sponsor", "cro", "site_org"];
const DEST_KINDS: DestinationKind[] = [
  "regulator",
  "ethics_committee",
  "investigator_group",
  "partner",
];
const ROLES: AccessRole[] = ["admin", "case_processor", "medical_reviewer", "read_only", "ingest"];
const OBLIGATION_KINDS: ObligationKind[] = ["initial", "follow_up", "nullification"];
const CAUSALITY_BASES: CausalityBasis[] = ["either", "sponsor", "reporter"];
const REPORT_TYPES = ["spontaneous", "study", "other", "unknown"];
const VERSION_KINDS = ["initial", "follow_up", "amendment"];

export default function Admin() {
  const { data: me, isPending } = useMe();
  const admin = can(me, "administer");
  const [tab, setTab] = useState<TabId>("studies");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Administration</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink2">
          Reference data behind the engine: studies, sites, products and their reference safety
          information, destinations, reporting rules, people, and dictionaries. Endings are dated
          facts, never deletes; every write is an audited row.
        </p>
      </div>
      {!isPending && !admin && (
        <Notice tone="warn" className="flex items-center gap-2">
          <ShieldOff size={14} className="shrink-0" aria-hidden />
          <span>
            {me?.label ?? "This identity"} can view configuration but not change it: administration
            needs the 'administer' operation. Write actions are hidden; the API would answer 403.
          </span>
        </Notice>
      )}
      <Card>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <div className="px-4 py-3">
          {tab === "studies" && <StudiesTab admin={admin} />}
          {tab === "sites" && <SitesTab admin={admin} />}
          {tab === "products" && <ProductsTab admin={admin} />}
          {tab === "destinations" && <DestinationsTab admin={admin} />}
          {tab === "rules" && <RulesTab admin={admin} />}
          {tab === "people" && <PeopleTab admin={admin} />}
          {tab === "dictionaries" && <DictionariesTab admin={admin} />}
        </div>
      </Card>
    </div>
  );
}

function SubmitButton({
  pending,
  label,
  icon,
}: {
  pending: boolean;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button type="submit" disabled={pending} className={buttonCls}>
      {icon ?? <Plus size={12} aria-hidden />}
      {pending ? "Saving…" : label}
    </button>
  );
}

// --- Studies -----------------------------------------------------------------------------------

const NEXT_STATUS: Record<StudyStatus, StudyStatus | null> = {
  planning: "active",
  active: "closed",
  closed: null,
};

function StudiesTab({ admin }: { admin: boolean }) {
  const q = useStudies();
  const { data: orgs } = useOrganizations();
  const { data: products } = useProducts();
  const create = useCreateStudy();
  const update = useUpdateStudy();
  const [protocol, setProtocol] = useState("");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [blinded, setBlinded] = useState(false);
  const [ind, setInd] = useState("");
  const [euCt, setEuCt] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const sponsors = (orgs ?? []).filter((o) => o.kind === "sponsor");
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="studies" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thCls}>Protocol</th>
                <th className={thCls}>Title</th>
                <th className={thCls}>Sponsor</th>
                <th className={thCls}>Products</th>
                <th className={thCls}>Status</th>
                <th className={`${thCls} text-right`}>Cases</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {q.data.map((s) => {
                const next = NEXT_STATUS[s.status];
                return (
                  <tr key={s.id}>
                    <td className={tdCls}>
                      <div className="font-medium">{s.protocol_number}</div>
                      <div className="text-xs text-muted">
                        {s.phase ? `phase ${s.phase}` : ""}
                        {s.is_blinded ? " · blinded" : " · open-label"}
                        {s.ind_number ? ` · IND ${s.ind_number}` : ""}
                        {s.eu_ct_number ? ` · EU CT ${s.eu_ct_number}` : ""}
                      </div>
                    </td>
                    <td className={`${tdCls} max-w-md text-xs text-ink2`}>{s.title}</td>
                    <td className={tdCls}>{s.sponsor_name}</td>
                    <td className={tdCls}>{s.products.map((p) => p.name).join(", ") || "-"}</td>
                    <td className={tdCls}>
                      <Chip
                        label={s.status}
                        cssVar={s.status === "active" ? "--status-good" : "--muted"}
                        hollow={s.status !== "active"}
                      />
                    </td>
                    <td className={`${tdCls} mono text-right`}>
                      {n(s.case_count)}
                      {n(s.overdue_case_count) > 0 && (
                        <span style={{ color: "var(--status-critical)" }}>
                          {" "}
                          · {n(s.overdue_case_count)} overdue
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      {admin && next && (
                        <button
                          type="button"
                          className={buttonCls}
                          disabled={update.isPending}
                          onClick={() => {
                            setErr(null);
                            update.mutate({ studyId: s.id, status: next }, { onError: setErr });
                          }}
                          title={`Move ${s.protocol_number} from ${s.status} to ${next}. Status only moves forward.`}
                        >
                          <Power size={12} aria-hidden />
                          {next === "active" ? "Mark active" : "Close study"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {admin && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!protocol.trim() || !title.trim() || !sponsor) return;
            setErr(null);
            create.mutate(
              {
                protocol_number: protocol.trim(),
                title: title.trim(),
                phase: phase.trim() || null,
                sponsor_org_id: sponsor,
                is_blinded: blinded,
                ind_number: ind.trim() || null,
                eu_ct_number: euCt.trim() || null,
                study_type: "clinical_trial",
                product_ids: productIds,
              },
              {
                onError: setErr,
                onSuccess: () => {
                  setProtocol("");
                  setTitle("");
                  setPhase("");
                  setInd("");
                  setEuCt("");
                  setProductIds([]);
                },
              },
            );
          }}
        >
          <Field label="Protocol number">
            <input
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className={`w-32 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`w-80 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Phase">
            <input
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className={`w-16 ${inputCls}`}
            />
          </Field>
          <Field label="Sponsor">
            <select
              value={sponsor}
              onChange={(e) => setSponsor(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select</option>
              {sponsors.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="IND">
            <input
              value={ind}
              onChange={(e) => setInd(e.target.value)}
              className={`w-24 ${inputCls}`}
            />
          </Field>
          <Field label="EU CT number">
            <input
              value={euCt}
              onChange={(e) => setEuCt(e.target.value)}
              className={`w-40 ${inputCls}`}
            />
          </Field>
          <label className="flex items-center gap-1.5 pb-1 text-xs text-ink2">
            <input
              type="checkbox"
              checked={blinded}
              onChange={(e) => setBlinded(e.target.checked)}
            />
            Blinded
          </label>
          <fieldset className="flex flex-wrap items-center gap-2 text-xs text-ink2">
            <legend className="mb-1">Products</legend>
            {(products ?? [])
              .filter((p) => !sponsor || p.sponsor_org_id === sponsor)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={productIds.includes(p.id)}
                    onChange={(e) =>
                      setProductIds((ids) =>
                        e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </fieldset>
          <SubmitButton pending={create.isPending} label="Create study" />
          <ErrorNote error={err} className="w-full" />
        </form>
      )}
      {!admin && <ErrorNote error={err} />}
    </div>
  );
}

// --- Sites -------------------------------------------------------------------------------------

function SitesTab({ admin }: { admin: boolean }) {
  const q = useSites();
  const { data: orgs } = useOrganizations();
  const { data: studies } = useStudies();
  const create = useCreateSite();
  const createOrg = useCreateOrganization();
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("US");
  const [studyId, setStudyId] = useState("");
  const [siteNumber, setSiteNumber] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgKind, setOrgKind] = useState<OrgKind>("site_org");
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="sites" />
      ) : q.data.length === 0 ? (
        <Empty>No sites.</Empty>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>Study</th>
              <th className={thCls}>Site number</th>
              <th className={thCls}>Name</th>
              <th className={thCls}>Location</th>
              <th className={thCls}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {q.data.map((s) => (
              <tr key={s.study_site_id}>
                <td className={tdCls}>{s.protocol_number}</td>
                <td className={`${tdCls} mono`}>{s.site_number}</td>
                <td className={tdCls}>{s.name}</td>
                <td className={tdCls}>{[s.city, s.country].filter(Boolean).join(", ")}</td>
                <td className={tdCls}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {admin && (
        <>
          <form
            className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!org || !name.trim() || country.trim().length !== 2) return;
              setErr(null);
              create.mutate(
                {
                  organization_id: org,
                  name: name.trim(),
                  city: city.trim() || null,
                  country: country.trim().toUpperCase(),
                  ...(studyId ? { study_id: studyId, site_number: siteNumber.trim() } : {}),
                },
                {
                  onError: setErr,
                  onSuccess: () => {
                    setName("");
                    setCity("");
                    setSiteNumber("");
                  },
                },
              );
            }}
          >
            <Field label="Organization">
              <select
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              >
                <option value="">Select</option>
                {orgs?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({humanize(o.kind)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Site name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              />
            </Field>
            <Field label="City">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={`w-32 ${inputCls}`}
              />
            </Field>
            <Field label="Country" hint="ISO-2">
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                className={`w-16 uppercase ${inputCls}`}
                required
              />
            </Field>
            <Field label="Enroll in study" hint="optional">
              <select
                value={studyId}
                onChange={(e) => setStudyId(e.target.value)}
                className={inputCls}
              >
                <option value="">None</option>
                {studies?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.protocol_number}
                  </option>
                ))}
              </select>
            </Field>
            {studyId && (
              <Field label="Site number">
                <input
                  value={siteNumber}
                  onChange={(e) => setSiteNumber(e.target.value)}
                  className={`w-20 ${inputCls}`}
                  required
                />
              </Field>
            )}
            <SubmitButton pending={create.isPending} label="Create site" />
            <ErrorNote error={err} className="w-full" />
          </form>
          <form
            className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!orgName.trim()) return;
              setErr(null);
              createOrg.mutate(
                { name: orgName.trim(), kind: orgKind },
                { onError: setErr, onSuccess: () => setOrgName("") },
              );
            }}
          >
            <Field label="New organization">
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Kind">
              <select
                value={orgKind}
                onChange={(e) => setOrgKind(e.target.value as OrgKind)}
                className={inputCls}
              >
                {ORG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {humanize(k)}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton pending={createOrg.isPending} label="Create organization" />
          </form>
        </>
      )}
    </div>
  );
}

// --- Products & RSI ------------------------------------------------------------------------------

function ProductsTab({ admin }: { admin: boolean }) {
  const q = useProducts();
  const { data: orgs } = useOrganizations();
  const create = useCreateProduct();
  const endVersion = useEndRsiVersion();
  const [adding, setAdding] = useState<Product | null>(null);
  const [sponsor, setSponsor] = useState("");
  const [name, setName] = useState("");
  const [substance, setSubstance] = useState("");
  const [kind, setKind] = useState<"investigational" | "marketed">("investigational");
  const [err, setErr] = useState<unknown>(null);
  const today = localToday();
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="products" />
      ) : (
        <ul className="divide-y divide-hairline">
          {q.data.map((p) => (
            <li key={p.id} className="space-y-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-ink2">
                  {p.substance ?? ""} · {p.kind} · {p.sponsor_name}
                </span>
                {admin && (
                  <button
                    type="button"
                    className={`ml-auto ${buttonCls}`}
                    onClick={() => setAdding(p)}
                  >
                    <ListPlus size={12} aria-hidden />
                    Add RSI version
                  </button>
                )}
              </div>
              {(p.rsi_versions ?? []).length === 0 ? (
                <p className="text-xs text-muted">
                  No reference safety information on file: every event is unexpected.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {(p.rsi_versions ?? []).map((r) => (
                    <li
                      key={r.id}
                      className={`rounded-md border border-hairline px-3 py-2 text-sm ${r.effective_to ? "opacity-60" : ""}`}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{r.label}</span>
                        <span className="mono text-xs text-muted">
                          {fmtDate(r.effective_from)} →{" "}
                          {r.effective_to ? fmtDate(r.effective_to) : "open"}
                        </span>
                        <span className="text-xs text-muted">
                          {r.listed_terms.length} listed terms
                        </span>
                        {admin && !r.effective_to && (
                          <button
                            type="button"
                            className={`ml-auto ${buttonCls}`}
                            disabled={endVersion.isPending}
                            onClick={() => {
                              setErr(null);
                              endVersion.mutate(
                                { rsiVersionId: r.id, effective_to: today },
                                { onError: setErr },
                              );
                            }}
                            title="End this version today (its one permitted mutation)"
                          >
                            <Power size={12} aria-hidden />
                            End today
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.listed_terms.map((t) => (
                          <Chip
                            key={t.pt_code}
                            label={t.pt_term}
                            cssVar="--muted"
                            hollow
                            title={`PT ${t.pt_code}${t.listedness_note ? ` · ${t.listedness_note}` : ""}`}
                          />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={err} />
      {admin && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sponsor || !name.trim()) return;
            setErr(null);
            create.mutate(
              {
                sponsor_org_id: sponsor,
                name: name.trim(),
                substance: substance.trim() || null,
                kind,
              },
              {
                onError: setErr,
                onSuccess: () => {
                  setName("");
                  setSubstance("");
                },
              },
            );
          }}
        >
          <Field label="Sponsor">
            <select
              value={sponsor}
              onChange={(e) => setSponsor(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Select</option>
              {(orgs ?? [])
                .filter((o) => o.kind === "sponsor")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Product name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-40 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Substance">
            <input
              value={substance}
              onChange={(e) => setSubstance(e.target.value)}
              className={`w-56 ${inputCls}`}
            />
          </Field>
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "investigational" | "marketed")}
              className={inputCls}
            >
              <option value="investigational">investigational</option>
              <option value="marketed">marketed</option>
            </select>
          </Field>
          <SubmitButton pending={create.isPending} label="Create product" />
        </form>
      )}
      {adding && <RsiDialog product={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function RsiDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { data: dictionaries } = useDictionaries();
  const add = useAddRsiVersion();
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(localToday());
  const [dictionaryId, setDictionaryId] = useState("");
  const [terms, setTerms] = useState<{ pt_code: string; pt_term: string; note: string }[]>(
    () =>
      (product.rsi_versions ?? [])
        .find((r) => !r.effective_to)
        ?.listed_terms.map((t) => ({
          pt_code: t.pt_code,
          pt_term: t.pt_term,
          note: t.listedness_note ?? "",
        })) ?? [],
  );
  const [endPrevious, setEndPrevious] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const dict =
    dictionaryId || dictionaries?.find((d) => d.is_default)?.id || dictionaries?.[0]?.id || "";
  return (
    <Dialog title={`Add RSI version for ${product.name}`} onClose={onClose} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim() || !from || !dict) return;
          setErr(null);
          add.mutate(
            {
              productId: product.id,
              label: label.trim(),
              effective_from: from,
              dictionary_id: dict,
              listed_terms: terms.map((t) => ({
                pt_code: t.pt_code,
                pt_term: t.pt_term,
                listedness_note: t.note.trim() || null,
              })),
              end_previous: endPrevious,
            },
            { onError: setErr, onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-ink2">
          Listed terms are MedDRA preferred terms; expectedness on day 0 is decided against the
          version in effect. Starts from the open version's terms.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. IB v3.0 §6.3"
              className={`w-48 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Effective from">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Dictionary">
            <select
              value={dict}
              onChange={(e) => setDictionaryId(e.target.value)}
              className={inputCls}
              required
            >
              {dictionaries?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.type} {d.version}
                  {d.is_demo_subset ? " (demo)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-1.5 pb-1 text-xs text-ink2">
            <input
              type="checkbox"
              checked={endPrevious}
              onChange={(e) => setEndPrevious(e.target.checked)}
            />
            End the open version the day before
          </label>
        </div>
        <Field label="Add listed term">
          <TermSearch
            dictionaryId={dict || undefined}
            value={{ code: "", label: "" }}
            onSelect={(t) => {
              if (!t || terms.some((x) => x.pt_code === t.pt_code)) return;
              setTerms([...terms, { pt_code: t.pt_code, pt_term: t.pt_term, note: "" }]);
            }}
            placeholder="Search terms; the PT is listed"
          />
        </Field>
        {terms.length === 0 ? (
          <p className="text-xs text-muted">No listed terms yet.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-md border border-hairline">
            {terms.map((t, i) => (
              <li key={t.pt_code} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
                <span>{t.pt_term}</span>
                <span className="mono text-xs text-muted">{t.pt_code}</span>
                <input
                  value={t.note}
                  onChange={(e) =>
                    setTerms(terms.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                  }
                  placeholder="listedness note (optional)"
                  className={`ml-auto w-64 ${inputCls}`}
                  aria-label={`Listedness note for ${t.pt_term}`}
                />
                <button
                  type="button"
                  onClick={() => setTerms(terms.filter((_, j) => j !== i))}
                  className="text-muted hover:text-ink"
                  aria-label={`Remove ${t.pt_term}`}
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={add.isPending || !label.trim() || !dict}
            className={primaryCls}
            style={{ background: "var(--info)" }}
          >
            {add.isPending ? "Saving…" : "Add version"}
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

// --- Destinations --------------------------------------------------------------------------------

function DestinationsTab({ admin }: { admin: boolean }) {
  const q = useDestinations();
  const { data: orgs } = useOrganizations();
  const create = useCreateDestination();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DestinationKind>("regulator");
  const [sponsor, setSponsor] = useState("");
  const [country, setCountry] = useState("");
  const [receiver, setReceiver] = useState("");
  const [format, setFormat] = useState<SubmissionFormat>("e2b_r3_json");
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="destinations" />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>Name</th>
              <th className={thCls}>Kind</th>
              <th className={thCls}>Sponsor</th>
              <th className={thCls}>Country</th>
              <th className={thCls}>E2B receiver</th>
              <th className={thCls}>Default format</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {q.data.map((d) => (
              <tr key={d.id}>
                <td className={tdCls}>{d.name}</td>
                <td className={tdCls}>{humanize(d.kind)}</td>
                <td className={tdCls}>
                  {d.sponsor_name ?? <span className="text-muted">shared</span>}
                </td>
                <td className={tdCls}>{d.country ?? "-"}</td>
                <td className={`${tdCls} mono`}>{d.e2b_receiver_id ?? "-"}</td>
                <td className={tdCls}>{humanize(d.default_format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {admin && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setErr(null);
            create.mutate(
              {
                name: name.trim(),
                kind,
                sponsor_org_id: sponsor || null,
                country: country.trim() ? country.trim().toUpperCase() : null,
                e2b_receiver_id: receiver.trim() || null,
                default_format: format,
              },
              {
                onError: setErr,
                onSuccess: () => {
                  setName("");
                  setReceiver("");
                  setCountry("");
                },
              },
            );
          }}
        >
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-64 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DestinationKind)}
              className={inputCls}
            >
              {DEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sponsor" hint="blank = shared">
            <select
              value={sponsor}
              onChange={(e) => setSponsor(e.target.value)}
              className={inputCls}
            >
              <option value="">Shared</option>
              {(orgs ?? [])
                .filter((o) => o.kind === "sponsor")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Country" hint="ISO-2">
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              className={`w-16 uppercase ${inputCls}`}
            />
          </Field>
          <Field label="E2B receiver id">
            <input
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className={`w-40 ${inputCls}`}
            />
          </Field>
          <Field label="Default format">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as SubmissionFormat)}
              className={inputCls}
            >
              {SUBMISSION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {humanize(f)}
                </option>
              ))}
            </select>
          </Field>
          <SubmitButton pending={create.isPending} label="Create destination" />
          <ErrorNote error={err} className="w-full" />
        </form>
      )}
    </div>
  );
}

// --- Reporting rules -----------------------------------------------------------------------------

type Tri = "" | "yes" | "no";
const tri = (v: Tri): boolean | null => (v === "" ? null : v === "yes");
const criterion = (v: boolean | null, label: string) =>
  v === null ? null : `${v ? "" : "not "}${label}`;

function RulesTab({ admin }: { admin: boolean }) {
  const q = useReportingRules();
  const { data: destinations } = useDestinations();
  const { data: orgs } = useOrganizations();
  const { data: studies } = useStudies();
  const { data: products } = useProducts();
  const create = useCreateRule();
  const end = useEndRule();
  const resync = useResync();
  const [err, setErr] = useState<unknown>(null);
  const [resynced, setResynced] = useState<number | null>(null);
  const [f, setF] = useState({
    destination_id: "",
    name: "",
    citation: "",
    sponsor_org_id: "",
    study_id: "",
    product_id: "",
    obligation_kind: "initial" as ObligationKind,
    serious: "yes" as Tri,
    unexpected: "yes" as Tri,
    related: "yes" as Tri,
    fatal: "" as Tri,
    causality_basis: "either" as CausalityBasis,
    requires_prior_submission: false,
    timeline_days: "15",
    due_soon_days: "3",
    satisfying_kinds: ["initial_report"] as SubmissionKind[],
    report_types: [] as string[],
    version_kinds: [] as string[],
    effective_from: localToday(),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = <T extends string>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const today = localToday();

  const scope = (r: ReportingRule) =>
    [
      r.protocol_number ? `study ${r.protocol_number}` : null,
      r.product_name ? `product ${r.product_name}` : null,
      r.sponsor_name && !r.protocol_number && !r.product_name ? `sponsor ${r.sponsor_name}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "all";

  return (
    <div className="space-y-4">
      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonCls}
            disabled={resync.isPending}
            onClick={() => {
              setErr(null);
              resync.mutate(undefined, {
                onError: setErr,
                onSuccess: (r) => setResynced(r.synced),
              });
            }}
            title="Re-materialize every case's obligations against the current rules"
          >
            <RefreshCw size={12} aria-hidden />
            {resync.isPending ? "Resyncing…" : "Resync obligations"}
          </button>
          {resynced !== null && (
            <span className="text-xs text-muted">{resynced} versions resynced</span>
          )}
        </div>
      )}
      {!q.data ? (
        <PageState query={q} label="reporting rules" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                <th className={thCls}>Rule</th>
                <th className={thCls}>Destination</th>
                <th className={thCls}>Scope</th>
                <th className={thCls}>Applies when</th>
                <th className={thCls}>Clock</th>
                <th className={thCls}>Satisfied by</th>
                <th className={thCls}>Effective</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {q.data.map((r) => {
                const ended = !!r.effective_to && r.effective_to < today;
                const crit = [
                  criterion(r.serious, "serious"),
                  criterion(r.unexpected, "unexpected"),
                  criterion(r.related, `related (${r.causality_basis})`),
                  criterion(r.fatal_or_life_threatening, "fatal/LT"),
                  r.report_types ? `report type ${r.report_types.join("/")}` : null,
                  r.version_kinds ? `versions ${r.version_kinds.join("/")}` : null,
                  r.requires_prior_submission ? "after a prior submission" : null,
                ].filter(Boolean);
                return (
                  <tr key={r.id} className={ended ? "opacity-50" : ""}>
                    <td className={tdCls}>
                      <div>{r.name}</div>
                      {r.citation && <div className="text-xs text-muted">{r.citation}</div>}
                    </td>
                    <td className={tdCls}>{r.destination_name}</td>
                    <td className={`${tdCls} text-xs`}>{scope(r)}</td>
                    <td className={`${tdCls} text-xs text-ink2`}>
                      {humanize(r.obligation_kind)}
                      {crit.length > 0 ? `: ${crit.join(", ")}` : ""}
                    </td>
                    <td className={`${tdCls} mono text-xs`}>
                      {r.timeline_days} d
                      <div className="text-muted">soon at {r.due_soon_days} d</div>
                    </td>
                    <td className={`${tdCls} text-xs`}>
                      {r.satisfying_kinds.map(humanize).join(", ")}
                    </td>
                    <td className={`${tdCls} mono text-xs`}>
                      {fmtDate(r.effective_from)} →{" "}
                      {r.effective_to ? fmtDate(r.effective_to) : "open"}
                    </td>
                    <td className={tdCls}>
                      {admin && !r.effective_to && (
                        <button
                          type="button"
                          className={buttonCls}
                          disabled={end.isPending}
                          onClick={() => {
                            setErr(null);
                            end.mutate({ ruleId: r.id, effective_to: today }, { onError: setErr });
                          }}
                          title="End this rule today; rules are never edited in place"
                        >
                          <Power size={12} aria-hidden />
                          End today
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={err} />
      {admin && (
        <form
          className="space-y-3 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.destination_id || !f.name.trim() || f.satisfying_kinds.length === 0) return;
            const body: CreateRuleBody = {
              destination_id: f.destination_id,
              name: f.name.trim(),
              citation: f.citation.trim() || null,
              sponsor_org_id: f.sponsor_org_id || null,
              study_id: f.study_id || null,
              product_id: f.product_id || null,
              obligation_kind: f.obligation_kind,
              serious: tri(f.serious),
              unexpected: tri(f.unexpected),
              related: tri(f.related),
              fatal_or_life_threatening: tri(f.fatal),
              causality_basis: f.causality_basis,
              requires_prior_submission: f.requires_prior_submission,
              timeline_days: Number(f.timeline_days),
              due_soon_days: Number(f.due_soon_days),
              satisfying_kinds: f.satisfying_kinds,
              report_types: f.report_types.length ? f.report_types : null,
              version_kinds: f.version_kinds.length ? f.version_kinds : null,
              effective_from: f.effective_from,
            };
            setErr(null);
            create.mutate(body, {
              onError: setErr,
              onSuccess: () => setF((x) => ({ ...x, name: "", citation: "" })),
            });
          }}
        >
          <div className="text-xs font-medium text-ink2">New rule</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <input
                value={f.name}
                onChange={(e) => set("name", e.target.value)}
                className={`w-72 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Citation">
              <input
                value={f.citation}
                onChange={(e) => set("citation", e.target.value)}
                className={`w-64 ${inputCls}`}
              />
            </Field>
            <Field label="Destination">
              <select
                value={f.destination_id}
                onChange={(e) => set("destination_id", e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              >
                <option value="">Select</option>
                {destinations?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Obligation">
              <select
                value={f.obligation_kind}
                onChange={(e) => set("obligation_kind", e.target.value as ObligationKind)}
                className={inputCls}
              >
                {OBLIGATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {humanize(k)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Sponsor scope">
              <select
                value={f.sponsor_org_id}
                onChange={(e) => set("sponsor_org_id", e.target.value)}
                className={inputCls}
              >
                <option value="">Any</option>
                {(orgs ?? [])
                  .filter((o) => o.kind === "sponsor")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Study scope">
              <select
                value={f.study_id}
                onChange={(e) => set("study_id", e.target.value)}
                className={inputCls}
              >
                <option value="">Any</option>
                {studies?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.protocol_number}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Product scope">
              <select
                value={f.product_id}
                onChange={(e) => set("product_id", e.target.value)}
                className={inputCls}
              >
                <option value="">Any</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {(
              [
                ["serious", "Serious"],
                ["unexpected", "Unexpected"],
                ["related", "Related"],
                ["fatal", "Fatal / life-threatening"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <select
                  value={f[k]}
                  onChange={(e) => set(k, e.target.value as Tri)}
                  className={inputCls}
                >
                  <option value="">any</option>
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                </select>
              </Field>
            ))}
            <Field label="Causality basis">
              <select
                value={f.causality_basis}
                onChange={(e) => set("causality_basis", e.target.value as CausalityBasis)}
                className={inputCls}
              >
                {CAUSALITY_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-ink2">
              <input
                type="checkbox"
                checked={f.requires_prior_submission}
                onChange={(e) => set("requires_prior_submission", e.target.checked)}
              />
              Requires prior submission
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Timeline (days)">
              <input
                type="number"
                min={1}
                value={f.timeline_days}
                onChange={(e) => set("timeline_days", e.target.value)}
                className={`w-20 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Due soon (days)">
              <input
                type="number"
                min={0}
                value={f.due_soon_days}
                onChange={(e) => set("due_soon_days", e.target.value)}
                className={`w-20 ${inputCls}`}
              />
            </Field>
            <Field label="Effective from">
              <input
                type="date"
                value={f.effective_from}
                onChange={(e) => set("effective_from", e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <fieldset className="flex flex-wrap items-center gap-2 text-xs text-ink2">
              <legend className="mb-1">Satisfied by</legend>
              {SUBMISSION_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={f.satisfying_kinds.includes(k)}
                    onChange={() => set("satisfying_kinds", toggle(f.satisfying_kinds, k))}
                  />
                  {humanize(k)}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-2 text-xs text-ink2">
              <legend className="mb-1">Report types (none = any)</legend>
              {REPORT_TYPES.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={f.report_types.includes(k)}
                    onChange={() => set("report_types", toggle(f.report_types, k))}
                  />
                  {k}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap items-center gap-2 text-xs text-ink2">
              <legend className="mb-1">Version kinds (none = any)</legend>
              {VERSION_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={f.version_kinds.includes(k)}
                    onChange={() => set("version_kinds", toggle(f.version_kinds, k))}
                  />
                  {humanize(k)}
                </label>
              ))}
            </fieldset>
            <SubmitButton pending={create.isPending} label="Create rule" />
          </div>
        </form>
      )}
    </div>
  );
}

// --- People & grants ------------------------------------------------------------------------------

function PeopleTab({ admin }: { admin: boolean }) {
  const q = usePeople();
  const { data: orgs } = useOrganizations();
  const { data: studies } = useStudies();
  const create = useCreatePerson();
  const grant = useGrantAccess();
  const revoke = useRevokeGrant();
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState("");
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<AccessRole>("read_only");
  const [scope, setScope] = useState("unscoped");
  const [err, setErr] = useState<unknown>(null);
  const orgName = (id: string | null) => orgs?.find((o) => o.id === id)?.name ?? id;
  const studyName = (id: string | null) => studies?.find((s) => s.id === id)?.protocol_number ?? id;
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="people" />
      ) : (
        <ul className="divide-y divide-hairline">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
              <div className="w-64">
                <div className="font-medium">
                  {p.given_name} {p.family_name}
                  {p.credentials ? (
                    <span className="text-xs text-muted">, {p.credentials}</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted">{p.email}</div>
              </div>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {(p.grants ?? []).length === 0 && (
                  <span className="text-xs text-muted">no grants</span>
                )}
                {(p.grants ?? []).map((g) => (
                  <span
                    key={g.id}
                    className={`inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-xs ${g.revoked_at ? "opacity-50 line-through" : ""}`}
                    title={`granted ${fmtTime(g.granted_at)}${g.revoked_at ? `, revoked ${fmtTime(g.revoked_at)}` : ""}`}
                  >
                    <KeyRound size={11} className="text-muted" aria-hidden />
                    {ACCESS_ROLE_LABEL[g.role]}
                    <span className="text-muted">
                      ·{" "}
                      {g.study_id
                        ? `study ${studyName(g.study_id)}`
                        : g.organization_id
                          ? orgName(g.organization_id)
                          : "unscoped"}
                    </span>
                    {admin && !g.revoked_at && (
                      <button
                        type="button"
                        onClick={() => {
                          setErr(null);
                          revoke.mutate({ grantId: g.id }, { onError: setErr });
                        }}
                        className="ml-1 text-muted hover:text-ink"
                        aria-label="Revoke grant"
                        title="Revoke (a dated fact)"
                      >
                        <X size={11} aria-hidden />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={err} />
      {admin && (
        <>
          <form
            className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!given.trim() || !family.trim() || !email.trim()) return;
              setErr(null);
              create.mutate(
                {
                  given_name: given.trim(),
                  family_name: family.trim(),
                  email: email.trim(),
                  credentials: credentials.trim() || null,
                },
                {
                  onError: setErr,
                  onSuccess: () => {
                    setGiven("");
                    setFamily("");
                    setEmail("");
                    setCredentials("");
                  },
                },
              );
            }}
          >
            <Field label="Given name">
              <input
                value={given}
                onChange={(e) => setGiven(e.target.value)}
                className={`w-32 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Family name">
              <input
                value={family}
                onChange={(e) => setFamily(e.target.value)}
                className={`w-32 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              />
            </Field>
            <Field label="Credentials">
              <input
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
                className={`w-20 ${inputCls}`}
              />
            </Field>
            <SubmitButton pending={create.isPending} label="Create person" />
          </form>
          <form
            className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!personId) return;
              const [kind, id] = scope.split(":");
              setErr(null);
              grant.mutate(
                {
                  person_id: personId,
                  role,
                  organization_id: kind === "org" ? id : null,
                  study_id: kind === "study" ? id : null,
                },
                { onError: setErr },
              );
            }}
          >
            <Field label="Grant to">
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className={`w-56 ${inputCls}`}
                required
              >
                <option value="">Select a person</option>
                {q.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.family_name}, {p.given_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AccessRole)}
                className={inputCls}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ACCESS_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scope">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className={`w-64 ${inputCls}`}
              >
                <option value="unscoped">Unscoped (everything)</option>
                {(orgs ?? [])
                  .filter((o) => o.kind === "sponsor")
                  .map((o) => (
                    <option key={o.id} value={`org:${o.id}`}>
                      Sponsor: {o.name}
                    </option>
                  ))}
                {studies?.map((s) => (
                  <option key={s.id} value={`study:${s.id}`}>
                    Study: {s.protocol_number}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton
              pending={grant.isPending}
              label="Grant access"
              icon={<KeyRound size={12} aria-hidden />}
            />
          </form>
        </>
      )}
    </div>
  );
}

// --- Dictionaries -----------------------------------------------------------------------------------

function DictionariesTab({ admin }: { admin: boolean }) {
  const q = useDictionaries();
  const importDict = useImportDictionary();
  const [version, setVersion] = useState("");
  const [dir, setDir] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  return (
    <div className="space-y-4">
      {!q.data ? (
        <PageState query={q} label="dictionaries" />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className={thCls}>Type</th>
              <th className={thCls}>Version</th>
              <th className={`${thCls} text-right`}>Terms</th>
              <th className={thCls}>Provenance</th>
              <th className={thCls}>Loaded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {q.data.map((d) => (
              <tr key={d.id}>
                <td className={tdCls}>{d.type}</td>
                <td className={tdCls}>
                  {d.version}
                  {d.is_default && <Chip label="default" cssVar="--info" hollow />}
                </td>
                <td className={`${tdCls} mono text-right`}>{n(d.terms_count)}</td>
                <td className={tdCls}>
                  {d.is_demo_subset ? (
                    <Chip
                      label="demo subset"
                      cssVar="--status-warn"
                      title="Illustrative terms, not a licensed release"
                    />
                  ) : (
                    <span className="mono text-xs text-muted" title={d.source_sha256 ?? undefined}>
                      verbatim release {d.source_sha256 ? `· ${d.source_sha256.slice(0, 12)}…` : ""}
                    </span>
                  )}
                </td>
                <td className={`${tdCls} mono text-xs`}>{fmtTime(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {admin && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!version.trim() || !dir.trim()) return;
            setErr(null);
            setResult(null);
            importDict.mutate(
              { version: version.trim(), dir: dir.trim() },
              { onError: setErr, onSuccess: setResult },
            );
          }}
        >
          <Field label="MedDRA version">
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 27.1"
              className={`w-24 ${inputCls}`}
              required
            />
          </Field>
          <Field label="Directory on the API server" hint="ASCII release files">
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="/data/meddra/27.1/MedAscii"
              className={`w-96 ${inputCls}`}
              required
            />
          </Field>
          <SubmitButton pending={importDict.isPending} label="Import release" />
          <ErrorNote error={err} className="w-full" />
          {result && (
            <pre className="mono w-full overflow-x-auto rounded bg-page p-2 text-xs text-ink2">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </form>
      )}
    </div>
  );
}
