import clsx from "clsx";
import { LogOut, Moon, ShieldAlert, ShieldCheck, ShieldX, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { can, useChainStatus, useMe, useStudies } from "./api";
import { authMode, DEFAULT_DEV_TOKEN, setDevToken, signOut, token } from "./auth";
import Admin from "./pages/Admin";
import Audit from "./pages/Audit";
import CasePage from "./pages/CasePage";
import Dashboard from "./pages/Dashboard";
import Dsur from "./pages/Dsur";
import NewCase from "./pages/NewCase";
import Reporting from "./pages/Reporting";
import { Notice } from "./ui";

function useTheme() {
  const [dark, setDark] = useState(
    () =>
      localStorage.getItem("pv_theme") === "dark" ||
      (localStorage.getItem("pv_theme") === null &&
        window.matchMedia("(prefers-color-scheme: dark)").matches),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("pv_theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

// Dev-mode persona switcher: the seeded tokens are the demo's seats. Rendered
// only when the API runs with static dev tokens.
const DEV_PERSONAS: { token: string; label: string }[] = [
  { token: "dev-admin-token", label: "Dana Whitfield · admin" },
  { token: "dev-processor-token", label: "Marcus Lee · case processor" },
  { token: "dev-reviewer-token", label: "Priya Raman MD · medical reviewer" },
  { token: "dev-readonly-token", label: "Sam Okafor · auditor (read-only)" },
  { token: "dev-ingest-token", label: "EDC intake · service" },
];

function DevPersonaSwitcher() {
  const { data: me } = useMe();
  if (authMode !== "dev") return null;
  const current = token() ?? DEFAULT_DEV_TOKEN;
  return (
    <span
      className="hidden items-center gap-1.5 md:inline-flex"
      title={me ? `Signed in as ${me.label} (dev-mode persona)` : "Dev-mode persona"}
    >
      <UserRound size={13} className="text-muted" aria-hidden />
      <select
        value={DEV_PERSONAS.some((p) => p.token === current) ? current : DEFAULT_DEV_TOKEN}
        onChange={(e) => setDevToken(e.target.value)}
        className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink2"
        aria-label="Switch dev persona"
      >
        {DEV_PERSONAS.map((p) => (
          <option key={p.token} value={p.token}>
            {p.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Who am I, in oidc mode: label from /me plus sign-out. */
function Identity() {
  const { data: me } = useMe();
  if (authMode !== "oidc" || !me) return null;
  return (
    <span className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-ink2 md:inline-flex">
      <UserRound size={13} className="text-muted" aria-hidden />
      <span>{me.label}</span>
      <button
        type="button"
        onClick={signOut}
        className="inline-flex items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-xs text-ink2 hover:bg-surface"
        title="Sign out"
      >
        <LogOut size={11} aria-hidden />
        Sign out
      </button>
    </span>
  );
}

function ChainBadge() {
  const { data, isError } = useChainStatus();
  if (!data && !isError) return null;
  const ok = !!data?.ok;
  const color = isError ? "var(--muted)" : ok ? "var(--status-good)" : "var(--status-critical)";
  const Icon = isError ? ShieldAlert : ok ? ShieldCheck : ShieldX;
  return (
    <Link
      to="/audit"
      className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs hover:bg-surface sm:inline-flex"
      style={{ color, borderColor: "var(--ring)" }}
      title="Live verification of the append-only audit hash chain, polled every minute. Click to browse the audit trail."
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      <Icon size={13} aria-hidden />
      <span className="text-ink2">
        {isError ? "chain unavailable" : `audit chain ${ok ? "verified" : "BROKEN"}`}
        {data && (
          <>
            {" · "}
            <span className="mono">{data.events}</span>
          </>
        )}
      </span>
    </Link>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  clsx(
    "rounded-md px-2 py-1 text-sm hover:bg-surface xl:shrink-0 xl:whitespace-nowrap",
    isActive ? "font-medium text-ink" : "text-ink2",
  );

const STUDY_KEY = "pv_study";

export default function App() {
  const { dark, toggle } = useTheme();
  const { data: me, isPending: mePending } = useMe();
  const studiesQuery = useStudies();
  const studies = studiesQuery.data;
  // The study switcher persists across visits; "" means all studies. Re-seeds
  // regenerate ids, so an unknown stored id falls back to all studies.
  const [studyId, setStudyId] = useState<string>(() => localStorage.getItem(STUDY_KEY) ?? "");
  const selectStudy = (id: string) => {
    setStudyId(id);
    localStorage.setItem(STUDY_KEY, id);
  };
  const study = studies?.find((s) => s.id === studyId);
  const noRead = !!me && !can(me, "read");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-hairline bg-page/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold">
            <ShieldCheck size={20} style={{ color: "var(--info)" }} aria-hidden />
            <span>pv-core</span>
          </Link>
          {studies && studies.length > 0 && (
            <select
              value={study?.id ?? ""}
              onChange={(e) => selectStudy(e.target.value)}
              className="hidden rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink2 sm:inline"
              aria-label="Switch study"
            >
              <option value="">All studies</option>
              {studies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.protocol_number}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <ChainBadge />
            <NavLink to="/" end className={navCls}>
              Queue
            </NavLink>
            <NavLink to="/reporting" className={navCls}>
              Reporting
            </NavLink>
            <NavLink to="/dsur" className={navCls}>
              DSUR
            </NavLink>
            <NavLink to="/admin" className={navCls}>
              Admin
            </NavLink>
            <NavLink to="/audit" className={navCls}>
              Audit
            </NavLink>
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-md px-2 py-1 text-sm text-ink2 hover:bg-surface lg:inline xl:shrink-0"
            >
              API docs
            </a>
            <Identity />
            <DevPersonaSwitcher />
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="rounded-md p-2 text-ink2 hover:bg-surface"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {noRead && (
          <Notice tone="warn" className="mb-6">
            {me?.label} can create records but cannot read anything back: a service identity pushes
            cases in and reads nothing. Switch persona to browse.
          </Notice>
        )}
        {!mePending && !me && !noRead && (
          <Notice tone="critical" className="mb-6">
            Could not load your identity from the API. Check that the API is running and the token
            is valid.
          </Notice>
        )}
        <Routes>
          <Route path="/" element={<Dashboard study={study} />} />
          <Route path="/cases/new" element={<NewCase study={study} />} />
          <Route path="/cases/:caseId" element={<CasePage />} />
          <Route path="/reporting" element={<Reporting study={study} />} />
          <Route path="/dsur" element={<Dsur study={study} />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/audit" element={<Audit />} />
        </Routes>
      </main>
    </div>
  );
}
