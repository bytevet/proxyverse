import { Host } from "@/adapters";
import { withLock } from "@/services/utils";
import { SYNC_BUILD } from "./buildEnv";
import { discover, syncOrigin, type Discovery } from "./config";
import {
  clearSyncAuth,
  clearSyncState,
  getSyncAuth,
  setSyncAuth,
  type SyncAuth,
} from "./state";

/**
 * Signing in to byte.vet (spec §2): OAuth 2.1 authorization code with PKCE,
 * as a public client. Sign-in runs in an extension page, since the user may
 * take minutes, longer than an idle service worker lives. Tokens are shared
 * through storage with the background, which uses and refreshes them.
 */

// without offline_access the server issues no refresh token
export const SCOPES = "openid email offline_access sync";
const REDIRECT_PATH = "oauth";
// refresh a little early, so a request never leaves with a dying token
const EXPIRY_MARGIN_MS = 60_000;

export type SyncAuthErrorCode =
  /** Not signed in, or the sign-in expired. */
  | "signed_out"
  /** The server refused the refresh token: the user must sign in again. */
  | "expired"
  /** The user closed the sign-in window or denied access. */
  | "cancelled"
  /** The redirect didn't come from our request (state mismatch). */
  | "state_mismatch"
  /** The server answered with an error or something unexpected. */
  | "server";

export class SyncAuthError extends Error {
  constructor(
    readonly code: SyncAuthErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "SyncAuthError";
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

/** The OAuth client this build signs in as, and the server's endpoints. */
async function client(): Promise<{ origin: string; endpoints: Discovery }> {
  const origin = await syncOrigin();
  return { origin, endpoints: await discover(origin) };
}

/**
 * Requests to byte.vet never send its cookies: they authenticate with the
 * code, refresh token or access token. The browser would otherwise attach
 * the session cookie of the sign-in that just happened, and byte.vet's auth
 * server refuses cookie-bearing cross-site POSTs (403 MISSING_OR_NULL_ORIGIN).
 */
export const NO_COOKIES = { credentials: "omit" } as const satisfies RequestInit;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomString = () =>
  base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

/** The PKCE S256 challenge of `verifier` (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64url(new Uint8Array(digest));
}

/** POST a form to the token endpoint. */
async function tokenRequest(
  endpoint: string,
  form: Record<string, string>
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      ...NO_COOKIES,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    throw new SyncAuthError("server", `Token request failed: ${e}`);
  }

  const body = (await res.json().catch(() => undefined)) as
    | (Partial<TokenResponse> & { error?: string; error_description?: string })
    | undefined;
  if (!res.ok || typeof body?.access_token !== "string") {
    // RFC 6749 §5.2: a refused grant is a 400 with error=invalid_grant
    if (body?.error === "invalid_grant") throw new SyncAuthError("expired");
    throw new SyncAuthError(
      "server",
      `Token request failed: HTTP ${res.status} ${body?.error ?? ""} ${
        body?.error_description ?? ""
      }`.trim()
    );
  }
  return body as TokenResponse;
}

function authFromTokens(
  tokens: TokenResponse,
  previous: Pick<SyncAuth, "refreshToken" | "account"> | undefined
): SyncAuth {
  const refreshToken = tokens.refresh_token ?? previous?.refreshToken;
  if (!refreshToken) {
    throw new SyncAuthError("server", "The server issued no refresh token");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    account: previous?.account,
  };
}

async function fetchAccount(
  endpoint: string,
  accessToken: string
): Promise<SyncAuth["account"]> {
  try {
    const res = await fetch(endpoint, {
      ...NO_COOKIES,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const info = (await res.json()) as { sub?: unknown; email?: unknown };
    return {
      sub: typeof info.sub === "string" ? info.sub : undefined,
      email: typeof info.email === "string" ? info.email : undefined,
    };
  } catch {
    return undefined; // only shown in the UI; not worth failing sign-in over
  }
}

/**
 * Sign in through the browser's web auth flow. Call from an extension page.
 * Signing in as another account than before starts sync over (spec §5.7).
 */
export async function signIn(): Promise<SyncAuth> {
  const { endpoints } = await client();
  const redirectURI = Host.getRedirectURL(REDIRECT_PATH);
  const verifier = randomString();
  const state = randomString();

  const url = new URL(endpoints.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: SYNC_BUILD.clientID,
    redirect_uri: redirectURI,
    scope: SCOPES,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    state,
  }).toString();

  let redirected: URL;
  try {
    redirected = new URL(await Host.launchWebAuthFlow(url.toString(), true));
  } catch (e) {
    // closing the window rejects the flow too
    throw new SyncAuthError("cancelled", String(e));
  }

  const params = redirected.searchParams;
  if (params.get("state") !== state) throw new SyncAuthError("state_mismatch");
  const error = params.get("error");
  if (error) {
    throw new SyncAuthError(
      error === "access_denied" ? "cancelled" : "server",
      `${error} ${params.get("error_description") ?? ""}`.trim()
    );
  }
  const code = params.get("code");
  if (!code) throw new SyncAuthError("server", "The redirect has no code");

  const tokens = await tokenRequest(endpoints.token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectURI,
    client_id: SYNC_BUILD.clientID,
    code_verifier: verifier,
  });
  const auth = authFromTokens(tokens, undefined);
  auth.account = await fetchAccount(endpoints.userinfo_endpoint, auth.accessToken);

  const previous = await getSyncAuth();
  if (previous?.account?.sub && previous.account.sub !== auth.account?.sub) {
    await clearSyncState();
  }
  await setSyncAuth(auth);
  return auth;
}

/**
 * An access token that's valid for at least another minute, refreshed if
 * needed. Throws `SyncAuthError` "signed_out" or "expired" when the user has
 * to sign in.
 */
export async function getAccessToken(): Promise<string> {
  const auth = await getSyncAuth();
  if (!auth || auth.expired) throw new SyncAuthError("signed_out");
  if (auth.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return auth.accessToken;
  return refreshAccessToken(auth.accessToken);
}

/**
 * Trade the refresh token for new tokens. `rejected` is the access token
 * the caller found expired or refused: if another context already replaced
 * it, that one is returned instead of refreshing again.
 *
 * Refresh tokens are single use, and the server revokes every token of the
 * sign-in when a spent one comes back. So refreshes are serialized across
 * extension contexts, and the new refresh token is stored before the new
 * access token is handed out.
 */
export function refreshAccessToken(rejected?: string): Promise<string> {
  return withLock("proxyverse-sync-auth", async () => {
    const auth = await getSyncAuth();
    if (!auth || auth.expired) throw new SyncAuthError("signed_out");
    if (
      rejected !== undefined &&
      auth.accessToken !== rejected &&
      auth.expiresAt - EXPIRY_MARGIN_MS > Date.now()
    ) {
      return auth.accessToken;
    }

    const { endpoints } = await client();
    let tokens: TokenResponse;
    try {
      tokens = await tokenRequest(endpoints.token_endpoint, {
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: SYNC_BUILD.clientID,
      });
    } catch (e) {
      if (e instanceof SyncAuthError && e.code === "expired") {
        await setSyncAuth({ ...auth, expired: true });
      }
      throw e;
    }

    const next = authFromTokens(tokens, auth);
    await setSyncAuth(next);
    return next.accessToken;
  });
}

/**
 * Mark the sign-in expired, keeping the account to show. For a token the
 * server refuses in a way refreshing can't fix (403 invalid_token).
 */
export async function expireSignIn() {
  const auth = await getSyncAuth();
  if (auth) await setSyncAuth({ ...auth, expired: true });
}

/**
 * Sign out: revoke the refresh token (best effort; it revokes its access
 * tokens too) and forget the tokens and sync state. Local data stays.
 */
export async function signOut() {
  const auth = await getSyncAuth();
  if (auth && !auth.expired) {
    try {
      const { endpoints } = await client();
      await fetch(endpoints.revocation_endpoint, {
        ...NO_COOKIES,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: auth.refreshToken,
          token_type_hint: "refresh_token",
          client_id: SYNC_BUILD.clientID,
        }).toString(),
      });
    } catch (e) {
      console.warn("Revoking the sync sign-in failed", e);
    }
  }
  await clearSyncAuth();
  await clearSyncState();
}
