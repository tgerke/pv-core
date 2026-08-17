# Generated assets

Everything under `screenshots/` and `generated/` is written by `pnpm docs:screenshots`
(`tools/screenshots.mjs`) against a freshly seeded dev stack (ADR-0018). Do not hand-edit,
hand-capture, or rename files here: regenerate them after `pnpm db:seed` whenever a
pictured screen changes, and commit the new files together with the pages that embed them.
`screenshots/manifest.json` records the persona, route, and intent of every capture.
