// Dev seed: a CRO instance hosting two sponsors. The main sponsor runs two
// fictional prostate-cancer trials (a blinded Phase 2 with a German site, so
// the EU-CTR SUSAR rules have somewhere to apply, and an open-label Phase 1b)
// with eleven cases sitting at every point of the regulatory clock: due soon,
// overdue, submitted and acknowledged, serious-but-expected, non-serious,
// follow-up in flight, nullified duplicate, placebo after unblinding, an
// intake item from the EDC that is not yet a valid ICSR, an anticipated SAE
// held from individual FDA reporting per the safety surveillance plan, and a
// case where the investigator and the sponsor disagree on causality. The
// second sponsor has one case so sponsor-scoped grants have something to hide
// (ADR-0015).
//
// The dictionary is a labeled illustrative subset with synthetic codes; it is
// not MedDRA and never claims to be (ADR-0005). Seed writes are audited under
// actor 'seed'; signatures are seed_fixture, not a signing ceremony.
//
// Destructive: truncates everything and regenerates every UUID. Never run it
// against a real deployment.
import { sql } from "drizzle-orm";
import { createDb } from "../client.js";
import * as s from "../schema.js";
import { putBlob } from "../storage.js";
import { makePdf } from "./pdf.js";

const { db, sql: pg } = createDb();

// Anchor every relative date on the database's CURRENT_DATE (session
// TimeZone = PV_TIMEZONE), not the machine clock, so the queue reads the same
// on every run and in every zone.
const today = (await pg<{ today: string }[]>`SELECT CURRENT_DATE::text AS today`)[0]!.today;
const day = (offset: number): string => {
  const base = new Date(`${today}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
};
// A timestamp on a given day at 15:00 in the session time zone.
const at = (offset: number, hhmm = "15:00") =>
  sql`(${day(offset)}::date + ${hhmm}::time)::timestamp::timestamptz`;

await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('pv.actor_label', 'seed', true)`);
  await tx.execute(sql`
    TRUNCATE audit_event, submission_acknowledgement, submission, expected_submission_waiver,
      expected_submission, reporting_rule, signature, case_transition, case_nullification,
      case_unblinding, case_attachment, case_narrative, case_test, case_event_designation,
      case_assessment, case_drug, case_event, case_source, case_patient, case_version, "case",
      study_anticipated_event_term, study_anticipated_event, rsi_listed_term,
      product_rsi_version, study_product, product, reporting_destination, access_grant,
      study_site, site, study, person, organization, dictionary_term, dictionary, app_meta
    CASCADE`);

  // --- organizations ---------------------------------------------------------
  const org = async (name: string, kind: "sponsor" | "cro" | "site_org") =>
    (
      await tx.insert(s.organization).values({ name, kind }).returning({ id: s.organization.id })
    )[0]!.id;
  await org("Cascade Clinical Services", "cro");
  const corc = await org("Cascade Oncology Research Consortium", "sponsor");
  const northlake = await org("Northlake Biotherapeutics", "sponsor");
  const memorial = await org("Memorial Cancer Institute", "site_org");
  const pacific = await org("Pacific Oncology Center", "site_org");
  const nordheim = await org("Universitätsklinikum Nordheim", "site_org");
  const gulf = await org("Gulf Coast Cancer Center", "site_org");

  // --- people and grants -------------------------------------------------------
  const person = async (given: string, family: string, email: string, credentials?: string) =>
    (
      await tx
        .insert(s.person)
        .values({ givenName: given, familyName: family, email, credentials: credentials ?? null })
        .returning({ id: s.person.id })
    )[0]!.id;
  // Dev bearer tokens (AUTH_MODE=dev) map to these emails; see .env.example.
  const dana = await person("Dana", "Whitfield", "dana.whitfield@cascade-cro.example"); // dev-admin-token
  const marcus = await person("Marcus", "Lee", "marcus.lee@cascade-cro.example"); // dev-processor-token
  const elena = await person("Elena", "Ortiz", "elena.ortiz@cascade-cro.example");
  const priya = await person("Priya", "Raman", "priya.raman@corc.example", "MD"); // dev-reviewer-token
  const sam = await person("Sam", "Okafor", "sam.okafor@cascade-cro.example"); // dev-readonly-token
  const ingest = await person("EDC", "Intake", "edc.intake@corc.example"); // dev-ingest-token
  const wei = await person("Wei", "Zhang", "wei.zhang@northlake.example", "MD");
  const brooks = await person("Alan", "Brooks", "alan.brooks@memorial.example", "MD"); // PI site 001
  const mueller = await person("Katrin", "Müller", "katrin.mueller@nordheim.example", "MD"); // PI site 003
  const patel = await person("Nisha", "Patel", "nisha.patel@gulfcoast.example", "MD"); // PI site 004

  const grant = async (
    personId: string,
    role: (typeof s.accessRole.enumValues)[number],
    scope: { organizationId?: string; studyId?: string } = {},
  ) =>
    tx.insert(s.accessGrant).values({
      personId,
      role,
      organizationId: scope.organizationId ?? null,
      studyId: scope.studyId ?? null,
    });
  await grant(dana, "admin");
  await grant(sam, "read_only");
  await grant(priya, "medical_reviewer", { organizationId: corc });
  await grant(marcus, "case_processor", { organizationId: corc });
  await grant(ingest, "ingest", { organizationId: corc });
  await grant(wei, "medical_reviewer", { organizationId: northlake });

  // --- illustrative dictionary (NOT MedDRA; synthetic codes) --------------------
  const [dict] = await tx
    .insert(s.dictionary)
    .values({
      type: "MedDRA",
      version: "demo-illustrative",
      termsCount: 0,
      isDemoSubset: true,
      loadedBy: dana,
    })
    .returning({ id: s.dictionary.id });
  const dictId = dict!.id;
  // [pt, soc, ...extra LLT synonyms]. Codes are assigned sequentially in the
  // 9xxxxxxx range so they can never be mistaken for real MedDRA codes.
  const socs: Record<string, string> = {};
  const socOf = (name: string) => {
    if (!socs[name]) socs[name] = String(90000000 + Object.keys(socs).length + 1);
    return socs[name]!;
  };
  const terms: [string, string, ...string[]][] = [
    ["Anaemia", "Blood and lymphatic system disorders", "Anemia"],
    ["Neutropenia", "Blood and lymphatic system disorders"],
    ["Febrile neutropenia", "Blood and lymphatic system disorders"],
    ["Thrombocytopenia", "Blood and lymphatic system disorders"],
    [
      "Myelodysplastic syndrome",
      "Neoplasms benign, malignant and unspecified (incl cysts and polyps)",
    ],
    ["Nausea", "Gastrointestinal disorders", "Feeling sick"],
    ["Vomiting", "Gastrointestinal disorders"],
    ["Diarrhoea", "Gastrointestinal disorders", "Diarrhea"],
    ["Dry mouth", "Gastrointestinal disorders", "Xerostomia"],
    ["Fatigue", "General disorders and administration site conditions", "Tiredness"],
    ["Pyrexia", "General disorders and administration site conditions", "Fever"],
    ["Death", "General disorders and administration site conditions"],
    ["Pneumonitis", "Respiratory, thoracic and mediastinal disorders"],
    ["Interstitial lung disease", "Respiratory, thoracic and mediastinal disorders"],
    ["Dyspnoea", "Respiratory, thoracic and mediastinal disorders", "Shortness of breath"],
    ["Pulmonary embolism", "Respiratory, thoracic and mediastinal disorders"],
    ["Acute kidney injury", "Renal and urinary disorders", "Acute renal failure"],
    ["Seizure", "Nervous system disorders", "Convulsion"],
    ["Headache", "Nervous system disorders"],
    ["Dizziness", "Nervous system disorders"],
    ["Alanine aminotransferase increased", "Investigations", "ALT increased"],
    ["Rash", "Skin and subcutaneous tissue disorders"],
    ["Pruritus", "Skin and subcutaneous tissue disorders", "Itching"],
    ["Hypertension", "Vascular disorders", "High blood pressure"],
    ["Hot flush", "Vascular disorders"],
    ["Atrial fibrillation", "Cardiac disorders"],
    ["Myocardial infarction", "Cardiac disorders", "Heart attack"],
    ["Sepsis", "Infections and infestations"],
    ["Pneumonia", "Infections and infestations"],
    ["Urinary tract infection", "Infections and infestations"],
    ["Hypokalaemia", "Metabolism and nutrition disorders", "Low potassium"],
    ["Decreased appetite", "Metabolism and nutrition disorders", "Loss of appetite"],
    ["Back pain", "Musculoskeletal and connective tissue disorders"],
    ["Arthralgia", "Musculoskeletal and connective tissue disorders", "Joint pain"],
    ["Pathological fracture", "Musculoskeletal and connective tissue disorders"],
    ["Spinal cord compression", "Nervous system disorders"],
    ["Disease progression", "General disorders and administration site conditions"],
    ["Insomnia", "Psychiatric disorders"],
    ["Anxiety", "Psychiatric disorders"],
    ["Fall", "Injury, poisoning and procedural complications"],
  ];
  const pt: Record<
    string,
    { code: string; term: string; socCode: string; socTerm: string; llt: string }
  > = {};
  let n = 0;
  const termRows: (typeof s.dictionaryTerm.$inferInsert)[] = [];
  for (const [ptName, socName, ...synonyms] of terms) {
    n += 1;
    const ptCode = String(91000000 + n);
    const socCode = socOf(socName);
    pt[ptName] = { code: ptCode, term: ptName, socCode, socTerm: socName, llt: ptCode };
    for (const [i, lltName] of [ptName, ...synonyms].entries()) {
      termRows.push({
        dictionaryId: dictId,
        code: i === 0 ? ptCode : String(92000000 + n * 10 + i),
        term: lltName,
        normalizedTerm: lltName.toLowerCase(),
        ptCode,
        ptTerm: ptName,
        hltCode: null,
        hltTerm: null,
        hlgtCode: null,
        hlgtTerm: null,
        socCode,
        socTerm: socName,
        isCurrent: true,
      });
    }
  }
  await tx.insert(s.dictionaryTerm).values(termRows);
  await tx
    .update(s.dictionary)
    .set({ termsCount: termRows.length })
    .where(sql`${s.dictionary.id} = ${dictId}`);
  await tx.insert(s.appMeta).values({ key: "meddra_default_dictionary_id", value: dictId });

  // --- products and RSI ----------------------------------------------------------
  const productRow = async (sponsorOrgId: string, name: string, substance: string) =>
    (
      await tx
        .insert(s.product)
        .values({ sponsorOrgId, name, substance, kind: "investigational" })
        .returning({ id: s.product.id })
    )[0]!.id;
  const corc101 = await productRow(corc, "CORC-101", "cascaparib (fictional PARP inhibitor)");
  const corc201 = await productRow(
    corc,
    "CORC-201",
    "lutetium-cascatide (fictional PSMA radioligand)",
  );
  const nlb7 = await productRow(northlake, "NLB-7", "northlakinib (fictional AR degrader)");

  const rsi = async (
    productId: string,
    label: string,
    from: number,
    to: number | null,
    listed: string[],
  ) => {
    const [v] = await tx
      .insert(s.productRsiVersion)
      .values({
        productId,
        label,
        effectiveFrom: day(from),
        effectiveTo: to === null ? null : day(to),
        approvedBy: priya,
      })
      .returning({ id: s.productRsiVersion.id });
    await tx.insert(s.rsiListedTerm).values(
      listed.map((name) => ({
        rsiVersionId: v!.id,
        dictionaryId: dictId,
        ptCode: pt[name]!.code,
        ptTerm: name,
        listednessNote: name === "Neutropenia" ? "listed as Grade ≤ 3, uncomplicated" : null,
      })),
    );
    return v!.id;
  };
  await rsi(corc101, "IB v1.0 §6.3", -300, -43, [
    "Anaemia",
    "Nausea",
    "Fatigue",
    "Neutropenia",
    "Thrombocytopenia",
  ]);
  await rsi(corc101, "IB v2.0 §6.3", -42, null, [
    "Anaemia",
    "Nausea",
    "Fatigue",
    "Neutropenia",
    "Thrombocytopenia",
    "Pneumonitis",
  ]);
  await rsi(corc201, "IB v1.0 §6.2", -200, null, [
    "Dry mouth",
    "Nausea",
    "Anaemia",
    "Thrombocytopenia",
  ]);
  await rsi(nlb7, "IB v3.1 §7", -150, null, ["Fatigue", "Hot flush", "Hypertension"]);

  // --- studies and sites ----------------------------------------------------------
  const studyRow = async (v: typeof s.study.$inferInsert) =>
    (await tx.insert(s.study).values(v).returning({ id: s.study.id }))[0]!.id;
  const corc2201 = await studyRow({
    protocolNumber: "CORC-2201",
    title:
      "Randomized, double-blind, placebo-controlled Phase 2 study of CORC-101 plus androgen receptor blockade in metastatic castration-resistant prostate cancer",
    phase: "2",
    status: "active",
    sponsorOrgId: corc,
    indNumber: "123456",
    euCtNumber: "2025-512345-11-00",
    isBlinded: true,
  });
  const corc2202 = await studyRow({
    protocolNumber: "CORC-2202",
    title:
      "Open-label Phase 1b study of CORC-201 with an androgen receptor pathway inhibitor in metastatic hormone-sensitive prostate cancer",
    phase: "1b",
    status: "active",
    sponsorOrgId: corc,
    indNumber: "123789",
    isBlinded: false,
  });
  const nlb301 = await studyRow({
    protocolNumber: "NLB-301",
    title:
      "Phase 3 study of NLB-7 versus enzalutamide in first-line metastatic castration-resistant prostate cancer",
    phase: "3",
    status: "active",
    sponsorOrgId: northlake,
    indNumber: "134567",
    isBlinded: false,
  });
  // Test fixture study: API tests create cases under it (never in demo views).
  const corc9999 = await studyRow({
    protocolNumber: "CORC-9999",
    title: "Test fixture study (automated tests only)",
    phase: "1",
    status: "planning",
    sponsorOrgId: corc,
    isBlinded: false,
  });

  await tx.insert(s.studyProduct).values([
    { studyId: corc2201, productId: corc101, role: "imp" },
    { studyId: corc2202, productId: corc201, role: "imp" },
    { studyId: nlb301, productId: nlb7, role: "imp" },
    { studyId: corc9999, productId: corc101, role: "imp" },
  ]);

  // --- anticipated serious adverse events (FDA IND safety reporting, Dec 2025 §V.A) ---
  // CORC-2201's safety surveillance plan lists SAEs anticipated in an mCRPC
  // population independent of the drug; the sponsor does not report them to
  // FDA as individual IND safety reports and reviews them in aggregate. No
  // predicted rate is seeded: a rate never appears here without a real,
  // cited basis, and the demo has none.
  const anticipated = async (
    studyId: string,
    label: string,
    planReference: string,
    ptNames: string[],
  ) => {
    const [row] = await tx
      .insert(s.studyAnticipatedEvent)
      .values({
        studyId,
        label,
        prespecified: true,
        planReference,
        effectiveFrom: day(-200),
        approvedBy: priya,
      })
      .returning({ id: s.studyAnticipatedEvent.id });
    await tx.insert(s.studyAnticipatedEventTerm).values(
      ptNames.map((name) => ({
        anticipatedEventId: row!.id,
        dictionaryId: dictId,
        ptCode: pt[name]!.code,
        ptTerm: name,
      })),
    );
    return row!.id;
  };
  const skeletalConcept = await anticipated(
    corc2201,
    "Skeletal complications of bone metastases",
    "SSP v1.0 §4.2",
    ["Pathological fracture", "Spinal cord compression", "Back pain"],
  );
  await anticipated(
    corc2201,
    "Death or hospitalization from progression of prostate cancer",
    "SSP v1.0 §4.2",
    ["Disease progression", "Death"],
  );

  const siteRow = async (organizationId: string, name: string, city: string, country: string) =>
    (
      await tx
        .insert(s.site)
        .values({ organizationId, name, city, country })
        .returning({ id: s.site.id })
    )[0]!.id;
  const memorialSite = await siteRow(memorial, "Memorial Cancer Institute", "Boston", "US");
  const pacificSite = await siteRow(pacific, "Pacific Oncology Center", "Seattle", "US");
  const nordheimSite = await siteRow(nordheim, "Universitätsklinikum Nordheim", "Nordheim", "DE");
  const gulfSite = await siteRow(gulf, "Gulf Coast Cancer Center", "Houston", "US");
  const studySiteRow = async (studyId: string, siteId: string, siteNumber: string) =>
    (
      await tx
        .insert(s.studySite)
        .values({ studyId, siteId, siteNumber, status: "active" })
        .returning({ id: s.studySite.id })
    )[0]!.id;
  const ss2201_001 = await studySiteRow(corc2201, memorialSite, "001");
  const ss2201_002 = await studySiteRow(corc2201, pacificSite, "002");
  const ss2201_003 = await studySiteRow(corc2201, nordheimSite, "003");
  const ss2202_001 = await studySiteRow(corc2202, memorialSite, "001");
  const ss2202_004 = await studySiteRow(corc2202, gulfSite, "004");
  const ss301_001 = await studySiteRow(nlb301, gulfSite, "001");
  await grant(elena, "case_processor", { studyId: corc2202 });

  // --- destinations and rules ---------------------------------------------------------
  const dest = async (v: typeof s.reportingDestination.$inferInsert) =>
    (
      await tx.insert(s.reportingDestination).values(v).returning({ id: s.reportingDestination.id })
    )[0]!.id;
  const fda = await dest({
    name: "FDA CDER (IND safety reports)",
    kind: "regulator",
    country: "US",
    defaultFormat: "cioms_i_pdf",
  });
  const ev = await dest({
    name: "EudraVigilance (clinical trial module)",
    kind: "regulator",
    defaultFormat: "e2b_r3_json",
  });
  const investigators2201 = await dest({
    sponsorOrgId: corc,
    name: "Investigators, CORC-2201",
    kind: "investigator_group",
    defaultFormat: "cioms_i_pdf",
  });
  const irb2202 = await dest({
    sponsorOrgId: corc,
    name: "Central IRB, CORC-2202",
    kind: "ethics_committee",
    country: "US",
    defaultFormat: "cioms_i_pdf",
  });

  const rule = async (
    v: Omit<typeof s.reportingRule.$inferInsert, "effectiveFrom"> & { effectiveFrom?: string },
  ) => tx.insert(s.reportingRule).values({ effectiveFrom: day(-400), ...v });
  const susar = { serious: true, unexpected: true, related: true } as const;
  // Under 21 CFR 312.32 the sponsor's causality judgment decides an IND safety
  // report (FDA, Sponsor Responsibilities, Dec 2025 §III.B, §IV.A), and an SAE
  // the sponsor designated anticipated in the study population is not
  // reported individually (§IV.A.2.a, §V.A). Both are attributes of the FDA
  // rules only; the EU CTR, investigator, and IRB rules below keep ICH E2A's
  // "either party" basis and no carve-out.
  const fdaBasis = { causalityBasis: "sponsor", excludesAnticipated: true } as const;
  for (const sponsorOrgId of [corc, northlake]) {
    await rule({
      sponsorOrgId,
      destinationId: fda,
      name: "FDA IND 7-day: fatal or life-threatening unexpected suspected adverse reaction",
      citation: "21 CFR 312.32(c)(2); ICH E2A §III.B.1",
      reportTypes: ["study"],
      ...susar,
      ...fdaBasis,
      fatalOrLifeThreatening: true,
      timelineDays: 7,
      satisfyingKinds: ["initial_notification", "initial_report"],
    });
    await rule({
      sponsorOrgId,
      destinationId: fda,
      name: "FDA IND 15-day: serious and unexpected suspected adverse reaction",
      citation: "21 CFR 312.32(c)(1)(i); ICH E2A §III.B.2",
      reportTypes: ["study"],
      ...susar,
      ...fdaBasis,
      timelineDays: 15,
      satisfyingKinds: ["initial_report"],
    });
    await rule({
      sponsorOrgId,
      destinationId: fda,
      name: "FDA IND follow-up: new information on a reported case",
      citation: "21 CFR 312.32(d)",
      reportTypes: ["study"],
      versionKinds: ["follow_up", "amendment"],
      obligationKind: "follow_up",
      requiresPriorSubmission: true,
      timelineDays: 15,
      satisfyingKinds: ["follow_up_report", "amendment"],
    });
    await rule({
      sponsorOrgId,
      destinationId: fda,
      name: "FDA IND nullification of a reported case",
      citation: "Sponsor SOP; ICH E2B(R3) C.1.11",
      obligationKind: "nullification",
      requiresPriorSubmission: true,
      timelineDays: 15,
      satisfyingKinds: ["nullification"],
    });
  }
  await rule({
    studyId: corc2201,
    destinationId: ev,
    name: "EU CTR SUSAR 7-day: fatal or life-threatening",
    citation: "Regulation (EU) 536/2014 Art. 42(2)(a)",
    reportTypes: ["study"],
    ...susar,
    fatalOrLifeThreatening: true,
    timelineDays: 7,
    satisfyingKinds: ["initial_notification", "initial_report"],
  });
  await rule({
    studyId: corc2201,
    destinationId: ev,
    name: "EU CTR SUSAR 15-day",
    citation: "Regulation (EU) 536/2014 Art. 42(2)(b)",
    reportTypes: ["study"],
    ...susar,
    timelineDays: 15,
    satisfyingKinds: ["initial_report"],
  });
  await rule({
    studyId: corc2201,
    destinationId: ev,
    name: "EU CTR SUSAR follow-up: significant new information",
    citation: "Regulation (EU) 536/2014 Annex III §2.4",
    reportTypes: ["study"],
    versionKinds: ["follow_up", "amendment"],
    obligationKind: "follow_up",
    requiresPriorSubmission: true,
    timelineDays: 15,
    satisfyingKinds: ["follow_up_report", "amendment"],
  });
  await rule({
    studyId: corc2201,
    destinationId: investigators2201,
    name: "Investigator SUSAR notification letter",
    citation: "Sponsor SOP; ICH E2A §III.F",
    reportTypes: ["study"],
    ...susar,
    timelineDays: 15,
    satisfyingKinds: ["notification_letter"],
  });
  await rule({
    studyId: corc2202,
    destinationId: irb2202,
    name: "Central IRB SUSAR notification",
    citation: "Sponsor SOP",
    reportTypes: ["study"],
    ...susar,
    timelineDays: 15,
    satisfyingKinds: ["notification_letter"],
  });

  // --- cases -----------------------------------------------------------------------
  type EventSpec = {
    reported: string;
    ptName: string;
    onset: number;
    end?: number;
    outcome: (typeof s.eventOutcome.enumValues)[number];
    death?: boolean;
    lifeThreatening?: boolean;
    hospitalization?: boolean;
    disabling?: boolean;
    otherImportant?: boolean;
  };
  type DrugSpec = {
    role: (typeof s.drugRole.enumValues)[number];
    productId?: string;
    name: string;
    blinded?: boolean;
    dose?: string;
    route?: string;
    start?: number;
    end?: number;
    action?: (typeof s.actionTaken.enumValues)[number];
    indication?: string;
  };
  type CaseSpec = {
    n: number;
    studyId: string;
    productId: string;
    studySiteId: string;
    subject: string;
    initials: string;
    age: number;
    reporter: { personId?: string; given: string; family: string; org: string; country: string };
    firstReceived: number;
    awareness?: number;
    awarenessRationale?: string;
    events: EventSpec[];
    drugs: DrugSpec[];
    reporterRelated?: boolean;
    sponsorRelated?: boolean | null; // null = not yet assessed
    sponsorCausalityResult?: string;
    override?: { expectedness: "expected" | "unexpected"; rationale: string };
    // The sponsor's designation of every event as anticipated in the study
    // population (naming a concept on the study's list) with an optional rationale.
    anticipated?: { conceptId: string; rationale?: string };
    narrative: string;
    createdBy?: string;
    receivedVia: (typeof s.receiptChannel.enumValues)[number];
    receivedRef?: string;
    source?: { system: string; ref: string; payload: unknown };
    country: string;
  };

  const versionHash = async (versionId: string) =>
    (await tx.execute(sql`SELECT pv_case_version_sha256(${versionId}::uuid) AS h`)).at(0)!
      .h as string;
  const syncClock = async (versionId: string) =>
    tx.execute(sql`SELECT pv_sync_expected_submissions(${versionId}::uuid)`);

  const wwid = (n: number, org = "CORC") => `US-CASCADE-${org}-${String(n).padStart(6, "0")}`;
  const senderId = (n: number, org = "CORC") => `US-${org}-2026-${String(n).padStart(4, "0")}`;

  async function insertVersion(
    caseId: string,
    versionNumber: number,
    kind: (typeof s.versionKind.enumValues)[number],
    spec: CaseSpec,
    opts: { infoReceived: number; awareness?: number; rationale?: string; createdBy?: string },
  ) {
    const [v] = await tx
      .insert(s.caseVersion)
      .values({
        caseId,
        versionNumber,
        kind,
        infoReceivedDate: day(opts.infoReceived),
        awarenessDate: day(opts.awareness ?? opts.infoReceived),
        awarenessRationale: opts.rationale ?? null,
        receivedAt: at(opts.infoReceived, "09:30"),
        dictionaryId: dictId,
        createdBy: opts.createdBy ?? spec.createdBy ?? marcus,
      })
      .returning({ id: s.caseVersion.id });
    const versionId = v!.id;
    await tx.insert(s.casePatient).values({
      caseVersionId: versionId,
      initials: spec.initials,
      subjectNumber: spec.subject,
      studySiteId: spec.studySiteId,
      ageValue: spec.age,
      ageUnit: "years",
      sex: "male",
    });
    if (spec.reporter.given) {
      await tx.insert(s.caseSource).values({
        caseVersionId: versionId,
        seq: 1,
        givenName: spec.reporter.given,
        familyName: spec.reporter.family,
        organization: spec.reporter.org,
        country: spec.reporter.country,
        qualification: "physician",
        isPrimaryForRegulatory: true,
        personId: spec.reporter.personId ?? null,
      });
    }
    const eventIds: string[] = [];
    for (const [i, e] of spec.events.entries()) {
      const t = pt[e.ptName]!;
      const [row] = await tx
        .insert(s.caseEvent)
        .values({
          caseVersionId: versionId,
          seq: i + 1,
          reportedTerm: e.reported,
          dictionaryId: dictId,
          lltCode: t.llt,
          lltTerm: t.term,
          ptCode: t.code,
          ptTerm: t.term,
          socCode: t.socCode,
          socTerm: t.socTerm,
          seriousDeath: e.death ?? false,
          seriousLifeThreatening: e.lifeThreatening ?? false,
          seriousHospitalization: e.hospitalization ?? false,
          seriousDisabling: e.disabling ?? false,
          seriousOtherMedicallyImportant: e.otherImportant ?? false,
          onsetDate: day(e.onset),
          endDate: e.end === undefined ? null : day(e.end),
          outcome: e.outcome,
          occurCountry: spec.country,
        })
        .returning({ id: s.caseEvent.id });
      eventIds.push(row!.id);
    }
    const drugIds: { id: string; role: string }[] = [];
    for (const [i, d] of spec.drugs.entries()) {
      const [row] = await tx
        .insert(s.caseDrug)
        .values({
          caseVersionId: versionId,
          seq: i + 1,
          role: d.role,
          productId: d.productId ?? null,
          nameAsReported: d.name,
          isBlinded: d.blinded ?? false,
          doseText: d.dose ?? null,
          route: d.route ?? null,
          startDate: d.start === undefined ? null : day(d.start),
          endDate: d.end === undefined ? null : day(d.end),
          actionTaken: d.action ?? null,
          indicationPtTerm: d.indication ?? null,
        })
        .returning({ id: s.caseDrug.id });
      drugIds.push({ id: row!.id, role: d.role });
    }
    // Assessments on suspect drugs only; the sponsor's may be pending.
    for (const drug of drugIds.filter((d) => d.role === "suspect" || d.role === "interacting")) {
      for (const eventId of eventIds) {
        if (spec.reporterRelated !== undefined) {
          await tx.insert(s.caseAssessment).values({
            caseVersionId: versionId,
            caseDrugId: drug.id,
            caseEventId: eventId,
            assessor: "reporter",
            reasonablePossibility: spec.reporterRelated,
            causalityMethod: "Investigator judgment",
            causalityResult: spec.reporterRelated ? "Related" : "Not related",
          });
        }
        if (spec.sponsorRelated !== undefined && spec.sponsorRelated !== null) {
          await tx.insert(s.caseAssessment).values({
            caseVersionId: versionId,
            caseDrugId: drug.id,
            caseEventId: eventId,
            assessor: "sponsor",
            reasonablePossibility: spec.sponsorRelated,
            causalityMethod: "Sponsor medical review",
            causalityResult:
              spec.sponsorCausalityResult ??
              (spec.sponsorRelated ? "Reasonable possibility" : "No reasonable possibility"),
            expectednessOverride: spec.override?.expectedness ?? null,
            expectednessRationale: spec.override?.rationale ?? null,
          });
        }
      }
    }
    if (spec.anticipated) {
      await tx.insert(s.caseEventDesignation).values(
        eventIds.map((eventId) => ({
          caseVersionId: versionId,
          caseEventId: eventId,
          anticipated: true,
          anticipatedEventId: spec.anticipated!.conceptId,
          rationale: spec.anticipated!.rationale ?? null,
        })),
      );
    }
    await tx
      .insert(s.caseNarrative)
      .values({ caseVersionId: versionId, narrative: spec.narrative });
    await syncClock(versionId);
    return versionId;
  }

  async function createCase(spec: CaseSpec, org = "CORC") {
    const [c] = await tx
      .insert(s.pvCase)
      .values({
        worldwideUniqueId: wwid(spec.n, org),
        senderCaseId: senderId(spec.n, org),
        reportType: "study",
        studyId: spec.studyId,
        productId: spec.productId,
        firstReceivedDate: day(spec.firstReceived),
        receivedVia: spec.receivedVia,
        receivedRef: spec.receivedRef ?? null,
        sourceSystem: spec.source?.system ?? null,
        sourceRef: spec.source?.ref ?? null,
        intakePayload: spec.source ? spec.source.payload : null,
        intakePayloadSha256: spec.source
          ? ((
              await tx.execute(
                sql`SELECT encode(digest(${JSON.stringify(spec.source.payload)}, 'sha256'), 'hex') AS h`,
              )
            ).at(0)!.h as string)
          : null,
        createdBy: spec.createdBy ?? marcus,
      })
      .returning({ id: s.pvCase.id });
    const caseId = c!.id;
    const versionId = await insertVersion(caseId, 1, "initial", spec, {
      infoReceived: spec.firstReceived,
      awareness: spec.awareness,
      rationale: spec.awarenessRationale,
    });
    return { caseId, versionId };
  }

  const transition = (
    caseId: string,
    versionId: string,
    toState: "data_entry" | "medical_review" | "closed",
    offset: number,
    by = marcus,
    note?: string,
  ) =>
    tx.insert(s.caseTransition).values({
      caseId,
      caseVersionId: versionId,
      toState,
      transitionedBy: by,
      transitionedAt: at(offset, "10:00"),
      note: note ?? null,
    });
  const sign = async (
    versionId: string,
    meaning: "medical_review" | "approval",
    offset: number,
    signer = priya,
  ) =>
    tx.insert(s.signature).values({
      caseVersionId: versionId,
      signerPersonId: signer,
      meaning,
      signedSha256: await versionHash(versionId),
      signedAt: at(offset, meaning === "approval" ? "16:30" : "16:00"),
      reauthMethod: "seed_fixture",
      reauthAt: at(offset, meaning === "approval" ? "16:29" : "15:59"),
    });
  const attach = async (
    caseId: string,
    versionId: string | null,
    kind: "source_document" | "correspondence" | "submission_payload",
    fileName: string,
    mime: string,
    bytes: Uint8Array,
    by = marcus,
  ) => {
    const { sha256, sizeBytes } = await putBlob(bytes);
    await tx.insert(s.caseAttachment).values({
      caseId,
      caseVersionId: versionId,
      kind,
      sha256,
      fileName,
      mimeType: mime,
      sizeBytes,
      uploadedBy: by,
    });
    return sha256;
  };
  const submit = async (
    caseId: string,
    versionId: string,
    destinationId: string,
    kind: (typeof s.submissionKind.enumValues)[number],
    format: (typeof s.submissionFormat.enumValues)[number],
    offset: number,
    payload: Uint8Array,
    fileName: string,
    by = marcus,
  ) => {
    const sha = await attach(
      caseId,
      versionId,
      "submission_payload",
      fileName,
      format === "e2b_r3_json" ? "application/json" : "application/pdf",
      payload,
      by,
    );
    const [row] = await tx
      .insert(s.submission)
      .values({
        caseVersionId: versionId,
        destinationId,
        kind,
        format,
        sentAt: at(offset, "11:00"),
        sentBy: by,
        payloadSha256: sha,
        caseVersionSha256: await versionHash(versionId),
        messageId: `MSG-${fileName.replace(/\W+/g, "-")}`,
      })
      .returning({ id: s.submission.id });
    return row!.id;
  };
  const ack = (submissionId: string, code: string, offset: number) =>
    tx.insert(s.submissionAcknowledgement).values({
      submissionId,
      receivedAt: at(offset, "13:00"),
      ackCode: code,
      ackMessageId: `ACK-${offset}`,
      recordedBy: marcus,
    });

  const brooksReporter = {
    personId: brooks,
    given: "Alan",
    family: "Brooks",
    org: "Memorial Cancer Institute",
    country: "US",
  };
  const muellerReporter = {
    personId: mueller,
    given: "Katrin",
    family: "Müller",
    org: "Universitätsklinikum Nordheim",
    country: "DE",
  };
  const patelReporter = {
    personId: patel,
    given: "Nisha",
    family: "Patel",
    org: "Gulf Coast Cancer Center",
    country: "US",
  };
  const pacificReporter = {
    given: "Rosa",
    family: "Alvarez",
    org: "Pacific Oncology Center",
    country: "US",
  };
  const blindedImp = (start: number): DrugSpec => ({
    role: "suspect",
    productId: corc101,
    name: "CORC-101 300 mg / placebo (blinded)",
    blinded: true,
    dose: "300 mg twice daily",
    route: "oral",
    start,
    indication: "Prostate cancer metastatic",
  });

  // 1. Fatal unexpected SUSAR, awareness 4 days ago: 7-day clocks due in 3 days.
  {
    const spec: CaseSpec = {
      n: 1,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_001,
      subject: "2201-001-007",
      initials: "RH",
      age: 68,
      reporter: brooksReporter,
      firstReceived: -4,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Myelodysplastic syndrome, fatal",
          ptName: "Myelodysplastic syndrome",
          onset: -9,
          end: -5,
          outcome: "fatal",
          death: true,
          lifeThreatening: true,
          hospitalization: true,
        },
      ],
      drugs: [
        blindedImp(-190),
        {
          role: "concomitant",
          name: "Enzalutamide",
          dose: "160 mg daily",
          route: "oral",
          start: -190,
        },
      ],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "A 68-year-old man with mCRPC, randomized 190 days before the event, developed progressive pancytopenia; bone marrow biopsy on day -9 confirmed myelodysplastic syndrome with excess blasts. He was hospitalized, deteriorated with neutropenic sepsis, and died on day -5. The investigator considers the event related to study treatment. Study drug had been discontinued at hospitalization.",
    };
    const { caseId, versionId } = await createCase(spec);
    await attach(
      caseId,
      versionId,
      "source_document",
      "SAE-report-2201-001-007.pdf",
      "application/pdf",
      makePdf([
        "Serious Adverse Event Report",
        "Protocol CORC-2201, site 001, subject 2201-001-007",
        "Event: myelodysplastic syndrome, fatal",
        "Investigator: A. Brooks MD",
      ]),
    );
    await attach(
      caseId,
      versionId,
      "source_document",
      "Death-summary-2201-001-007.pdf",
      "application/pdf",
      makePdf([
        "Discharge / death summary",
        "Subject 2201-001-007",
        "Neutropenic sepsis on background of MDS-EB",
        "Date of death: day -5",
      ]),
    );
    await transition(caseId, versionId, "medical_review", -3);
    await sign(versionId, "medical_review", -2);
    await sign(versionId, "approval", -2);
    await tx.insert(s.caseUnblinding).values({
      caseId,
      armLabel: "CORC-101 300 mg BID",
      armRole: "imp",
      unblindedAt: at(-2, "12:00"),
      unblindedBy: priya,
      reason:
        "Expedited reportability of a fatal SUSAR: single-subject unblinding (ICH E2A §III.D; Reg. (EU) 536/2014 Annex III §2.5)",
      sourceSystem: "rtsm-core",
      sourceRef: "CB-2201-0007",
    });
  }

  // 2. Serious unexpected related, awareness 20 days ago, still in medical review: 15-day clocks overdue.
  {
    const spec: CaseSpec = {
      n: 2,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_003,
      subject: "2201-003-002",
      initials: "JK",
      age: 71,
      reporter: muellerReporter,
      firstReceived: -20,
      country: "DE",
      receivedVia: "fax",
      events: [
        {
          reported: "Interstitielle Lungenerkrankung, hospitalization",
          ptName: "Interstitial lung disease",
          onset: -24,
          outcome: "not_recovered",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-120)],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "A 71-year-old man developed progressive dyspnoea and bilateral ground-glass opacities on CT 120 days after randomization; hospitalized for oxygen and corticosteroids. Infectious workup negative. Investigator assessment: possibly related. Study drug interrupted.",
    };
    const { caseId, versionId } = await createCase(spec);
    await attach(
      caseId,
      versionId,
      "source_document",
      "SAE-report-2201-003-002.pdf",
      "application/pdf",
      makePdf([
        "Serious Adverse Event Report",
        "Protocol CORC-2201, site 003, subject 2201-003-002",
        "Event: interstitial lung disease, hospitalization",
        "Investigator: K. Müller MD",
      ]),
    );
    await transition(caseId, versionId, "medical_review", -15);
  }

  // 3. Serious unexpected related, submitted on day 12 and acknowledged: closed.
  let case3Subject: string;
  {
    const spec: CaseSpec = {
      n: 3,
      studyId: corc2202,
      productId: corc201,
      studySiteId: ss2202_004,
      subject: "2202-004-011",
      initials: "TM",
      age: 64,
      reporter: patelReporter,
      firstReceived: -28,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Acute kidney injury requiring hospitalization",
          ptName: "Acute kidney injury",
          onset: -30,
          end: -19,
          outcome: "recovered",
          hospitalization: true,
        },
      ],
      drugs: [
        {
          role: "suspect",
          productId: corc201,
          name: "CORC-201",
          dose: "7.4 GBq every 6 weeks",
          route: "intravenous",
          start: -100,
          action: "dose_not_changed",
        },
      ],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "A 64-year-old man on cycle 3 of CORC-201 presented with creatinine 3.1 mg/dL (baseline 1.0) and oliguria; hospitalized for fluids, recovered to baseline by day -19. Investigator and sponsor consider the event related.",
      createdBy: elena,
    };
    case3Subject = spec.subject;
    const { caseId, versionId } = await createCase(spec);
    await transition(caseId, versionId, "medical_review", -19, elena);
    await sign(versionId, "medical_review", -17);
    await sign(versionId, "approval", -17);
    const payload = Buffer.from(
      JSON.stringify(
        { "C.1.1": senderId(3), "C.1.8.1": wwid(3), note: "seeded E2B(R3) JSON payload" },
        null,
        2,
      ),
    );
    const sub = await submit(
      caseId,
      versionId,
      fda,
      "initial_report",
      "e2b_r3_json",
      -16,
      payload,
      `${senderId(3)}-initial.json`,
      elena,
    );
    await ack(sub, "CA", -15);
    await submit(
      caseId,
      versionId,
      irb2202,
      "notification_letter",
      "cioms_i_pdf",
      -16,
      makePdf(["CIOMS I", senderId(3), "Notification to Central IRB"]),
      `${senderId(3)}-irb-letter.pdf`,
      elena,
    );
    await transition(caseId, versionId, "closed", -14, elena);
  }

  // 4. Serious but expected (Grade 4 anaemia, listed): no expedited obligation; closed.
  {
    const spec: CaseSpec = {
      n: 4,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_002,
      subject: "2201-002-015",
      initials: "PD",
      age: 73,
      reporter: pacificReporter,
      firstReceived: -38,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Anemia grade 4 requiring transfusion",
          ptName: "Anaemia",
          onset: -40,
          end: -33,
          outcome: "recovered",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-80)],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "Haemoglobin 6.4 g/dL with symptomatic anaemia; hospitalized for two units of packed red cells. Listed in the IB (anaemia); serious, expected.",
    };
    const { caseId, versionId } = await createCase(spec);
    await transition(caseId, versionId, "medical_review", -36);
    await sign(versionId, "medical_review", -35);
    await sign(versionId, "approval", -35);
    await transition(caseId, versionId, "closed", -34);
  }

  // 5. Non-serious nausea in data entry.
  {
    const spec: CaseSpec = {
      n: 5,
      studyId: corc2202,
      productId: corc201,
      studySiteId: ss2202_001,
      subject: "2202-001-003",
      initials: "LW",
      age: 59,
      reporter: brooksReporter,
      firstReceived: -8,
      country: "US",
      receivedVia: "email",
      events: [{ reported: "Nausea grade 2", ptName: "Nausea", onset: -10, outcome: "recovering" }],
      drugs: [
        {
          role: "suspect",
          productId: corc201,
          name: "CORC-201",
          dose: "7.4 GBq every 6 weeks",
          route: "intravenous",
          start: -60,
        },
      ],
      reporterRelated: true,
      sponsorRelated: null,
      narrative:
        "Grade 2 nausea after cycle 2, managed with ondansetron. Non-serious; entered for completeness of the safety record.",
      createdBy: elena,
    };
    await createCase(spec);
  }

  // 6. SUSAR submitted on day 10; follow-up version received 3 days ago resets the clock.
  {
    const spec: CaseSpec = {
      n: 6,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_001,
      subject: "2201-001-019",
      initials: "GB",
      age: 66,
      reporter: brooksReporter,
      firstReceived: -28,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Generalized tonic-clonic seizure",
          ptName: "Seizure",
          onset: -30,
          outcome: "not_recovered",
          hospitalization: true,
          otherImportant: true,
        },
      ],
      drugs: [blindedImp(-150)],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "Witnessed generalized tonic-clonic seizure at home 150 days after randomization; hospitalized for observation and workup. MRI without metastasis. Investigator: possibly related.",
    };
    const { caseId, versionId: v1 } = await createCase(spec);
    await attach(
      caseId,
      v1,
      "source_document",
      "SAE-report-2201-001-019.pdf",
      "application/pdf",
      makePdf([
        "Serious Adverse Event Report",
        "Protocol CORC-2201, site 001, subject 2201-001-019",
        "Event: seizure, hospitalization",
      ]),
    );
    await transition(caseId, v1, "medical_review", -22);
    await sign(v1, "medical_review", -20);
    await sign(v1, "approval", -20);
    const fdaSub = await submit(
      caseId,
      v1,
      fda,
      "initial_report",
      "cioms_i_pdf",
      -18,
      makePdf(["CIOMS I", senderId(6), "Initial report to FDA"]),
      `${senderId(6)}-initial-cioms.pdf`,
    );
    await ack(fdaSub, "CA", -17);
    await submit(
      caseId,
      v1,
      ev,
      "initial_report",
      "e2b_r3_json",
      -18,
      Buffer.from(JSON.stringify({ "C.1.1": senderId(6), note: "seeded" })),
      `${senderId(6)}-initial.json`,
    );
    await submit(
      caseId,
      v1,
      investigators2201,
      "notification_letter",
      "cioms_i_pdf",
      -18,
      makePdf(["CIOMS I", senderId(6), "Investigator notification"]),
      `${senderId(6)}-investigator-letter.pdf`,
    );
    // Follow-up: discharge summary, seizure resolved, EEG normal.
    const followUp: CaseSpec = {
      ...spec,
      events: [{ ...spec.events[0]!, end: -26, outcome: "recovered" }],
      narrative: `${spec.narrative} Follow-up (day -3): discharge summary received; EEG normal, no recurrence on levetiracetam, event resolved on day -26.`,
    };
    const v2 = await insertVersion(caseId, 2, "follow_up", followUp, { infoReceived: -3 });
    await attach(
      caseId,
      v2,
      "source_document",
      "Discharge-summary-2201-001-019.pdf",
      "application/pdf",
      makePdf([
        "Discharge summary",
        "Subject 2201-001-019",
        "EEG normal; seizure resolved; levetiracetam started",
      ]),
    );
  }

  // 7. Duplicate of case 3, submitted in error, then nullified with a nullification report.
  {
    const spec: CaseSpec = {
      n: 7,
      studyId: corc2202,
      productId: corc201,
      studySiteId: ss2202_004,
      subject: case3Subject,
      initials: "TM",
      age: 64,
      reporter: patelReporter,
      firstReceived: -27,
      country: "US",
      receivedVia: "fax",
      events: [
        {
          reported: "Acute renal failure, hospitalized",
          ptName: "Acute kidney injury",
          onset: -30,
          end: -19,
          outcome: "recovered",
          hospitalization: true,
        },
      ],
      drugs: [
        {
          role: "suspect",
          productId: corc201,
          name: "CORC-201",
          dose: "7.4 GBq every 6 weeks",
          route: "intravenous",
          start: -100,
        },
      ],
      reporterRelated: true,
      sponsorRelated: true,
      narrative: "Entered from a second site fax of the same event as US-CORC-2026-0003.",
      createdBy: marcus,
    };
    const { caseId, versionId } = await createCase(spec);
    await transition(caseId, versionId, "medical_review", -18);
    await sign(versionId, "medical_review", -16);
    await sign(versionId, "approval", -16);
    await submit(
      caseId,
      versionId,
      fda,
      "initial_report",
      "cioms_i_pdf",
      -15,
      makePdf(["CIOMS I", senderId(7)]),
      `${senderId(7)}-initial-cioms.pdf`,
    );
    await tx.insert(s.caseNullification).values({
      caseId,
      reason: `Duplicate of ${senderId(3)} (same subject, same event, second source document)`,
      nullifiedBy: priya,
      nullifiedAt: at(-12, "09:00"),
    });
    await syncClock(versionId);
    await submit(
      caseId,
      versionId,
      fda,
      "nullification",
      "e2b_r3_json",
      -11,
      Buffer.from(
        JSON.stringify({
          "C.1.1": senderId(7),
          "C.1.11.1": "1",
          "C.1.11.2": `Duplicate of ${senderId(3)}`,
        }),
      ),
      `${senderId(7)}-nullification.json`,
    );
  }

  // 8. Listed term overridden to unexpected; subject on placebo after unblinding: waived.
  {
    const spec: CaseSpec = {
      n: 8,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_002,
      subject: "2201-002-021",
      initials: "AF",
      age: 70,
      reporter: pacificReporter,
      firstReceived: -10,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Neutropenia grade 4, prolonged >7 days, with fever",
          ptName: "Neutropenia",
          onset: -12,
          outcome: "recovering",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-45)],
      reporterRelated: true,
      sponsorRelated: true,
      override: {
        expectedness: "unexpected",
        rationale:
          "IB lists neutropenia as Grade ≤ 3, uncomplicated; prolonged Grade 4 neutropenia with fever exceeds the listed severity and specificity (ICH E2A §II.C.2).",
      },
      narrative:
        "Absolute neutrophil count 0.2 x10^9/L for 9 days with fever 38.6 C; hospitalized for G-CSF and empiric antibiotics. Blinded study drug interrupted.",
    };
    const { caseId, versionId } = await createCase(spec);
    await transition(caseId, versionId, "medical_review", -9);
    await sign(versionId, "medical_review", -8);
    await sign(versionId, "approval", -8);
    await tx.insert(s.caseUnblinding).values({
      caseId,
      armLabel: "Placebo",
      armRole: "placebo",
      unblindedAt: at(-8, "12:00"),
      unblindedBy: priya,
      reason: "Expedited reportability assessment: single-subject unblinding (ICH E2A §III.D)",
      sourceSystem: "rtsm-core",
      sourceRef: "CB-2201-0021",
    });
    const open = await tx.execute(
      sql`SELECT id FROM expected_submission WHERE case_version_id = ${versionId}::uuid`,
    );
    for (const row of open) {
      await tx.insert(s.expectedSubmissionWaiver).values({
        expectedSubmissionId: row.id as string,
        waivedBy: priya,
        waivedAt: at(-8, "12:30"),
        reason:
          "Subject received placebo (unblinded day -8): not an adverse reaction to CORC-101, no expedited report required (ICH E2A §III.E.1). Retained in the SAE record and DSUR tabulation.",
      });
    }
    await transition(caseId, versionId, "closed", -7);
  }

  // 9. Intake item from the EDC: subject and event known, no reporter yet.
  {
    const payload = {
      source: "edc-core",
      study: "CORC-2201",
      subject: "2201-003-004",
      form: "SAE",
      event: "Pulmonary embolism",
      onset: day(-3),
      serious: ["hospitalization"],
    };
    const spec: CaseSpec = {
      n: 9,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_003,
      subject: "2201-003-004",
      initials: "MS",
      age: 62,
      reporter: { given: "", family: "", org: "", country: "DE" },
      firstReceived: -1,
      country: "DE",
      events: [
        {
          reported: "Pulmonary embolism",
          ptName: "Pulmonary embolism",
          onset: -3,
          outcome: "unknown",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-30)],
      narrative: "Received from edc-core SAE form; reporter details pending from site 003.",
      createdBy: ingest,
      receivedVia: "edc_push",
      receivedRef: "SAE-2201-003-004-1",
      source: { system: "edc-core", ref: "SAE-2201-003-004-1", payload },
    };
    await createCase(spec);
  }

  // 10. Anticipated SAE (FDA IND safety reporting, Dec 2025 §IV.A.2.a, §V.A):
  // a pathological fracture in a bone-metastatic mCRPC participant, on the
  // study's list. Serious, unexpected (not in the IB), and neither party can
  // rule the drug out on a single case, so it is a SUSAR for EudraVigilance
  // and the investigators; the sponsor's designation holds the FDA IND 15-day
  // rule back for aggregate review. In medical review, unsigned, both clocks
  // pending.
  {
    const spec: CaseSpec = {
      n: 10,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_003,
      subject: "2201-003-011",
      initials: "HW",
      age: 74,
      reporter: muellerReporter,
      firstReceived: -2,
      country: "DE",
      events: [
        {
          reported: "Pathological fracture of the left femur, hospitalized for fixation",
          ptName: "Pathological fracture",
          onset: -6,
          outcome: "recovering",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-95)],
      reporterRelated: true,
      sponsorRelated: true,
      sponsorCausalityResult:
        "Cannot be ruled out on a single case; anticipated in mCRPC per SSP v1.0 §4.2, monitored in aggregate",
      anticipated: {
        conceptId: skeletalConcept,
        rationale:
          "Known femoral metastasis on the baseline bone scan; fracture after a fall at home. Skeletal complications of bone metastases are listed as anticipated in the safety surveillance plan.",
      },
      narrative:
        "Fall at home with fracture through a known lytic femoral metastasis, admitted for intramedullary fixation. Investigator: possibly related (cannot exclude a contribution of study treatment to bone fragility).",
      receivedVia: "email",
      receivedRef: "SAE form by email from site 003, ref SAE-2201-003-011-1",
    };
    const { caseId, versionId } = await createCase(spec);
    await attach(
      caseId,
      versionId,
      "source_document",
      "SAE-report-2201-003-011.pdf",
      "application/pdf",
      makePdf([
        "Serious Adverse Event Report",
        "Protocol CORC-2201, site 003, subject 2201-003-011",
        "Event: pathological fracture of the femur, hospitalization",
      ]),
    );
    await transition(caseId, versionId, "medical_review", -1);
  }

  // 11. Investigator and sponsor disagree on causality: acute kidney injury the
  // investigator calls related and the sponsor, after review, does not. Both
  // opinions stay on the record and travel with the report; the EU CTR
  // 15-day rule (either party) is due, the FDA IND rule (sponsor's judgment,
  // 21 CFR 312.32) is not. In medical review, unsigned.
  {
    const spec: CaseSpec = {
      n: 11,
      studyId: corc2201,
      productId: corc101,
      studySiteId: ss2201_002,
      subject: "2201-002-006",
      initials: "DL",
      age: 71,
      reporter: pacificReporter,
      firstReceived: -3,
      country: "US",
      events: [
        {
          reported: "Acute kidney injury after three days of diarrhoea, hospitalized for IV fluids",
          ptName: "Acute kidney injury",
          onset: -5,
          end: -1,
          outcome: "recovered",
          hospitalization: true,
        },
      ],
      drugs: [blindedImp(-60)],
      reporterRelated: true,
      sponsorRelated: false,
      sponsorCausalityResult:
        "No reasonable possibility: prerenal injury from dehydration after diarrhoea; creatinine normalized within 48 hours of fluids without a change to study treatment",
      narrative:
        "Three days of watery diarrhoea, then oliguria; creatinine 3.1 mg/dL on admission, 1.1 mg/dL after 48 hours of IV fluids. Study treatment continued unchanged. Investigator: possibly related.",
      receivedVia: "phone",
      receivedRef: "Called in by the site coordinator; SAE form to follow",
    };
    const { caseId, versionId } = await createCase(spec);
    await transition(caseId, versionId, "medical_review", -2);
  }

  // Second sponsor: a pending 15-day case CORC-scoped staff must never see.
  {
    const spec: CaseSpec = {
      n: 1,
      studyId: nlb301,
      productId: nlb7,
      studySiteId: ss301_001,
      subject: "301-001-044",
      initials: "CQ",
      age: 75,
      reporter: patelReporter,
      firstReceived: -6,
      country: "US",
      receivedVia: "email",
      events: [
        {
          reported: "Atrial fibrillation with rapid ventricular response",
          ptName: "Atrial fibrillation",
          onset: -7,
          outcome: "recovering",
          hospitalization: true,
        },
      ],
      drugs: [
        {
          role: "suspect",
          productId: nlb7,
          name: "NLB-7",
          dose: "200 mg daily",
          route: "oral",
          start: -50,
        },
      ],
      reporterRelated: true,
      sponsorRelated: true,
      narrative:
        "New-onset atrial fibrillation with RVR, hospitalized for rate control. Investigator: possibly related.",
      createdBy: dana,
    };
    const { caseId, versionId } = await createCase(spec, "NLB");
    await transition(caseId, versionId, "medical_review", -4, dana);
  }
});

// Fresh statistics for the planner: the truncate-and-rebuild leaves every
// table with default estimates until autovacuum catches up.
await pg`ANALYZE`;
const chain = (
  await pg<{ n: number }[]>`SELECT count(*)::int AS n FROM pv_verify_audit_chain()`
)[0]!.n;
const cases = (await pg<{ n: number }[]>`SELECT count(*)::int AS n FROM v_case_queue`)[0]!.n;
const obligations = (
  await pg<{ n: number }[]>`SELECT count(*)::int AS n FROM v_expected_submission_status`
)[0]!.n;
console.log(
  `seeded ${cases} cases with ${obligations} obligations; audit chain problems: ${chain}`,
);
await pg.end();
