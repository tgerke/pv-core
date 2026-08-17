# ADR-0005: MedDRA is loaded verbatim from the licensed files; the seed is a labeled illustrative subset

**Status**: accepted · 2026-08-17

## Decision

The repository ships no MedDRA content. `pnpm db:import-meddra -- --version <v> --dir <ascii
dir>` reads `mdhier.asc` and `llt.asc` from a licensed distribution and loads every Lowest
Level Term with its primary path, recording the source hash on the `dictionary` row
(`is_demo_subset = false`). The seed creates a small dictionary of common terms for the
demo cases, marked `is_demo_subset = true` and labeled "illustrative subset, not MedDRA"
wherever it appears.

## Rationale

MedDRA is licensed by the MSSO; the term hierarchy cannot be vendored, and reproducing it
from an LLM's memory would risk hallucinated codes and paths in a regulated tool. The
same reasoning produced ctms-core's TMF Reference Model importer (its ADR-0005) and
edc-core's dictionary loader. The demo subset exists only so the seeded cases have
something to code against; its codes are synthetic and it is never presented as MedDRA.

## Consequences

Each case version pins the dictionary it was coded with (E2B(R3) IG §3.2: one MedDRA
version per ICSR). RSI listed terms pin theirs. Expectedness compares Preferred Term
codes across the two, so a sponsor recoding to a new release re-loads the release and
re-codes; nothing is edited in place. `dictionary_term` rows are not row-audited: they are
reloadable reference data, and the audited header carries counts and hash.
