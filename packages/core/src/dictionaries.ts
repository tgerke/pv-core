import type { Db, Sql } from "@pv-core/db";
import { importMeddra, type MeddraImportResult, normalizeTerm } from "@pv-core/db";

export interface DictionaryRow {
  id: string;
  type: "MedDRA" | "WHODrug";
  version: string;
  terms_count: number;
  is_demo_subset: boolean;
  source_sha256: string | null;
  created_at: string;
  is_default: boolean;
}

export async function listDictionaries(sql: Sql): Promise<DictionaryRow[]> {
  return (await sql`
    SELECT d.id, d.type, d.version, d.terms_count, d.is_demo_subset, d.source_sha256, d.created_at,
      (d.id::text = (SELECT value FROM app_meta WHERE key = 'meddra_default_dictionary_id')) AS is_default
    FROM dictionary d ORDER BY d.created_at DESC`) as unknown as DictionaryRow[];
}

export interface TermRow {
  code: string;
  term: string;
  pt_code: string;
  pt_term: string;
  hlt_term: string | null;
  hlgt_term: string | null;
  soc_code: string;
  soc_term: string;
  is_current: boolean;
}

/** Substring/trigram search over LLTs; exact normalized matches sort first. */
export async function searchTerms(
  sql: Sql,
  dictionaryId: string,
  q: string,
  limit = 25,
): Promise<TermRow[]> {
  const needle = normalizeTerm(q);
  if (!needle) return [];
  return (await sql`
    SELECT code, term, pt_code, pt_term, hlt_term, hlgt_term, soc_code, soc_term, is_current
    FROM dictionary_term
    WHERE dictionary_id = ${dictionaryId} AND normalized_term LIKE ${`%${needle}%`}
    ORDER BY (normalized_term = ${needle}) DESC, (normalized_term LIKE ${`${needle}%`}) DESC, length(term), term
    LIMIT ${limit}`) as unknown as TermRow[];
}

/** Verbatim import of a licensed release (ADR-0005); never from memory. */
export async function importDictionary(
  db: Db,
  input: { version: string; dir: string; loadedBy?: string },
): Promise<MeddraImportResult> {
  return importMeddra(db, {
    version: input.version,
    dir: input.dir,
    loadedBy: input.loadedBy,
    actorLabel: "import-meddra",
  });
}
