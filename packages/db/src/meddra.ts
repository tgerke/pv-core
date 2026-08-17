import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { dictionary, dictionaryTerm } from "./schema.js";

/**
 * Verbatim MedDRA loader (ADR-0005). Reads the licensed ASCII distribution
 * from a directory you point it at; nothing is vendored here.
 *
 * Assumed layouts ($-delimited, trailing $), from the MedDRA distribution
 * file format document that ships with every release. Verify against your
 * release's dist_file_format before the first import; the loader checks the
 * field count and code shape and refuses on a mismatch rather than guessing.
 *
 *   mdhier.asc: pt_code$hlt_code$hlgt_code$soc_code$pt_name$hlt_name$hlgt_name$
 *               soc_name$soc_abbrev$null_field$pt_soc_code$primary_soc_fg$
 *   llt.asc:    llt_code$llt_name$pt_code$llt_whoart_code$llt_harts_code$
 *               llt_costart_sym$llt_icd9_code$llt_icd9cm_code$llt_icd10_code$
 *               llt_currency$llt_jart_code$
 *
 * One dictionary_term row per LLT, carrying the PT's primary SOC path.
 */

export interface MeddraHierarchyRow {
  ptCode: string;
  hltCode: string;
  hlgtCode: string;
  socCode: string;
  ptName: string;
  hltName: string;
  hlgtName: string;
  socName: string;
  primary: boolean;
}

export interface MeddraLltRow {
  lltCode: string;
  lltName: string;
  ptCode: string;
  current: boolean;
}

const CODE = /^\d{8}$/;

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitLine(line: string): string[] {
  // Trailing "$" yields an empty last field; drop it.
  const fields = line.split("$");
  if (fields.length > 1 && fields[fields.length - 1] === "") fields.pop();
  return fields;
}

export function parseMdhier(text: string): MeddraHierarchyRow[] {
  const rows: MeddraHierarchyRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = splitLine(raw);
    if (f.length < 12) {
      throw new Error(
        `mdhier.asc: expected 12 $-delimited fields, got ${f.length}: ${raw.slice(0, 80)}`,
      );
    }
    const [ptCode, hltCode, hlgtCode, socCode, ptName, hltName, hlgtName, socName] = f as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!CODE.test(ptCode) || !CODE.test(socCode)) {
      throw new Error(`mdhier.asc: codes are not 8-digit numerics: ${raw.slice(0, 80)}`);
    }
    rows.push({
      ptCode,
      hltCode,
      hlgtCode,
      socCode,
      ptName,
      hltName,
      hlgtName,
      socName,
      primary: f[11] === "Y",
    });
  }
  return rows;
}

export function parseLlt(text: string): MeddraLltRow[] {
  const rows: MeddraLltRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = splitLine(raw);
    if (f.length < 10) {
      throw new Error(
        `llt.asc: expected at least 10 $-delimited fields, got ${f.length}: ${raw.slice(0, 80)}`,
      );
    }
    const [lltCode, lltName, ptCode] = f as [string, string, string];
    if (!CODE.test(lltCode) || !CODE.test(ptCode)) {
      throw new Error(`llt.asc: codes are not 8-digit numerics: ${raw.slice(0, 80)}`);
    }
    rows.push({ lltCode, lltName, ptCode, current: f[9] === "Y" });
  }
  return rows;
}

export interface MeddraImportInput {
  version: string;
  dir: string;
  actorLabel?: string;
  loadedBy?: string;
}

export interface MeddraImportResult {
  dictionaryId: string;
  version: string;
  termsCount: number;
  sourceSha256: string;
  skipped: boolean;
}

/**
 * Load a MedDRA release verbatim. Idempotent: an existing (MedDRA, version)
 * dictionary is left untouched and reported as skipped.
 */
export async function importMeddra(db: Db, input: MeddraImportInput): Promise<MeddraImportResult> {
  const mdhierBytes = readFileSync(join(input.dir, "mdhier.asc"));
  const lltBytes = readFileSync(join(input.dir, "llt.asc"));
  const sourceSha256 = createHash("sha256").update(mdhierBytes).update(lltBytes).digest("hex");

  const hierarchy = parseMdhier(mdhierBytes.toString("utf8"));
  const llts = parseLlt(lltBytes.toString("utf8"));
  const primaryByPt = new Map<string, MeddraHierarchyRow>();
  for (const h of hierarchy) {
    // Prefer the primary SOC path; fall back to any path for a PT that has
    // no primary flag in the file.
    const existing = primaryByPt.get(h.ptCode);
    if (!existing || (!existing.primary && h.primary)) primaryByPt.set(h.ptCode, h);
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('pv.actor_label', ${input.actorLabel ?? "import-meddra"}, true)`,
    );
    const existing = await tx
      .select({ id: dictionary.id, termsCount: dictionary.termsCount })
      .from(dictionary)
      .where(sql`${dictionary.type} = 'MedDRA' AND ${dictionary.version} = ${input.version}`);
    if (existing[0]) {
      return {
        dictionaryId: existing[0].id,
        version: input.version,
        termsCount: existing[0].termsCount,
        sourceSha256,
        skipped: true,
      };
    }
    const [header] = await tx
      .insert(dictionary)
      .values({
        type: "MedDRA",
        version: input.version,
        termsCount: 0,
        isDemoSubset: false,
        loadedBy: input.loadedBy ?? null,
      })
      .returning({ id: dictionary.id });
    if (!header) throw new Error("dictionary insert returned no row");

    let count = 0;
    const batch: (typeof dictionaryTerm.$inferInsert)[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await tx.insert(dictionaryTerm).values(batch.splice(0, batch.length));
    };
    for (const llt of llts) {
      const h = primaryByPt.get(llt.ptCode);
      if (!h) {
        throw new Error(
          `llt.asc: LLT ${llt.lltCode} references PT ${llt.ptCode} absent from mdhier.asc`,
        );
      }
      batch.push({
        dictionaryId: header.id,
        code: llt.lltCode,
        term: llt.lltName,
        normalizedTerm: normalizeTerm(llt.lltName),
        ptCode: h.ptCode,
        ptTerm: h.ptName,
        hltCode: h.hltCode,
        hltTerm: h.hltName,
        hlgtCode: h.hlgtCode,
        hlgtTerm: h.hlgtName,
        socCode: h.socCode,
        socTerm: h.socName,
        isCurrent: llt.current,
      });
      count += 1;
      if (batch.length >= 1000) await flush();
    }
    await flush();
    await tx
      .update(dictionary)
      .set({ termsCount: count, sourceSha256 })
      .where(sql`${dictionary.id} = ${header.id}`);
    return {
      dictionaryId: header.id,
      version: input.version,
      termsCount: count,
      sourceSha256,
      skipped: false,
    };
  });
}
