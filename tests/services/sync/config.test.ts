import { afterEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import { SYNC_BUILD } from "@/services/sync/buildEnv";
import { discover, syncOrigin } from "@/services/sync/config";

const ORIGIN = "https://sync.example";
const metadata = {
  issuer: `${ORIGIN}/api/auth`,
  authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
  token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
  revocation_endpoint: `${ORIGIN}/api/auth/oauth2/revoke`,
  userinfo_endpoint: `${ORIGIN}/api/auth/oauth2/userinfo`,
  scopes_supported: ["openid", "sync"],
  response_types_supported: ["code"],
};

/** Session storage backed by a map. */
function fakeSession() {
  const store = new Map<string, unknown>();
  vi.spyOn(Host, "getSession").mockImplementation(async (k) => store.get(k) as never);
  vi.spyOn(Host, "setSession").mockImplementation(async (k, v) => {
    store.set(k, v);
  });
  return store;
}

const fetchReturning = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;

describe("syncOrigin", () => {
  afterEach(() => vi.restoreAllMocks());

  test("is the build's origin", async () => {
    const get = vi.spyOn(Host, "get").mockResolvedValue("https://elsewhere");
    expect(SYNC_BUILD.allowOriginOverride).toBe(false);
    expect(await syncOrigin()).toBe(SYNC_BUILD.origin);
    expect(get).not.toHaveBeenCalled();
  });

  test("e2e builds read an override from storage", async () => {
    vi.spyOn(SYNC_BUILD, "allowOriginOverride", "get").mockReturnValue(true);
    const get = vi.spyOn(Host, "get").mockResolvedValue("http://127.0.0.1:9000/");
    expect(await syncOrigin()).toBe("http://127.0.0.1:9000");
    expect(get).toHaveBeenCalledWith("sync.devOrigin");

    get.mockResolvedValue(undefined);
    expect(await syncOrigin()).toBe(SYNC_BUILD.origin);
  });
});

describe("discover", () => {
  afterEach(() => vi.restoreAllMocks());

  test("fetches the metadata and caches it per origin", async () => {
    const session = fakeSession();
    const fetch = fetchReturning(metadata);
    const { response_types_supported: _, ...expected } = metadata;

    expect(await discover(ORIGIN, fetch)).toEqual(expected);
    expect(fetch).toHaveBeenCalledWith(
      `${ORIGIN}/.well-known/oauth-authorization-server`,
      expect.anything()
    );
    expect(session.get("sync.discovery")).toEqual({ [ORIGIN]: expected });

    expect(await discover(ORIGIN, fetch)).toEqual(expected);
    expect(fetch).toHaveBeenCalledOnce();

    // another origin isn't served from the cache
    await expect(discover("https://other.example", fetch)).rejects.toThrow(/issuer/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("rejects an issuer on another origin", async () => {
    fakeSession();
    const fetch = fetchReturning({ ...metadata, issuer: "https://evil.example/api/auth" });
    await expect(discover(ORIGIN, fetch)).rejects.toThrow(/issuer/);
  });

  test.each([
    "authorization_endpoint",
    "token_endpoint",
    "revocation_endpoint",
    "userinfo_endpoint",
  ])("requires %s", async (key) => {
    const session = fakeSession();
    const fetch = fetchReturning({ ...metadata, [key]: undefined });
    await expect(discover(ORIGIN, fetch)).rejects.toThrow(key);
    expect(session.size).toBe(0);
  });

  test("fails on an HTTP error", async () => {
    fakeSession();
    await expect(discover(ORIGIN, fetchReturning({}, 404))).rejects.toThrow(/404/);
  });
});
