import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import {
  getAccessToken,
  pkceChallenge,
  refreshAccessToken,
  signIn,
  signOut,
  SyncAuthError,
} from "@/services/sync/auth";
import { keySyncAuth, keySyncState, type SyncAuth } from "@/services/sync/state";
import { fakeLocalStorage, jsonResponse } from "../../helpers";

const ORIGIN = "https://byte.vet";
const REDIRECT = "https://abc.chromiumapp.org/oauth";
const DISCOVERY = {
  issuer: `${ORIGIN}/api/auth`,
  authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
  token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
  revocation_endpoint: `${ORIGIN}/api/auth/oauth2/revoke`,
  userinfo_endpoint: `${ORIGIN}/api/auth/oauth2/userinfo`,
};

let local: Record<string, unknown>;
let session: Record<string, unknown>;
let requests: { url: string; init?: RequestInit }[];
let tokenReplies: (() => Response)[];

const json = jsonResponse;

const form = (init?: RequestInit) =>
  Object.fromEntries(new URLSearchParams(String(init?.body)));

beforeEach(() => {
  local = fakeLocalStorage();
  session = {};
  requests = [];
  tokenReplies = [];
  vi.spyOn(Host, "getSession").mockImplementation(async (k) => session[k] as any);
  vi.spyOn(Host, "setSession").mockImplementation(async (k, v) => {
    session[k] = v;
  });
  vi.spyOn(Host, "getRedirectURL").mockReturnValue(REDIRECT);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return json(DISCOVERY);
      }
      if (url === DISCOVERY.token_endpoint) {
        const reply = tokenReplies.shift();
        if (!reply) throw Error("unexpected token request");
        // let concurrent callers pile up behind the lock
        await new Promise((r) => setTimeout(r, 5));
        return reply();
      }
      if (url === DISCOVERY.userinfo_endpoint) {
        return json({ sub: "user-1", email: "me@example.com" });
      }
      if (url === DISCOVERY.revocation_endpoint) return new Response(null);
      throw Error(`unexpected fetch ${url}`);
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The browser's auth flow: approve, and redirect with `extra` params. */
function approveFlow(extra: (state: string) => Record<string, string>) {
  return vi.spyOn(Host, "launchWebAuthFlow").mockImplementation(async (url) => {
    const state = new URL(url).searchParams.get("state")!;
    const ret = new URL(REDIRECT);
    Object.entries(extra(state)).forEach(([k, v]) => ret.searchParams.set(k, v));
    return ret.toString();
  });
}

const tokens = (n: number) => () =>
  json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 });

const signedIn = (overrides: Partial<SyncAuth> = {}): SyncAuth => ({
  accessToken: "access-0",
  refreshToken: "refresh-0",
  expiresAt: Date.now() + 3_600_000,
  account: { sub: "user-1", email: "me@example.com" },
  ...overrides,
});

describe("signIn", () => {
  test("runs the PKCE flow and stores the tokens and account", async () => {
    const flow = approveFlow((state) => ({ code: "the-code", state }));
    tokenReplies.push(tokens(1));

    await signIn();

    const authorize = new URL(flow.mock.calls[0][0]);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "proxyverse-extension",
      redirect_uri: REDIRECT,
      scope: "openid email offline_access sync",
      code_challenge_method: "S256",
    });
    const exchange = requests.find((r) => r.url === DISCOVERY.token_endpoint)!;
    const sent = form(exchange.init);
    expect(sent).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT,
      client_id: "proxyverse-extension",
    });
    expect(await pkceChallenge(sent.code_verifier)).toBe(
      authorize.searchParams.get("code_challenge")
    );
    expect(local[keySyncAuth]).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      account: { sub: "user-1", email: "me@example.com" },
    });
  });

  test("rejects a redirect for another request", async () => {
    approveFlow(() => ({ code: "c", state: "forged" }));
    await expect(signIn()).rejects.toMatchObject({ code: "state_mismatch" });
    expect(local[keySyncAuth]).toBeUndefined();
  });

  test("reports a denied or closed sign-in as cancelled", async () => {
    approveFlow((state) => ({ error: "access_denied", state }));
    await expect(signIn()).rejects.toMatchObject({ code: "cancelled" });

    vi.spyOn(Host, "launchWebAuthFlow").mockRejectedValue(
      Error("The user did not approve access.")
    );
    await expect(signIn()).rejects.toMatchObject({ code: "cancelled" });
  });

  test("starts sync over when another account signs in", async () => {
    local[keySyncAuth] = signedIn({ expired: true, account: { sub: "someone-else" } });
    local[keySyncState] = { cursor: 42 };
    approveFlow((state) => ({ code: "c", state }));
    tokenReplies.push(tokens(1));

    await signIn();
    expect(local[keySyncState]).toBeUndefined();
  });

  test("keeps the sync state when the same account signs in again", async () => {
    local[keySyncAuth] = signedIn({ expired: true });
    local[keySyncState] = { cursor: 42 };
    approveFlow((state) => ({ code: "c", state }));
    tokenReplies.push(tokens(1));

    await signIn();
    expect(local[keySyncState]).toEqual({ cursor: 42 });
  });
});

test("no request to byte.vet sends cookies", async () => {
  // the auth server refuses cookie-bearing POSTs (403 MISSING_OR_NULL_ORIGIN)
  approveFlow((state) => ({ code: "c", state }));
  tokenReplies.push(tokens(1));
  await signIn();
  local[keySyncAuth] = signedIn({ expiresAt: Date.now() });
  tokenReplies.push(tokens(2));
  await getAccessToken();
  await signOut();

  expect(requests.length).toBeGreaterThan(4);
  for (const { url, init } of requests) {
    expect(init?.credentials, url).toBe("omit");
  }
});

describe("tokens", () => {
  test("a fresh access token is used as is", async () => {
    local[keySyncAuth] = signedIn();
    expect(await getAccessToken()).toBe("access-0");
    expect(requests).toHaveLength(0);
  });

  test("an expiring token is refreshed, and the rotated refresh token kept", async () => {
    local[keySyncAuth] = signedIn({ expiresAt: Date.now() + 30_000 });
    tokenReplies.push(tokens(1));

    expect(await getAccessToken()).toBe("access-1");
    const sent = form(requests.find((r) => r.url === DISCOVERY.token_endpoint)!.init);
    expect(sent).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-0" });
    expect(local[keySyncAuth]).toMatchObject({ refreshToken: "refresh-1" });
  });

  test("concurrent refreshes spend the refresh token once", async () => {
    local[keySyncAuth] = signedIn();
    tokenReplies.push(tokens(1));

    const got = await Promise.all([
      refreshAccessToken("access-0"),
      refreshAccessToken("access-0"),
      refreshAccessToken("access-0"),
    ]);
    expect(got).toEqual(["access-1", "access-1", "access-1"]);
    expect(requests.filter((r) => r.url === DISCOVERY.token_endpoint)).toHaveLength(1);
  });

  test("a refused refresh token expires the sign-in", async () => {
    local[keySyncAuth] = signedIn();
    tokenReplies.push(() => json({ error: "invalid_grant" }, 400));

    await expect(refreshAccessToken("access-0")).rejects.toBeInstanceOf(SyncAuthError);
    expect(local[keySyncAuth]).toMatchObject({ expired: true, refreshToken: "refresh-0" });
    await expect(getAccessToken()).rejects.toMatchObject({ code: "signed_out" });
  });

  test("a server error keeps the sign-in", async () => {
    local[keySyncAuth] = signedIn();
    tokenReplies.push(() => json({ error: "temporarily_unavailable" }, 503));

    await expect(refreshAccessToken("access-0")).rejects.toMatchObject({ code: "server" });
    expect(local[keySyncAuth]).not.toHaveProperty("expired");
  });
});

test("signOut revokes the refresh token and forgets the sign-in", async () => {
  local[keySyncAuth] = signedIn();
  local[keySyncState] = { cursor: 1 };

  await signOut();

  const revoke = requests.find((r) => r.url === DISCOVERY.revocation_endpoint)!;
  expect(form(revoke.init)).toEqual({
    token: "refresh-0",
    token_type_hint: "refresh_token",
    client_id: "proxyverse-extension",
  });
  expect(local[keySyncAuth]).toBeUndefined();
  expect(local[keySyncState]).toBeUndefined();
});
