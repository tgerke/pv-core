/**
 * Web auth: dev mode uses the static bearer tokens the API reads from .env;
 * oidc mode runs an OIDC authorization-code + PKCE flow against the IdP named
 * in the runtime config. Signing re-authentication (§11.200) re-runs the flow
 * in a popup with prompt=login so the IdP forces a fresh credential ceremony.
 */

// Build-time VITE_* values win; otherwise the runtime config nginx serves at
// /env.js (public/env.js in dev), so one pinned image works against any IdP.
declare global {
  interface Window {
    __PV_ENV__?: Record<string, string | undefined>;
  }
}
const conf = (viteValue: unknown, runtimeKey: string): string | undefined =>
  (viteValue as string | undefined) ||
  (typeof window === "undefined" ? undefined : window.__PV_ENV__?.[runtimeKey]) ||
  undefined;

const OIDC = conf(import.meta.env.VITE_AUTH_MODE, "AUTH_MODE") === "oidc";
const ISSUER = conf(import.meta.env.VITE_OIDC_ISSUER, "OIDC_ISSUER");
const CLIENT_ID = conf(import.meta.env.VITE_OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
const SCOPE = conf(import.meta.env.VITE_OIDC_SCOPE, "OIDC_SCOPE") ?? "openid email profile";

export const authMode = OIDC ? ("oidc" as const) : ("dev" as const);

const DEV_TOKEN_KEY = "pv_token";
const OIDC_TOKEN_KEY = "pv_oidc_token";
export const DEFAULT_DEV_TOKEN = "dev-admin-token";

export function token(): string | null {
  if (!OIDC) return localStorage.getItem(DEV_TOKEN_KEY) ?? DEFAULT_DEV_TOKEN;
  return sessionStorage.getItem(OIDC_TOKEN_KEY);
}

/** Dev-mode persona switch: store the token and reload from the root. */
export function setDevToken(t: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, t);
  window.location.assign("/");
}

// --- PKCE plumbing -----------------------------------------------------------

interface Endpoints {
  authorization_endpoint: string;
  token_endpoint: string;
}

let endpointsCache: Endpoints | null = null;
async function endpoints(): Promise<Endpoints> {
  if (endpointsCache) return endpointsCache;
  if (!ISSUER || !CLIENT_ID) {
    throw new Error("AUTH_MODE=oidc requires OIDC_ISSUER and OIDC_CLIENT_ID");
  }
  const url = new URL(
    ".well-known/openid-configuration",
    ISSUER.endsWith("/") ? ISSUER : `${ISSUER}/`,
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  endpointsCache = (await res.json()) as Endpoints;
  return endpointsCache;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

const redirectUri = () => `${window.location.origin}/`;

async function authorizeUrl(state: string, challenge: string, forceLogin: boolean) {
  const { authorization_endpoint } = await endpoints();
  const url = new URL(authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Force a fresh credential ceremony for signing re-auth.
  if (forceLogin) {
    url.searchParams.set("prompt", "login");
    url.searchParams.set("max_age", "0");
  }
  return url;
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const { token_endpoint } = await endpoints();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID!,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

// --- login (full redirect) -----------------------------------------------------

export async function beginLogin(): Promise<void> {
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(`pv_pkce_${state}`, verifier);
  sessionStorage.setItem("pv_return_to", window.location.pathname + window.location.search);
  window.location.assign(String(await authorizeUrl(state, challenge, false)));
}

/**
 * Handle an OIDC redirect landing (?code=&state=). Call once at app start,
 * before rendering. In a re-auth popup, posts the fresh token back to the
 * opener and closes; in the main window, stores the session token. No-op in
 * dev mode.
 */
export async function completeLoginFromCallback(): Promise<void> {
  if (!OIDC) return;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return;
  const verifier = sessionStorage.getItem(`pv_pkce_${state}`);
  if (!verifier) return;
  sessionStorage.removeItem(`pv_pkce_${state}`);
  const accessToken = await exchangeCode(code, verifier);

  if (window.opener) {
    (window.opener as Window).postMessage(
      { type: "pv-reauth", token: accessToken },
      window.location.origin,
    );
    window.close();
    return;
  }
  sessionStorage.setItem(OIDC_TOKEN_KEY, accessToken);
  const returnTo = sessionStorage.getItem("pv_return_to") ?? "/";
  sessionStorage.removeItem("pv_return_to");
  window.history.replaceState(null, "", returnTo);
}

/** No-op in dev mode; in oidc mode starts the login flow when there is no session. */
export async function ensureSignedIn(): Promise<void> {
  if (OIDC && !token()) await beginLogin();
}

/** Drop the session token and land on /, where ensureSignedIn restarts login. */
export function signOut(): void {
  if (!OIDC) return;
  sessionStorage.removeItem(OIDC_TOKEN_KEY);
  window.location.assign("/");
}

// --- signing re-authentication ---------------------------------------------------

/**
 * Obtain proof of re-authentication for a signature. Dev mode restates the
 * bearer token (the API's documented stub); oidc mode runs a prompt=login
 * PKCE flow in a popup and resolves with the fresh access token.
 */
export async function getReauthToken(): Promise<string> {
  if (!OIDC) return token()!;
  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(`pv_pkce_${state}`, verifier);
  const url = await authorizeUrl(state, challenge, true);
  const popup = window.open(String(url), "pv-reauth", "popup,width=480,height=640");
  if (!popup) throw new Error("re-authentication popup was blocked");
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("re-authentication timed out"));
    }, 120_000);
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; token?: string };
      if (data?.type !== "pv-reauth" || !data.token) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.token);
    }
    window.addEventListener("message", onMessage);
  });
}
