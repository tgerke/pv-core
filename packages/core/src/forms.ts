import type { Sql } from "@pv-core/db";
import PDFDocument from "pdfkit";
import {
  anyEvent,
  concomitantDrugs,
  dechallenge,
  describeReactions,
  loadVersionSnapshot,
  primaryEvent,
  rechallenge,
  str,
  suspectDrugs,
  therapyDuration,
  type VersionSnapshot,
} from "./snapshot.js";

/**
 * Regulatory form renderings (ADR-0012). Field labels and box numbering are
 * transcribed from the official documents fetched 2026-08-17:
 *
 *   CIOMS Form (Suspect Adverse Reaction Report), Council for International
 *   Organizations of Medical Sciences, https://cioms.ch/wp-content/uploads/2017/05/cioms-form1.pdf
 *   sha256 e6f6bad7ad09225e30d8b0e4dec1f033732260db0464439ff94d0e17e8a805dc
 *
 *   Form FDA 3500A MedWatch (09/2025), OMB No. 0910-0291, https://www.fda.gov/media/69876/download
 *   sha256 d9f3e6b6b9fcd5c8d38fda4989c50e73ce77e15ef657476a5e04a968dc2bd382
 *   Instructions: https://www.fda.gov/media/133177/download
 *   sha256 1441210b0c737ea0d69a27c11a77f254216a8c3b3656e6a447c2564335c34dc4
 *
 * A rendering is not the record: the version hash is. Every page carries the
 * sender case id, the version number, and the hash it was rendered from, and
 * the bytes a submission actually sent are stored content-addressed.
 */

type Doc = InstanceType<typeof PDFDocument>;

const M = 36; // margin
const W = 612 - 2 * M; // usable width, US Letter

function render(build: (doc: Doc) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: M, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

const BOTTOM = 792 - M - 24; // keep clear of the footer line

/** Start a new page when the next block would run past the footer. */
function ensure(doc: Doc, y: number, needed: number): number {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return M;
}

function heading(doc: Doc, y: number, text: string): number {
  y = ensure(doc, y, 60);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#000")
    .text(text.toUpperCase(), M, y + 6, { width: W, align: "center", lineBreak: false });
  return y + 20;
}

interface Cell {
  w: number;
  label: string;
  value?: string;
  checks?: [string, boolean][];
}

const boxText = (items: [string, boolean][]) =>
  items.map(([t, on]) => `${on ? "[X]" : "[ ]"} ${t}`).join("\n");

/** Height a cell needs at width w: label (6.5 pt) plus value or check lines (8 pt). */
function measure(doc: Doc, c: Cell, w: number, minH: number): number {
  doc.font("Helvetica").fontSize(6.5);
  const labelH = doc.heightOfString(c.label, { width: w - 6 });
  doc.font("Helvetica").fontSize(8);
  const body = c.checks ? boxText(c.checks) : (c.value ?? "");
  const bodyH = body ? doc.heightOfString(body, { width: w - 6 }) : 0;
  return Math.max(minH, labelH + bodyH + 10);
}

function draw(doc: Doc, c: Cell, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h).lineWidth(0.5).strokeColor("#444").stroke();
  doc.font("Helvetica").fontSize(6.5).fillColor("#333");
  const labelH = doc.heightOfString(c.label, { width: w - 6 });
  doc.text(c.label, x + 3, y + 3, { width: w - 6 });
  const body = c.checks ? boxText(c.checks) : (c.value ?? "");
  if (body) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#000")
      .text(body, x + 3, y + 6 + labelH, { width: w - 6 });
  }
}

/** Lay a row of cells across the width (fractions summing to 1), all the row's height. */
function row(doc: Doc, y: number, cells: Cell[], minH = 30): number {
  const widths = cells.map((c) => Math.round(W * c.w));
  const h = Math.max(...cells.map((c, i) => measure(doc, c, widths[i]!, minH)));
  y = ensure(doc, y, h);
  let x = M;
  cells.forEach((c, i) => {
    draw(doc, c, x, y, widths[i]!, h);
    x += widths[i]!;
  });
  return y + h;
}

function footer(doc: Doc, s: VersionSnapshot, title: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Write inside the bottom margin without triggering a page break.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor("#555")
      .text(
        `${title} rendered by pv-core from ${str(s.case.sender_case_id)} v${str(s.version.version_number)} (version sha256 ${s.versionSha256}); page ${i - range.start + 1} of ${range.count}. A rendering is not the record: the signed version hash is.`,
        M,
        792 - M + 6,
        { width: W, align: "left", lineBreak: true },
      );
    doc.page.margins.bottom = bottom;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const yesNoNa = (v: "YES" | "NO" | "NA"): [string, boolean][] => [
  ["YES", v === "YES"],
  ["NO", v === "NO"],
  ["NA", v === "NA"],
];
const isHealthProfessional = (q: unknown) =>
  q === "physician" || q === "pharmacist" || q === "other_health_professional";

// ---------------------------------------------------------------------------
// CIOMS I
// ---------------------------------------------------------------------------

export async function renderCiomsI(sql: Sql, versionId: string): Promise<Uint8Array> {
  const s = await loadVersionSnapshot(sql, versionId);
  const pe = primaryEvent(s);
  const p = s.patient;
  const suspects = suspectDrugs(s);
  const primary = s.sources[0] ?? null;
  const country = str(p && s.site ? s.site.country : (pe?.occur_country ?? primary?.country));

  return render((doc) => {
    let y = M;
    doc.font("Helvetica-Bold").fontSize(12).text("CIOMS FORM", M, y, { width: W, align: "right" });
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("SUSPECT ADVERSE REACTION REPORT", M, y + 4, { width: W / 2 });
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#333")
      .text(
        `Sender case ID (C.1.1): ${str(s.case.sender_case_id)}   Worldwide unique ID (C.1.8.1): ${str(s.case.worldwide_unique_id)}`,
        M,
        y + 20,
        { width: W },
      );
    y += 34;

    y = heading(doc, y, "I. Reaction information");
    y = row(doc, y, [
      { w: 0.16, label: "1. PATIENT INITIALS (first, last)", value: str(p?.initials) },
      { w: 0.12, label: "1a. COUNTRY", value: country },
      { w: 0.16, label: "2. DATE OF BIRTH (Day / Month / Year)", value: "" },
      {
        w: 0.1,
        label: "2a. AGE (Years)",
        value: p?.age_value != null ? `${str(p.age_value)} ${str(p.age_unit)}` : "",
      },
      { w: 0.1, label: "3. SEX", value: str(p?.sex).toUpperCase() },
      { w: 0.16, label: "4-6 REACTION ONSET (Day / Month / Year)", value: str(pe?.onset_date) },
      {
        w: 0.2,
        label: "8-12 CHECK ALL APPROPRIATE TO ADVERSE REACTION",
        checks: [
          ["PATIENT DIED", anyEvent(s, "serious_death")],
          [
            "INVOLVED OR PROLONGED INPATIENT HOSPITALISATION",
            anyEvent(s, "serious_hospitalization"),
          ],
          [
            "INVOLVED PERSISTENCE OR SIGNIFICANT DISABILITY OR INCAPACITY",
            anyEvent(s, "serious_disabling"),
          ],
          ["LIFE THREATENING", anyEvent(s, "serious_life_threatening")],
        ],
      },
    ]);
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label: "7 + 13 DESCRIBE REACTION(S) (including relevant tests/lab data)",
          value: describeReactions(s),
        },
      ],
      120,
    );

    y = heading(doc, y, "II. Suspect drug(s) information");
    y = row(doc, y, [
      {
        w: 0.8,
        label: "14. SUSPECT DRUG(S) (include generic name)",
        value: suspects
          .map(
            (d) =>
              `${str(d.name_as_reported)}${d.product_name && d.product_name !== d.name_as_reported ? ` (${str(d.product_name)})` : ""}${d.is_blinded ? " [blinded]" : ""}`,
          )
          .join("; "),
      },
      {
        w: 0.2,
        label: "20 DID REACTION ABATE AFTER STOPPING DRUG?",
        checks: yesNoNa(dechallenge(s)),
      },
    ]);
    y = row(doc, y, [
      {
        w: 0.4,
        label: "15. DAILY DOSE(S)",
        value: suspects
          .map((d) => str(d.dose_text))
          .filter(Boolean)
          .join("; "),
      },
      {
        w: 0.4,
        label: "16. ROUTE(S) OF ADMINISTRATION",
        value: suspects
          .map((d) => str(d.route))
          .filter(Boolean)
          .join("; "),
      },
      {
        w: 0.2,
        label: "21. DID REACTION REAPPEAR AFTER REINTRODUCTION?",
        checks: yesNoNa(rechallenge(s)),
      },
    ]);
    y = row(doc, y, [
      {
        w: 1,
        label: "17. INDICATION(S) FOR USE",
        value: suspects
          .map((d) => str(d.indication_pt_term))
          .filter(Boolean)
          .join("; "),
      },
    ]);
    y = row(doc, y, [
      {
        w: 0.5,
        label: "18. THERAPY DATES (from/to)",
        value: suspects
          .map(
            (d) =>
              `${str(d.start_date) || "?"} to ${str(d.end_date) || (d.start_date ? "ongoing" : "?")}`,
          )
          .join("; "),
      },
      {
        w: 0.5,
        label: "19. THERAPY DURATION",
        value: suspects
          .map((d) => therapyDuration(d))
          .filter(Boolean)
          .join("; "),
      },
    ]);

    y = heading(doc, y, "III. Concomitant drug(s) and history");
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label:
            "22. CONCOMITANT DRUG(S) AND DATES OF ADMINISTRATION (exclude those used to treat reaction)",
          value: concomitantDrugs(s)
            .map(
              (d) =>
                `${str(d.name_as_reported)}${d.dose_text ? ` ${str(d.dose_text)}` : ""}${d.start_date ? ` (${str(d.start_date)} to ${str(d.end_date) || "ongoing"})` : ""}`,
            )
            .join("; "),
        },
      ],
      40,
    );
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label:
            "23. OTHER RELEVANT HISTORY (e.g. diagnostics, allergics, pregnancy with last month of period, etc.)",
          value: str(p?.medical_history_text),
        },
      ],
      40,
    );

    y = heading(doc, y, "IV. Manufacturer information");
    const reportSource: [string, boolean][] = [
      ["STUDY", s.case.report_type === "study"],
      ["LITERATURE", false],
      ["HEALTH PROFESSIONAL", isHealthProfessional(primary?.qualification)],
    ];
    y = row(doc, y, [
      { w: 0.5, label: "24a. NAME AND ADDRESS OF MANUFACTURER", value: str(s.sponsor?.name) },
      { w: 0.25, label: "24b. MFR CONTROL NO.", value: str(s.case.sender_case_id) },
      {
        w: 0.25,
        label: "24c. DATE RECEIVED BY MANUFACTURER",
        value: str(s.case.first_received_date),
      },
    ]);
    y = row(doc, y, [
      { w: 0.5, label: "24d. REPORT SOURCE", checks: reportSource },
      { w: 0.25, label: "DATE OF THIS REPORT", value: today() },
      {
        w: 0.25,
        label: "25a. REPORT TYPE",
        checks: [
          ["INITIAL", s.version.kind === "initial"],
          ["FOLLOWUP", s.version.kind !== "initial"],
        ],
      },
    ]);
    if (s.study) {
      row(
        doc,
        y,
        [
          {
            w: 1,
            label: "Study identification (E2B(R3) C.5)",
            value: `${str(s.study.protocol_number)}: ${str(s.study.title)}${s.study.ind_number ? `; IND ${str(s.study.ind_number)}` : ""}${s.study.eu_ct_number ? `; EU CT ${str(s.study.eu_ct_number)}` : ""}`,
          },
        ],
        24,
      );
    }
    footer(doc, s, "CIOMS I");
  });
}

// ---------------------------------------------------------------------------
// FDA Form 3500A (MedWatch mandatory reporting), drug sections A, B, C, E, G.
// Device sections D, F, H are not applicable to a drug case and are omitted.
// ---------------------------------------------------------------------------

export async function renderMedWatch3500A(sql: Sql, versionId: string): Promise<Uint8Array> {
  const s = await loadVersionSnapshot(sql, versionId);
  const pe = primaryEvent(s);
  const p = s.patient;
  const suspects = suspectDrugs(s).slice(0, 2);
  const primary = s.sources[0] ?? null;
  const expedited = str(s.reportability.expedited_class);
  const versionNumber = Number(s.version.version_number);
  const foreign = Boolean(primary?.country && primary.country !== "US");

  return render((doc) => {
    let y = M;
    doc.font("Helvetica-Bold").fontSize(12).text("MEDWATCH FORM FDA 3500A", M, y, { width: W });
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#333")
      .text(
        "For use by user facilities, importers, distributors, packers and manufacturers for MANDATORY reporting. Form FDA 3500A MedWatch (09/2025), OMB No. 0910-0291. Rendered content, drug sections A, B, C, E, G; device sections D, F, H not applicable.",
        M,
        y + 14,
        { width: W },
      );
    y += 34;
    y = row(
      doc,
      y,
      [
        { w: 0.5, label: "Mfr report #", value: str(s.case.sender_case_id) },
        { w: 0.5, label: "UF/Importer Report #", value: "" },
      ],
      22,
    );

    y = heading(doc, y, "A. Patient information");
    y = row(doc, y, [
      {
        w: 0.3,
        label: "1. Patient Identifier (In confidence)",
        value: str(p?.subject_number || p?.initials),
      },
      {
        w: 0.3,
        label: "2. Age (Year(s) / Month(s) / Week(s) / Day(s)) or Date of Birth",
        value: p?.age_value != null ? `${str(p.age_value)} ${str(p.age_unit)}` : "",
      },
      {
        w: 0.2,
        label: "3. Sex",
        checks: [
          ["Male", p?.sex === "male"],
          ["Female", p?.sex === "female"],
        ],
      },
      {
        w: 0.2,
        label: "4. Weight (lb / kg)",
        value: p?.weight_kg != null ? `${str(p.weight_kg)} kg` : "",
      },
    ]);
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label: "5. Race and/or Ethnicity (Select all that apply)",
          value: "Not collected in the safety database",
        },
      ],
      22,
    );

    y = heading(doc, y, "B. Adverse event or product problem");
    const death = s.events.find((e) => e.serious_death);
    y = row(doc, y, [
      {
        w: 0.25,
        label: "1. Type of Report (Check all that apply)",
        checks: [
          ["Adverse Event", true],
          ["Product Problem (e.g., defects/malfunctions)", false],
        ],
      },
      {
        w: 0.75,
        label: "2. Outcome Attributed to Adverse Event (Check all that apply)",
        checks: [
          [
            `Death${death ? ` - Date of death: ${str(p?.death_date) || "unknown"}` : ""}`,
            Boolean(death),
          ],
          ["Life-threatening", anyEvent(s, "serious_life_threatening")],
          ["Hospitalization (Initial or prolonged)", anyEvent(s, "serious_hospitalization")],
          ["Required Intervention to Prevent Permanent Impairment/Damage", false],
          ["Disability or Permanent Damage", anyEvent(s, "serious_disabling")],
          ["Congenital Anomaly/Birth Defects", anyEvent(s, "serious_congenital_anomaly")],
          [
            "Other Serious or Important Medical Events",
            anyEvent(s, "serious_other_medically_important"),
          ],
        ],
      },
    ]);
    y = row(
      doc,
      y,
      [
        { w: 0.5, label: "3. Date of Event", value: str(pe?.onset_date) },
        { w: 0.5, label: "4. Date of this Report", value: today() },
      ],
      22,
    );
    y = row(
      doc,
      y,
      [{ w: 1, label: "5. Describe Event or Problem", value: describeReactions(s) }],
      110,
    );
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label:
            "6. Relevant Test/Laboratory Data (Low Test Range, High Test Range, Date) and Additional Comments",
          value: [
            ...s.tests.map(
              (t) =>
                `${str(t.test_name)}: ${[t.result_text, t.unit].filter(Boolean).join(" ")}${t.test_date ? ` (${str(t.test_date)})` : ""}${t.comments ? `; ${str(t.comments)}` : ""}`,
            ),
            s.narrative?.sender_comments
              ? `Additional comments: ${str(s.narrative.sender_comments)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      40,
    );
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label:
            "7. Other Relevant History, Including Preexisting Medical Conditions (e.g., allergies, pregnancy, tobacco product use, alcohol use, and liver/kidney problems, etc.)",
          value: str(p?.medical_history_text),
        },
      ],
      40,
    );

    doc.addPage();
    y = M;
    y = heading(doc, y, "C. Suspect products");
    suspects.forEach((d, i) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#000")
        .text(`SUSPECT PRODUCT #${i + 1}`, M, y);
      y += 12;
      y = row(doc, y, [
        {
          w: 0.4,
          label: "1. Name, Strength, Manufacturer/Compounder (Product Name; Strength; Unit)",
          value: `${str(d.name_as_reported)}${d.is_blinded ? " [blinded]" : ""}${d.dose_value ? `; ${str(d.dose_value)} ${str(d.dose_unit)}` : ""}`,
        },
        { w: 0.2, label: "NDC # or Unique ID", value: str(d.product_name) },
        { w: 0.25, label: "Manufacturer/Compounder Name", value: str(s.sponsor?.name) },
        { w: 0.15, label: "Lot #", value: str(d.lot_number) },
      ]);
      y = row(
        doc,
        y,
        [
          { w: 0.4, label: "2. Dose or Amount; Unit", value: str(d.dose_text) },
          { w: 0.3, label: "Frequency; Other Frequency", value: "" },
          { w: 0.3, label: "Route; Other Route", value: str(d.route) },
        ],
        24,
      );
      y = row(doc, y, [
        {
          w: 0.6,
          label:
            "3. Treatment/Therapy/Usage Dates (Therapy/Usage started on; stopped on; Dose Reduced on) OR Duration; Unit",
          value: `started ${str(d.start_date) || "?"}; stopped ${str(d.end_date) || (d.start_date ? "ongoing" : "?")}${d.action_taken === "dose_reduced" ? "; dose reduced" : ""}${therapyDuration(d) ? `; duration ${therapyDuration(d)}` : ""}`,
        },
        { w: 0.4, label: "4. Diagnosis for use (Indication)", value: str(d.indication_pt_term) },
      ]);
      y = row(
        doc,
        y,
        [
          {
            w: 0.5,
            label: "5. Product Type (Check all that apply)",
            value: "Investigational product (study)",
          },
          { w: 0.5, label: "6. Expiration Date", value: "" },
        ],
        22,
      );
      y = row(doc, y, [
        {
          w: 0.5,
          label: "7. Event Abated after use Stopped or Dose Reduced?",
          checks: [
            ["Yes", dechallenge(s) === "YES"],
            ["No", dechallenge(s) === "NO"],
            ["Doesn't Apply", dechallenge(s) === "NA"],
          ],
        },
        {
          w: 0.5,
          label: "8. Event Reappeared after Reintroduction?",
          checks: [
            ["Yes", rechallenge(s) === "YES"],
            ["No", rechallenge(s) === "NO"],
            ["Doesn't Apply", rechallenge(s) === "NA"],
          ],
        },
      ]);
      y += 6;
    });
    y = row(
      doc,
      y,
      [
        {
          w: 1,
          label:
            "9. List Medical Product and Treatment Given at the Same Time of the Event and Date (Product Name; Therapy/Usage Start Date; Therapy/Usage Stop Date)",
          value: concomitantDrugs(s)
            .map(
              (d, i) =>
                `${i + 1}. ${str(d.name_as_reported)}; ${str(d.start_date) || "?"}; ${str(d.end_date) || (d.start_date ? "ongoing" : "?")}`,
            )
            .join("\n"),
        },
      ],
      40,
    );

    y = heading(doc, y, "E. Initial reporter");
    y = row(doc, y, [
      { w: 0.25, label: "1. Name and Address: Last Name", value: str(primary?.family_name) },
      { w: 0.25, label: "First Name", value: str(primary?.given_name) },
      { w: 0.35, label: "Address (organization)", value: str(primary?.organization) },
      { w: 0.15, label: "Country", value: str(primary?.country) },
    ]);
    y = row(doc, y, [
      {
        w: 0.25,
        label: "2. Health Professional?",
        checks: [
          ["Yes", isHealthProfessional(primary?.qualification)],
          ["No", primary != null && !isHealthProfessional(primary.qualification)],
        ],
      },
      {
        w: 0.35,
        label: "3. Occupation (Select list)",
        value: str(primary?.qualification).replace(/_/g, " "),
      },
      {
        w: 0.4,
        label: "4. Initial reporter also sent report to FDA?",
        checks: [
          ["Yes", false],
          ["No", false],
          ["Unknown", true],
        ],
      },
    ]);

    y = heading(doc, y, "G. All manufacturers");
    y = row(doc, y, [
      {
        w: 0.5,
        label: "1. Contact Office (Name; Email Address; Phone Number; Address)",
        value: str(s.sponsor?.name),
      },
      {
        w: 0.5,
        label: "2. Report Source (Check all that apply)",
        checks: [
          ["Foreign", foreign],
          ["Study", s.case.report_type === "study"],
          ["Literature", false],
          ["Consumer", primary?.qualification === "consumer"],
          ["Health Professional", isHealthProfessional(primary?.qualification)],
          ["User Facility", false],
          ["Company Representative", false],
          ["Distributor/Importer", false],
          ["Other (Please list)", false],
        ],
      },
    ]);
    y = row(doc, y, [
      {
        w: 0.3,
        label: "3. Date Received by Manufacturer or Responsible Person",
        value: str(s.case.first_received_date),
      },
      {
        w: 0.35,
        label: "4. NDA # / ANDA/Pre-ANDA # / IND # / BLA # / PMA/510(k) #",
        value: s.study?.ind_number ? `IND ${str(s.study.ind_number)}` : "",
      },
      {
        w: 0.35,
        label: "5. If IND/Pre-ANDA, Give Protocol #",
        value: str(s.study?.protocol_number),
      },
    ]);
    y = row(doc, y, [
      {
        w: 0.5,
        label: "6. Type of Report (Check all that apply)",
        checks: [
          ["5-day", false],
          ["7-day", expedited === "7d"],
          ["15-day", expedited === "15d" || expedited === "7d"],
          ["30-day", false],
          ["Non-expedited (periodic)", expedited === "none"],
          ["Initial", versionNumber === 1],
          [`Follow-up #${versionNumber > 1 ? ` ${versionNumber - 1}` : ""}`, versionNumber > 1],
        ],
      },
      {
        w: 0.5,
        label: "7. Adverse Event Term(s)",
        value: s.events.map((e) => str(e.pt_term || e.reported_term)).join("; "),
      },
    ]);
    row(
      doc,
      y,
      [{ w: 1, label: "8. Manufacturer Report Number", value: str(s.case.sender_case_id) }],
      22,
    );
    footer(doc, s, "Form FDA 3500A");
  });
}
