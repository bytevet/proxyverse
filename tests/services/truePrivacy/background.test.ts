import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import { SyncApi } from "@/services/sync/api";
import { SyncStore } from "../../../e2e/servers/syncStore";
import { fakeLocalStorage, fakeSessionStorage } from "../../helpers";

const DEVICE = "7b1e0000-0000-4000-8000-000000000001";
const ORIGIN = "https://sync.example";

const store = new SyncStore();
let registered = true;
let accessToken = "";

vi.mock("@/services/sync/index", () => ({
  currentSyncApi: vi.fn(async () =>
    registered
      ? new SyncApi({
          origin: ORIGIN,
          deviceID: DEVICE,
          version: "2.3.0",
          getAccessToken: async () => accessToken,
          refreshAccessToken: async () => accessToken,
          fetch: store.fetch,
        })
      : undefined
  ),
}));

const active = { profile: undefined as { profileID: string } | undefined };
const setProxy = vi.fn(async (p: { profileID: string }) => {
  active.profile = p;
});
const refreshProxy = vi.fn(async () => {});
vi.mock("@/services/proxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/proxy")>();
  return {
  ...actual,
  getCurrentProxySetting: vi.fn(async () => ({ activeProfile: active.profile })),
  activeRoutesTo: vi.fn(async (id: string) => {
    const p = active.profile;
    if (!p) return { activeProfile: undefined, routes: false };
    const profiles = { [p.profileID]: p, ...((local.profiles as object) ?? {}) };
    return {
      activeProfile: p,
      routes: actual.profileTreeIDs(p.profileID, profiles as never).has(id),
    };
  }),
  setProxy: (p: { profileID: string }) => setProxy(p),
  refreshProxy: () => refreshProxy(),
  };
});

const { getProxyToken, truePrivacyAuth, refreshUsage, applyWebRTCPolicy } = await import(
  "@/services/truePrivacy/background"
);
const { SystemProfile, truePrivacyProfile } = await import("@/services/profile");

let local: Record<string, unknown>;
let session: Record<string, unknown>;

beforeEach(() => {
  store.reset();
  store.configure({ clientIDs: ["proxyverse-extension-dev"] });
  accessToken = store.issueTokens().access_token;
  registered = true;
  active.profile = undefined;
  setProxy.mockClear();
  refreshProxy.mockClear();

  local = fakeLocalStorage({
    "proxy.truePrivacy": true,
    "sync.auth": {
      accessToken,
      refreshToken: "rt",
      expiresAt: Date.now() + 3600_000,
    },
  });
  session = fakeSessionStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const tokenRequests = () => store.requests("/proxy/token", "POST").length;
const tp = truePrivacyProfile();

describe("access token", () => {
  test("is fetched once, then reused", async () => {
    const t = await getProxyToken();
    expect(store.isValidProxyToken(t!)).toBe(true);
    expect(await getProxyToken()).toBe(t);
    expect(tokenRequests()).toBe(1);
  });

  test("is replaced when close to expiry", async () => {
    const t = await getProxyToken();
    vi.useFakeTimers({ now: Date.now() + 56 * 60_000 });
    store.setNow(Date.now());
    expect(await getProxyToken()).not.toBe(t);
  });

  test("a refused token is replaced, at most once a minute", async () => {
    const t = await getProxyToken();
    const t2 = await getProxyToken(t);
    expect(t2).not.toBe(t);
    // the new one refused too: the nodes refuse every token, don't insist
    expect(await getProxyToken(t2)).toBe(t2);
    expect(tokenRequests()).toBe(2);
    vi.useFakeTimers({ now: Date.now() + 2 * 60_000 });
    expect(await getProxyToken(t2)).not.toBe(t2);
  });

  test("none when turned off or signed out, so requests fail closed", async () => {
    local["proxy.truePrivacy"] = false;
    expect(await getProxyToken()).toBeUndefined();
    local["proxy.truePrivacy"] = true;
    delete local["sync.auth"];
    expect(await getProxyToken()).toBeUndefined();
    expect(tokenRequests()).toBe(0);
  });

  test("not before the device is registered", async () => {
    registered = false;
    expect(await getProxyToken()).toBeUndefined();
    expect(session["trueprivacy.status"]).toEqual({ state: "not_ready" });
  });

  test("suspended: no token, and the active proxy switches to Direct", async () => {
    store.configureProxy({ status: "suspended" });
    active.profile = tp;
    expect(await getProxyToken()).toBeUndefined();
    expect(session["trueprivacy.status"]).toEqual({ state: "suspended" });
    expect(setProxy).toHaveBeenCalledWith(SystemProfile.DIRECT);
  });

  test("rate limited: waits for Retry-After before asking again", async () => {
    store.failNext({ path: "/proxy/token", status: 429, code: "rate_limited", retryAfter: 60 });
    expect(await getProxyToken()).toBeUndefined();
    expect(await getProxyToken()).toBeUndefined();
    expect(tokenRequests()).toBe(1);
  });

  test("new nodes are remembered and the proxy re-applied when it uses them", async () => {
    store.configureProxy({ endpoints: [{ host: "node-a.vpn.test", port: 443 }] });
    active.profile = tp;
    await getProxyToken();
    expect(local["trueprivacy.endpoints"]).toEqual([{ host: "node-a.vpn.test", port: 443 }]);
    expect(refreshProxy).toHaveBeenCalledTimes(1);
  });

  test("no nodes named: unavailable, and nowhere to send traffic", async () => {
    store.configureProxy({ endpoints: [{ host: "node-a.vpn.test", port: 443 }] });
    const t = await getProxyToken();
    store.configureProxy({ endpoints: [] });
    expect(await getProxyToken(t)).toBeUndefined();
    expect(session["trueprivacy.status"]).toMatchObject({ state: "unavailable" });
    expect(session["trueprivacy.token"]).toBeUndefined();
    expect(local["trueprivacy.endpoints"]).toEqual([]);
  });
});

describe("profile", () => {
  test("points nowhere until byte.vet names a node", () => {
    expect(tp.proxyType === "proxy" && tp.proxyRules.default).toMatchObject({
      scheme: "https",
      host: "trueprivacy.invalid",
    });
    const named = truePrivacyProfile([
      { host: "a.vpn.test", port: 443 },
      { host: "b.vpn.test", port: 8443 },
    ]);
    expect(named).toMatchObject({
      proxyRules: { default: { host: "a.vpn.test" } },
      failover: [{ scheme: "https", host: "b.vpn.test", port: 8443 }],
    });
  });
});

describe("auth provider credentials", () => {
  test("the token, then a new one when refused, then nothing", async () => {
    const [first] = await truePrivacyAuth(tp, 0);
    expect(first.username).toBe("pv");
    const retry = await truePrivacyAuth(tp, 1);
    expect(retry[0]).toEqual(first);
    expect(retry[1].password).not.toBe(first.password);
    expect(await truePrivacyAuth(tp, 2)).toEqual([]);
  });

  test("only for True Privacy Proxy", async () => {
    expect(await truePrivacyAuth(SystemProfile.DIRECT, 0)).toEqual([]);
  });
});

describe("usage", () => {
  test("is cached for a minute", async () => {
    store.configureProxy({ used: 1024 });
    await refreshUsage();
    await refreshUsage();
    expect(store.requests("/proxy/usage").length).toBe(1);
    expect(session["trueprivacy.usage"]).toMatchObject({ usage: { used: 1024 } });
  });
});

describe("WebRTC", () => {
  let granted = true;
  let policy: boolean | undefined;
  beforeEach(async () => {
    policy = undefined;
    vi.spyOn(Host, "hasPermission").mockImplementation(async () => granted);
    vi.spyOn(Host, "setWebRTCProxyOnly").mockImplementation(async (on) => {
      policy = on;
    });
    // forget the policy applied by an earlier test
    granted = false;
    await applyWebRTCPolicy();
    granted = true;
  });

  test("written once while it doesn't change", async () => {
    active.profile = tp;
    await applyWebRTCPolicy();
    await applyWebRTCPolicy();
    expect(Host.setWebRTCProxyOnly).toHaveBeenCalledTimes(1);
  });

  test("kept to the proxy while True Privacy Proxy is the active profile", async () => {
    active.profile = tp;
    await applyWebRTCPolicy();
    expect(policy).toBe(true);
  });

  test("and while the active profile routes to it", async () => {
    local.profiles = {
      auto: {
        profileID: "auto",
        profileName: "auto",
        color: "",
        proxyType: "auto",
        rules: [{ type: "domain", condition: "*.onion", profileID: "trueprivacy" }],
        defaultProfileID: "direct",
      },
    };
    active.profile = { profileID: "auto" };
    await applyWebRTCPolicy();
    expect(policy).toBe(true);
  });

  test("the browser's default otherwise", async () => {
    active.profile = SystemProfile.DIRECT;
    await applyWebRTCPolicy();
    expect(policy).toBe(false);
  });

  test("untouched without the privacy permission", async () => {
    granted = false;
    active.profile = tp;
    await applyWebRTCPolicy();
    expect(policy).toBeUndefined();
  });
});
