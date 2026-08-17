// Regenerates the screenshots and generated artifacts embedded in the docs site
// (site/src/assets/screenshots/, site/src/assets/generated/) from a freshly
// seeded dev stack (ADR-0018). Drives headless Chrome over the DevTools
// protocol; needs nothing beyond Node 22 (fetch, WebSocket) and Chrome.
//
//   pnpm db:seed && pnpm dev            # fresh demo state, API :8789 + web :5176
//   pnpm docs:screenshots               # this script, in another terminal
//
// Env: WEB, API, CHROME (paths/origins), FORMAT=webp|png (default webp),
// ONLY=<regex over group names> to regenerate a subset (e.g. ONLY=case-6).
//
// The script refuses to run unless the API is in dev auth mode and the database
// is exactly the seed (a `pnpm test` run adds fixture studies, cases, and
// dictionaries that would show up in the pictures). It never mutates anything:
// dialogs are opened but not confirmed, forms are typed into but not submitted,
// and every non-GET request from the browser is blocked at the network layer
// and counted as a failure. Entities are looked up from the live API at
// runtime because seeding regenerates every UUID.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB ?? "http://localhost:5176";
const API = process.env.API ?? "http://localhost:8789";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FORMAT = process.env.FORMAT === "png" ? "png" : "webp";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const TOKENS = {
  admin: "dev-admin-token",
  processor: "dev-processor-token",
  reviewer: "dev-reviewer-token",
  readonly: "dev-readonly-token",
  ingest: "dev-ingest-token",
};
const SEEDED_STUDIES = ["CORC-2201", "CORC-2202", "CORC-9999", "NLB-301"];
const SEEDED_CASES = [
  ...Array.from({ length: 11 }, (_, i) => `US-CORC-2026-${String(i + 1).padStart(4, "0")}`),
  "US-NLB-2026-0001",
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "site", "src", "assets", "screenshots");
const GENERATED = join(ROOT, "site", "src", "assets", "generated");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(GENERATED, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  throw new Error(`${msg}\nRun \`pnpm db:seed\` first: a fresh seed is the only supported input.`);
};

// --- guards and subject lookup (API only) ---------------------------------

const api = async (path, { token = TOKENS.admin, raw = false } = {}) => {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return raw ? res : res.json();
};

const health = await api("/health");
if (health.auth_mode !== "dev") fail(`API auth_mode is ${health.auth_mode}; screenshots need dev`);
const webIndex = await fetch(`${WEB}/`).then((r) => r.text());
if (!webIndex.includes("<title>pv-core</title>")) fail(`${WEB} does not look like the web app`);

const studies = await api("/studies");
const protocols = studies.map((s) => s.protocol_number).sort();
if (JSON.stringify(protocols) !== JSON.stringify(SEEDED_STUDIES))
  fail(
    `studies are ${protocols.join(", ")}; expected exactly the seeded ${SEEDED_STUDIES.join(", ")}`,
  );
const fixtureStudy = studies.find((s) => s.protocol_number === "CORC-9999");
if (Number(fixtureStudy.case_count) !== 0)
  fail(`CORC-9999 has ${fixtureStudy.case_count} cases (test fixtures)`);
const dictionaries = await api("/dictionaries");
if (dictionaries.length !== 1 || !dictionaries[0].is_demo_subset)
  fail(
    `expected one demo-subset dictionary, found ${dictionaries.map((d) => d.version).join(", ")}`,
  );

const queue = await api("/queue");
const seen = queue.map((r) => r.sender_case_id).sort();
if (JSON.stringify(seen) !== JSON.stringify([...SEEDED_CASES].sort()))
  fail(`queue holds ${queue.length} cases (${seen.join(", ")}); expected the twelve seeded ones`);

const cases = {};
for (const row of queue) cases[row.sender_case_id] = await api(`/cases/${row.case_id}`);
const c = (n) => cases[`US-CORC-2026-${String(n).padStart(4, "0")}`];
const versionOf = (detail, number) => detail.versions.find((v) => v.version_number === number);
const expect = (cond, what) => {
  if (!cond) fail(`seed drift: ${what}`);
};
expect(
  c(1).state === "approved" && versionOf(c(1), 1).signatures.length === 2,
  "case 1 approved with two signatures",
);
expect(
  c(2).state === "medical_review" && !versionOf(c(2), 1).is_locked,
  "case 2 in medical review, unlocked",
);
expect(c(4).obligations.length === 0, "case 4 has no obligations");
expect(
  c(5).state === "data_entry" &&
    !versionOf(c(5), 1).assessments.some((a) => a.assessor === "sponsor"),
  "case 5 in data entry with no sponsor causality assessment",
);
expect(
  c(6).versions.length === 2 && versionOf(c(6), 1).is_locked,
  "case 6 has a locked v1 and a v2",
);
expect(c(7).is_nullified, "case 7 nullified");
expect(c(8).unblinding?.arm_role === "placebo", "case 8 unblinded to placebo");
expect(versionOf(c(9), 1).missing.includes("identifiable reporter"), "case 9 missing its reporter");
expect(
  c(10).state === "medical_review" &&
    versionOf(c(10), 1).events.some((e) => e.anticipated) &&
    versionOf(c(10), 1).rule_matches.some((m) => m.excluded_reason === "anticipated"),
  "case 10 designated anticipated with the FDA rule held back",
);
expect(
  c(11).state === "medical_review" &&
    versionOf(c(11), 1).events.some((e) => e.causality_disagreement),
  "case 11 investigator/sponsor causality disagreement",
);
const approvedVersion = c(1).versions.find((v) =>
  v.signatures.some((s) => s.meaning === "approval"),
);
expect(approvedVersion, "case 1 has an approved version");
const corc2201 = studies.find((s) => s.protocol_number === "CORC-2201");

console.log("seed verified: 12 cases, 4 studies, 1 demo dictionary");

// --- generated artifacts (API only) ---------------------------------------

const manifest = {};
const generated = new Set();
function writeGenerated(name, data, source) {
  writeFileSync(join(GENERATED, name), data);
  generated.add(name);
  manifest[`generated/${name}`] = { source };
  console.log("wrote", `generated/${name}`);
}

const digest = await api(`/studies/${corc2201.id}/digest`);
writeGenerated(
  "digest-CORC-2201.txt",
  `${digest.text.trimEnd()}\n`,
  `GET /studies/{CORC-2201}/digest`,
);
const e2b = await api(`/case-versions/${approvedVersion.id}/e2b.json`);
writeGenerated(
  "e2b-US-CORC-2026-0001.json",
  `${JSON.stringify(e2b, null, 2)}\n`,
  `GET /case-versions/{US-CORC-2026-0001 v1}/e2b.json`,
);

// Page 1 of the CIOMS I and Form FDA 3500A renderings, rasterized with poppler
// (pdftoppm) or, failing that, macOS sips. Neither present → warn and skip.
const which = (bin) => {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const pdftoppm =
  ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"].find((p) => existsSync(p)) ??
  which("pdftoppm");
const sips = existsSync("/usr/bin/sips") ? "/usr/bin/sips" : null;
const scratch = mkdtempSync(join(tmpdir(), "pv-docs-shots-"));
async function rasterize(route, name) {
  const res = await api(`/case-versions/${approvedVersion.id}/${route}`, { raw: true });
  const pdf = join(scratch, `${name}.pdf`);
  writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
  const out = join(GENERATED, `${name}.png`);
  let ok = false;
  if (pdftoppm) {
    const prefix = join(scratch, name);
    const args = ["-f", "1", "-l", "1", "-r", "176", "-png", "-singlefile", pdf, prefix];
    const r = spawnSync(pdftoppm, args);
    ok = r.status === 0 && existsSync(`${prefix}.png`);
    if (ok) writeFileSync(out, readFileSync(`${prefix}.png`));
  }
  if (!ok && sips) {
    const r = spawnSync(sips, [
      "-s",
      "format",
      "png",
      "--resampleWidth",
      "1500",
      pdf,
      "--out",
      out,
    ]);
    ok = r.status === 0 && existsSync(out);
  }
  if (!ok) {
    console.warn(`no PDF rasterizer (pdftoppm or sips) worked; skipping ${name}.png`);
    return;
  }
  generated.add(`${name}.png`);
  manifest[`generated/${name}.png`] = {
    source: `GET /case-versions/{US-CORC-2026-0001 v1}/${route}, page 1`,
  };
  console.log("wrote", `generated/${name}.png`);
}
await rasterize("cioms1.pdf", "cioms1-US-CORC-2026-0001");
await rasterize("medwatch-3500a.pdf", "medwatch-3500a-US-CORC-2026-0001");

// --- Chrome + DevTools plumbing ------------------------------------------

const profile = mkdtempSync(join(tmpdir(), "pv-docs-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  "--window-size=1440,900",
  "--lang=en-US",
]);
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on("exit", () => reject(new Error(`chrome exited\n${buf}`)));
  setTimeout(() => reject(new Error(`no devtools url\n${buf}`)), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let msgId = 0;
const pending = new Map();
const blocked = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === "Fetch.requestPaused") {
    const { requestId, request } = msg.params;
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      send("Fetch.continueRequest", { requestId }, msg.sessionId).catch(() => {});
    } else {
      blocked.push(`${request.method} ${request.url}`);
      send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, msg.sessionId).catch(
        () => {},
      );
    }
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false };
await page("Page.enable");
await page("Runtime.enable");
await page("Emulation.setDeviceMetricsOverride", VIEWPORT);
await page("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: "light" }],
});
// The mutation fuse: writes never leave the browser.
await page("Fetch.enable", {
  patterns: [
    { urlPattern: `${WEB}/api/*`, requestStage: "Request" },
    { urlPattern: `${API}/*`, requestStage: "Request" },
  ],
});

// Runs before the app boots on every document: light theme, no stray tabs,
// and the DOM helpers the shot list is written against.
await page("Page.addScriptToEvaluateOnNewDocument", {
  source: `
try { if (!localStorage.getItem("pv_theme")) localStorage.setItem("pv_theme", "light"); } catch {}
window.open = () => null;
window.__shots = {
  text: (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim(),
  cards: () => [...document.querySelectorAll("section.card")],
  card(title) {
    return this.cards().find((s) => this.text(s.querySelector("h2")).startsWith(title)) ?? null;
  },
  tabsCard: () => document.querySelector('[role="tablist"]')?.closest("section.card") ?? null,
  tab(label) {
    const tabs = [...document.querySelectorAll('button[role="tab"]')];
    return tabs.find((b) => this.text(b).startsWith(label)) ?? null;
  },
  buttons(root, label) {
    return [...(root ?? document).querySelectorAll("button")].filter((b) => this.text(b) === label);
  },
  button(root, label) { return this.buttons(root, label)[0] ?? null; },
  field(root, label) {
    const lab = [...(root ?? document).querySelectorAll("label")].find((l) => {
      const span = l.querySelector(":scope > span");
      return span && (span.firstChild?.textContent ?? "").trim() === label;
    });
    return lab ? lab.querySelector("input, select, textarea") : null;
  },
  checkbox(root, labelPrefix) {
    const lab = [...(root ?? document).querySelectorAll("label")].find(
      (l) => l.querySelector('input[type="checkbox"]') && this.text(l).startsWith(labelPrefix),
    );
    return lab ? lab.querySelector('input[type="checkbox"]') : null;
  },
  setInput(el, text) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  setSelect(el, optionPrefix) {
    const opt = [...el.options].find((o) => o.textContent.trim().startsWith(optionPrefix));
    if (!opt) throw new Error("no option starting with " + optionPrefix);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, opt.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  },
  rect(el, pad = 8) {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left + scrollX - pad), y: Math.max(0, r.top + scrollY - pad),
             width: r.width + 2 * pad, height: r.height + 2 * pad };
  },
  union(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
             height: Math.max(a.y + a.height, b.y + b.height) - y };
  },
  loaded() {
    const t = document.body.innerText;
    return (t.includes("audit chain") || t.includes("chain unavailable")) && !/Loading [^\\n]*…/.test(t);
  },
  has: (t) => document.body.innerText.includes(t),
  dialog: () => document.querySelector('[role="dialog"]'),
  escape: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  must(x, what) { if (!x) throw new Error("not found: " + what + " at " + location.pathname + location.search); return x; },
};
`,
});

async function evaluate(expression) {
  const { result, exceptionDetails } = await page("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails)
    throw new Error(exceptionDetails.exception?.description ?? JSON.stringify(exceptionDetails));
  return result.value;
}
// Shorthand for expressions that use the helpers.
const S = (expr) => evaluate(`(() => { const S = window.__shots; return (${expr}); })()`);

async function waitFor(expr, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await S(expr).catch(() => false);
    if (ok) return;
    await sleep(150);
  }
  throw new Error(
    `timed out waiting for ${what} (seed drift or a UI change? re-seed, then update tools/screenshots.mjs)`,
  );
}

let currentUrl = "";
async function navigate(url, ready = "S.loaded()", { timeout = 25000, settle = 450 } = {}) {
  await evaluate("window.__stale = true; true").catch(() => {});
  await page("Page.navigate", { url });
  await waitFor(`!window.__stale && document.readyState === "complete"`, `load of ${url}`, timeout);
  await waitFor(ready, `${url} to be ready`, timeout);
  await sleep(settle);
  currentUrl = url;
}

async function setPersona(token) {
  await evaluate(`localStorage.setItem("pv_token", ${JSON.stringify(token)}); true`);
}

const shots = new Set();
async function capture(name, { clip, beyond = false, persona = "admin", kind, note }) {
  const file = `${name}.${FORMAT}`;
  const { data } = await page("Page.captureScreenshot", {
    format: FORMAT,
    ...(FORMAT === "webp" ? { quality: 90 } : {}),
    captureBeyondViewport: beyond,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  if (beyond) await page("Emulation.setDeviceMetricsOverride", VIEWPORT);
  writeFileSync(join(SHOTS, file), Buffer.from(data, "base64"));
  shots.add(file);
  manifest[file] = {
    persona,
    url: currentUrl.replace(WEB, "").replace(API, "<api>") || "/",
    kind,
    note,
  };
  console.log("saved", file);
}

const shoot = (name, meta) => capture(name, { kind: "page", ...meta });
async function shootClip(name, rectExpr, meta) {
  const rect = await S(rectExpr);
  await capture(name, {
    clip: { ...rect, height: Math.min(rect.height, 1600) },
    beyond: true,
    kind: "section",
    ...meta,
  });
}
const shootCard = (name, title, meta) =>
  shootClip(name, `S.rect(S.must(S.card(${JSON.stringify(title)}), "card ${title}"))`, meta);
async function shootDialog(name, meta) {
  await waitFor(`!!S.dialog()`, "a dialog");
  await sleep(250);
  const rect = await S(`S.rect(S.dialog(), 16)`);
  const needed = Math.ceil(rect.y + rect.height + 24);
  if (needed > VIEWPORT.height)
    await page("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, height: needed });
  const r = await S(`S.rect(S.dialog(), 16)`);
  await capture(name, { clip: r, kind: "dialog", ...meta });
  await page("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await S(`S.escape()`);
  await waitFor(`!S.dialog()`, "the dialog to close");
}
async function clickTab(label) {
  await S(`(S.must(S.tab(${JSON.stringify(label)}), "tab ${label}").click(), true)`);
  await waitFor(
    `S.tab(${JSON.stringify(label)})?.getAttribute("aria-selected") === "true"`,
    `tab ${label}`,
  );
  await sleep(200);
}

async function group(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  console.log(`▸ ${name}`);
  await fn();
}

const caseUrl = (n) => `${WEB}/cases/${c(n).id}`;
const rowsIn = (title) =>
  `S.must(S.card(${JSON.stringify(title)}), "card").querySelectorAll("tbody tr").length`;

// --- the shot list --------------------------------------------------------

try {
  // Warm-up: the first Vite load compiles the app and may reload once.
  await navigate(`${WEB}/`, "true", { timeout: 60000, settle: 800 });
  await setPersona(TOKENS.admin);

  await group("queue", async () => {
    await navigate(`${WEB}/`, `S.loaded() && ${rowsIn("Cases")} === 12`);
    await shoot("queue", { note: "the case queue, all studies, admin" });
    await shootCard("submission-compliance", "Submission compliance", {
      note: "on-time metrics per study and destination",
    });
    await navigate(`${WEB}/?state=medical_review`, `S.loaded() && ${rowsIn("Cases")} >= 2`);
    await shoot("queue-filter-medical-review", { note: "the queue filtered to medical review" });

    for (const [who, token, ready] of [
      ["processor", TOKENS.processor, `${rowsIn("Cases")} === 11`],
      ["reviewer", TOKENS.reviewer, `${rowsIn("Cases")} === 11`],
      [
        "readonly",
        TOKENS.readonly,
        `${rowsIn("Cases")} === 12 && !document.querySelector('a[href="/cases/new"]')`,
      ],
    ]) {
      await setPersona(token);
      await navigate(`${WEB}/`, `S.loaded() && ${ready}`);
      await shoot(`queue-${who}`, { persona: who, note: `the queue as the ${who} persona` });
    }
    await setPersona(TOKENS.ingest);
    await navigate(`${WEB}/`, `S.has("cannot read anything back")`);
    await shoot("queue-ingest", { persona: "ingest", note: "the enter-only intake identity" });
    await setPersona(TOKENS.admin);
  });

  await group("newcase", async () => {
    await navigate(
      `${WEB}/cases/new`,
      `S.loaded() && S.field(S.card("Receipt"), "Study")?.options.length >= 5`,
    );
    await shoot("new-case-empty", { note: "the empty new-case form with the Valid ICSR rail" });
    await S(`(S.setSelect(S.field(S.card("Receipt"), "Study"), "CORC-2201"), true)`);
    await waitFor(
      `S.field(S.card("Receipt"), "Product")?.options.length >= 2`,
      "products for CORC-2201",
    );
    await S(`(S.setInput(S.field(S.card("Patient"), "Initials"), "TS"), true)`);
    await S(`(S.setInput(S.field(S.card("Patient"), "Subject number"), "2201-002-031"), true)`);
    await S(
      `(S.setInput(S.field(S.card("Events"), "Reported term"), "Febrile neutropenia, grade 3"), true)`,
    );
    await waitFor(
      `S.has("Below the minimum criteria") && !!S.button(document, "Save as intake")`,
      "the intake state",
    );
    await sleep(300);
    await shoot("new-case-partial", { note: "two of four criteria met: Save as intake" });
    await S(`(S.setInput(S.field(S.card("Reporters"), "Family name"), "Brooks"), true)`);
    await S(`(S.setSelect(S.field(S.card("Reporters"), "Qualification"), "physician"), true)`);
    await S(`(S.setSelect(S.field(S.card("Drugs"), "Study product"), "CORC-101"), true)`);
    await S(`(S.must(S.checkbox(S.card("Drugs"), "Blinded"), "blinded checkbox").click(), true)`);
    await waitFor(
      `S.has("Meets the E2B(R3)") && !!S.button(document, "Create case")`,
      "the valid state",
    );
    await sleep(300);
    await shoot("new-case-valid", { note: "all four criteria met: Create case (never clicked)" });
  });

  await group("case-1", async () => {
    await navigate(
      caseUrl(1),
      `S.loaded() && S.has("US-CORC-2026-0001") && S.cards().length >= 8 && !S.has("Loading audit trail")`,
    );
    await shoot("case-1-approved", { note: "approved, locked, 7-day clocks due in three days" });
    await shootCard("attachments-card", "Attachments", {
      note: "content-addressed source documents",
    });
    await shootCard("signatures-card", "Signatures", {
      note: "medical review and approval, hash matches",
    });
    await clickTab("Patient");
    await shootClip("patient-tab", `S.rect(S.tabsCard())`, { note: "the Patient section" });
    await clickTab("Drugs");
    await shootClip("drugs-tab", `S.rect(S.tabsCard())`, {
      note: "the Drugs section, study product marked blinded",
    });
    await clickTab("Assessments");
    await waitFor(`S.tabsCard().querySelectorAll("tbody tr").length >= 2`, "assessment rows");
    await shootClip("assessments-tab", `S.rect(S.tabsCard())`, {
      note: "the drug × event × assessor grid",
    });
    await S(`(() => {
      const c = S.must(S.card("Audit trail"), "audit card");
      const li = [...c.querySelectorAll("li")].find((l) => S.text(l).includes("case transition")) ?? c;
      const d = S.must(li.querySelector("details"), "audit details");
      d.open = true;
      return true;
    })()`);
    await waitFor(`!!S.card("Audit trail").querySelector("details[open] table")`, "the audit diff");
    await shootCard("audit-trail-card", "Audit trail", {
      note: "hash-chained rows, one 'what changed' expanded",
    });
    await S(`(S.must(S.button(document, "Open follow-up"), "Open follow-up").click(), true)`);
    await shootDialog("dialog-open-follow-up", { note: "the follow-up dialog, never confirmed" });
    await S(
      `(S.must(S.buttons(S.card("Obligations"), "Record submission").find((b) => !b.disabled), "an enabled Record submission").click(), true)`,
    );
    await waitFor(
      `S.text(S.dialog()?.querySelector("h2")).startsWith("Record submission of v1")`,
      "the submission dialog",
    );
    await shootDialog("dialog-record-submission", {
      note: "destination, kind, format; never confirmed",
    });
  });

  await group("case-2", async () => {
    await navigate(caseUrl(2), `S.loaded() && S.has("US-CORC-2026-0002") && S.cards().length >= 8`);
    await shoot("case-2-medical-review", { note: "medical review, 15-day clocks overdue" });
    await shootClip("events-tab", `S.rect(S.tabsCard())`, {
      note: "coded event with seriousness, expectedness, causality",
    });
    await shootCard("obligations-card", "Obligations", { note: "three overdue obligations" });
    await shootCard("rule-matches-card", "Rule matches", { note: "why each rule applies" });
    await S(`(S.must(S.button(document, "Record unblinding"), "Record unblinding").click(), true)`);
    await shootDialog("dialog-record-unblinding", {
      note: "the unblinding fact dialog, never confirmed",
    });
  });

  await group("case-2-reviewer", async () => {
    await setPersona(TOKENS.reviewer);
    await navigate(caseUrl(2), `S.loaded() && !!S.button(document, "Sign medical review")`);
    await S(`(S.button(document, "Sign medical review").click(), true)`);
    await waitFor(`S.has("Re-authenticate to sign.")`, "the sign dialog");
    await shootDialog("dialog-sign-medical-review", {
      persona: "reviewer",
      note: "signing asks for re-authentication; never confirmed",
    });
    await setPersona(TOKENS.admin);
  });

  await group("case-9", async () => {
    await navigate(caseUrl(9), `S.loaded() && S.has("Missing: identifiable reporter")`);
    await shoot("case-9-intake", {
      note: "an intake item from the EDC, below the minimum criteria",
    });
  });

  await group("case-6", async () => {
    await navigate(caseUrl(6), `S.loaded() && S.has("2 versions") && S.cards().length >= 8`);
    await shoot("case-6-follow-up-v2", { note: "v2 follow-up open, v1 locked and submitted" });
    await shootCard("version-card", "Version", { note: "version toggles and the E2B JSON export" });
    await shootCard("submissions-card", "Submissions", {
      note: "three submissions of v1, one acknowledged",
    });
    await S(`(() => {
      const li = S.must([...S.card("Submissions").querySelectorAll("li")].find((l) => S.text(l).includes("EudraVigilance")), "EudraVigilance submission");
      S.must(S.button(li, "record acknowledgement"), "record acknowledgement").click();
      return true;
    })()`);
    await waitFor(`!!S.field(S.card("Submissions"), "Ack code")`, "the acknowledgement form");
    await shootCard("submissions-record-ack", "Submissions", {
      note: "recording an acknowledgement, never saved",
    });
    await S(`(S.must(S.button(S.card("Submissions"), "Cancel"), "Cancel").click(), true)`);
    await S(
      `(S.must([...S.card("Version").querySelectorAll("button[aria-pressed]")].find((b) => S.text(b).startsWith("v1")), "v1 toggle").click(), true)`,
    );
    await waitFor(`S.has("Locked by signature")`, "v1 selected");
    await sleep(300);
    await shootCard("version-card-v1", "Version", { note: "the locked initial version" });
  });

  await group("case-7", async () => {
    await navigate(
      caseUrl(7),
      `S.loaded() && S.has("Nullified: no further changes are accepted.")`,
    );
    await shoot("case-7-nullified", { note: "a nullified duplicate" });
  });

  await group("case-8", async () => {
    await navigate(caseUrl(8), `S.loaded() && S.has("Placebo") && S.cards().length >= 8`);
    await shoot("case-8-waived-placebo", { note: "unblinded to placebo, obligations waived" });
    await shootCard("facts-card", "Facts", {
      note: "the unblinding fact with its source reference",
    });
  });

  await group("case-4", async () => {
    await navigate(caseUrl(4), `S.loaded() && S.has("No reporting obligation applies.")`);
    await shoot("case-4-serious-expected", { note: "serious but expected: no clock" });
  });

  await group("case-5", async () => {
    await navigate(
      caseUrl(5),
      `S.loaded() && S.has("sponsor: unassessed") && S.cards().length >= 8`,
    );
    await shoot("case-5-data-entry", {
      note: "data entry, non-serious, sponsor causality unassessed",
    });
    await S(`(S.must(S.button(document, "Nullify"), "Nullify").click(), true)`);
    await shootDialog("dialog-nullify", { note: "the nullification dialog, never confirmed" });
    await S(`(S.must(S.button(S.tabsCard(), "Edit"), "Edit").click(), true)`);
    await waitFor(`!!S.button(S.tabsCard(), "Add event")`, "the events editor");
    await S(`(S.button(S.tabsCard(), "Add event").click(), true)`);
    await waitFor(
      `!![...S.tabsCard().querySelectorAll("div.rounded-md.border")].find((d) => S.text(d).startsWith("Event 2"))`,
      "a second event row",
    );
    await S(`(() => {
      const row = [...S.tabsCard().querySelectorAll("div.rounded-md.border")].find((d) => S.text(d).startsWith("Event 2"));
      S.setInput(S.must(S.field(row, "Reported term"), "Reported term"), "Neutrophil count decreased, grade 3");
      S.setInput(S.must(row.querySelector('input[aria-label="Search dictionary terms"]'), "term search"), "neut");
      return true;
    })()`);
    await waitFor(
      `(() => {
      const row = [...S.tabsCard().querySelectorAll("div.rounded-md.border")].find((d) => S.text(d).startsWith("Event 2"));
      return !!row.querySelector("ul li button") && !S.has("Searching…");
    })()`,
      "dictionary matches",
    );
    await sleep(200);
    await shootClip(
      "events-tab-editing-typeahead",
      `(() => {
        const t = S.tabsCard();
        const row = [...t.querySelectorAll("div.rounded-md.border")].find((d) => S.text(d).startsWith("Event 2"));
        const ul = [...row.querySelectorAll("ul")].find((u) => u.querySelector("li button"));
        return S.union(S.rect(t), S.rect(ul));
      })()`,
      { note: "editing an event: the MedDRA typeahead over the loaded dictionary" },
    );
    await S(`(S.must(S.button(S.tabsCard(), "Cancel"), "Cancel").click(), true)`);
  });

  await group("case-10", async () => {
    await navigate(
      caseUrl(10),
      `S.loaded() && S.has("US-CORC-2026-0010") && S.has("held back") && S.cards().length >= 8`,
    );
    await shoot("case-10-anticipated", {
      note: "an anticipated SAE: the FDA IND rule held back, the EU clock still running",
    });
    await shootCard("rule-matches-anticipated", "Rule matches", {
      note: "the FDA rule held back by the sponsor's designation, with the concept named",
    });
    await clickTab("Events");
    await waitFor(
      `S.has("Sponsor designation: anticipated in the study population")`,
      "the events tab with the designation",
    );
    await shootClip("events-tab-anticipated", "S.rect(S.tabsCard())", {
      note: "the event verdict with the anticipated designation and the concept from the plan",
    });
  });

  await group("case-11", async () => {
    await navigate(
      caseUrl(11),
      `S.loaded() && S.has("US-CORC-2026-0011") && S.cards().length >= 8`,
    );
    await clickTab("Assessments");
    await waitFor(
      `S.has("Investigator and sponsor differ on causality")`,
      "the assessments tab with the disagreement",
    );
    await shoot("case-11-disagreement", {
      note: "investigator related, sponsor not related: both opinions kept, the EU clock owed, the FDA rule not",
    });
    await shootClip("assessments-tab-disagreement", "S.rect(S.tabsCard())", {
      note: "the assessments grid with both opinions and the disagreement notice",
    });
  });

  await group("reporting", async () => {
    await navigate(`${WEB}/reporting`, `S.loaded() && ${rowsIn("Expected submissions")} >= 1`);
    await shoot("reporting", { note: "expected submissions across studies, grouped by due date" });
    // Rows include one date-band row per due date, so three obligations render four rows.
    await navigate(
      `${WEB}/reporting?status=overdue`,
      `S.loaded() && ${rowsIn("Expected submissions")} >= 3 && !!document.querySelector('[aria-pressed="true"]')`,
    );
    await shoot("reporting-overdue", { note: "the reporting page filtered to overdue" });
  });

  await group("dsur", async () => {
    await navigate(
      `${WEB}/dsur`,
      `S.loaded() && ${rowsIn("Serious adverse reactions")} >= 1 && ${rowsIn("Cumulative SAE summary")} >= 1`,
    );
    await shoot("dsur", { note: "the DSUR page" });
    await shootCard("dsur-sae-summary", "Cumulative SAE summary", {
      note: "SAE tabulation by SOC and arm",
    });
    // The line listing is 100rem wide inside a 7xl main; widen the page for this one clip.
    await page("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, width: 1960 });
    await evaluate(`document.querySelector("main").style.maxWidth = "none"; true`);
    await sleep(400);
    await shootCard("dsur-sar-line-listing", "Serious adverse reactions", {
      note: "the E2F line listing",
    });
    await evaluate(`document.querySelector("main").style.maxWidth = ""; true`);
    await page("Emulation.setDeviceMetricsOverride", VIEWPORT);
  });

  await group("admin", async () => {
    await navigate(`${WEB}/admin`, `S.loaded() && S.has("Administration") && S.has("CORC-2201")`);
    const tabs = [
      ["Studies", "admin-studies"],
      ["Sites", "admin-sites"],
      ["Products & RSI", "admin-products-rsi"],
      ["Anticipated events", "admin-anticipated-events"],
      ["Destinations", "admin-destinations"],
      ["Reporting rules", "admin-reporting-rules"],
      ["People & grants", "admin-people-grants"],
      ["Dictionaries", "admin-dictionaries"],
    ];
    for (const [label, name] of tabs) {
      await clickTab(label);
      await waitFor(`S.loaded()`, `${label} loaded`);
      await sleep(250);
      await shootClip(name, "S.rect(S.tabsCard())", { note: `Admin › ${label}` });
    }
  });

  await group("audit", async () => {
    await navigate(
      `${WEB}/audit`,
      `S.loaded() && S.has("verified") && ${rowsIn("Signature integrity")} >= 1 && S.card("Recent events")?.querySelectorAll("li").length >= 1`,
    );
    await shoot("audit", { note: "chain verification, signature integrity, recent events" });
  });

  await group("api-docs", async () => {
    // Scalar loads from a CDN; without network this shot is skipped, not failed.
    try {
      await navigate(
        `${API}/docs`,
        `document.body.innerText.includes("Case queue across every study")`,
        {
          timeout: 25000,
          settle: 1500,
        },
      );
      await shoot("api-docs", { persona: "n/a", note: "the interactive API reference" });
    } catch (e) {
      console.warn(`skipping api-docs: ${e.message.split("\n")[0]}`);
    }
  });
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([exited, sleep(3000)]);
  for (const dir of [profile, scratch]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      console.warn(`could not remove ${dir}: ${e.message}`);
    }
  }
}

// --- manifest, stale files, and the fuse ---------------------------------

if (!ONLY) {
  for (const f of readdirSync(SHOTS)) {
    if (f !== "manifest.json" && !shots.has(f))
      console.warn(`stale (not produced by this run): screenshots/${f}`);
  }
  for (const f of readdirSync(GENERATED)) {
    if (!generated.has(f)) console.warn(`stale (not produced by this run): generated/${f}`);
  }
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(join(SHOTS, "manifest.json"), `${JSON.stringify(sorted, null, 2)}\n`);
}

if (blocked.length > 0) {
  console.error(
    `the browser attempted ${blocked.length} write(s), which were blocked:\n  ${blocked.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(
  `done: ${shots.size} screenshots, ${generated.size} generated files, 0 blocked writes → site/src/assets/`,
);
