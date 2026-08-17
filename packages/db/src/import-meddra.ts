// Loads a licensed MedDRA release verbatim from its ASCII distribution
// directory (ADR-0005). Never vendored; never generated.
//
//   pnpm db:import-meddra -- --version 27.1 --dir /path/to/MedDRA/ascii-27.1
import { parseArgs } from "node:util";
import { createDb } from "./client.js";
import { importMeddra } from "./meddra.js";

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    dir: { type: "string" },
  },
});

if (!values.version || !values.dir) {
  console.error("usage: db:import-meddra -- --version <release> --dir <MedDRA ascii dir>");
  process.exit(1);
}

const { db, sql } = createDb();
try {
  const r = await importMeddra(db, { version: values.version, dir: values.dir });
  console.log(
    r.skipped
      ? `MedDRA ${r.version} already loaded (${r.termsCount} terms, id ${r.dictionaryId}); nothing changed`
      : `loaded MedDRA ${r.version}: ${r.termsCount} terms (id ${r.dictionaryId}, source sha256 ${r.sourceSha256})`,
  );
} finally {
  await sql.end();
}
