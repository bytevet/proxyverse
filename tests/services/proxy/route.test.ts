import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  ProfileAutoSwitch,
  ProfilesStorage,
  ProfileSimple,
  ProxyServer,
} from "@/services/profile";

let store: ProfilesStorage = {};
vi.mock("@/services/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/profile")>()),
  listProfiles: vi.fn(async () => store),
}));

const {
  RouteObserver,
  createRouteResolver,
  serverFor,
  serverKey,
} = await import("@/services/proxy/route");

const server = (host: string, port?: number, scheme = "http"): ProxyServer => ({
  host,
  port,
  scheme: scheme as ProxyServer["scheme"],
});

type Rules = {
  default: ProxyServer;
  http?: ProxyServer;
  https?: ProxyServer;
  bypassList?: string[];
};

const proxy = (
  profileID: string,
  rules: Rules
): ProfileSimple & { proxyType: "proxy" } => ({
  profileID,
  profileName: profileID,
  color: "",
  proxyType: "proxy",
  proxyRules: { ...rules, bypassList: rules.bypassList ?? [] },
});

const auto = (
  rules: ProfileAutoSwitch["rules"],
  defaultProfileID = "direct"
): ProfileAutoSwitch => ({
  profileID: "auto",
  profileName: "auto",
  color: "",
  proxyType: "auto",
  rules,
  defaultProfileID,
});

describe("serverKey", () => {
  test("uses the browser's default ports", () => {
    expect(serverKey(server("P.example", 8080))).toBe("p.example:8080");
    expect(serverKey(server("p", undefined, "http"))).toBe("p:80");
    expect(serverKey(server("p", undefined, "https"))).toBe("p:443");
    expect(serverKey(server("p", undefined, "socks5"))).toBe("p:1080");
  });
});

describe("serverFor", () => {
  const p = proxy("p", {
    default: server("default.proxy", 1),
    https: server("https.proxy", 2),
    bypassList: ["<local>", "*.lan", "10.0.0.0/8"],
  });
  const choice = (url: string) => serverFor(p, new URL(url));

  test("bypass list goes direct", () => {
    expect(choice("http://intranet/")).toEqual({ direct: true });
    expect(choice("http://nas.lan/")).toEqual({ direct: true });
    expect(choice("http://10.1.2.3/")).toEqual({ direct: true });
  });

  test("a CIDR bypass can't be checked against a hostname", () => {
    expect(choice("http://example.com/")).toEqual({ uncertain: true });
  });

  test("per-scheme servers, websockets like http(s)", () => {
    const q = proxy("q", {
      default: server("default.proxy", 1),
      https: server("https.proxy", 2),
    });
    const host = (url: string) => {
      const c = serverFor(q, new URL(url));
      return "server" in c ? c.server.host : c;
    };
    expect(host("http://example.com/")).toBe("default.proxy");
    expect(host("https://example.com/")).toBe("https.proxy");
    expect(host("wss://example.com/")).toBe("https.proxy");
    expect(host("ws://example.com/")).toBe("default.proxy");
  });
});


describe("RouteObserver", () => {
  const proxyA = proxy("proxyA", { default: server("127.0.0.1", 7890) });
  const named = proxy("named", { default: server("proxy.example", 3128) });

  beforeEach(() => {
    store = {
      proxyA,
      named,
      auto: auto([
        { type: "domain", condition: "*.a.test", profileID: "proxyA" },
        { type: "domain", condition: "*.n.test", profileID: "named" },
        { type: "cidr", condition: "10.0.0.0/8", profileID: "proxyA" },
      ]),
    };
  });

  const observe = (details: Parameters<InstanceType<typeof RouteObserver>["observe"]>[0]) =>
    new RouteObserver(async () => store.auto).observe(details);

  test("Firefox: proxyInfo is the route", async () => {
    expect(
      await observe({
        url: "http://x.test/",
        proxyInfo: { host: "Proxy.example", port: 3128, type: "http" },
      })
    ).toEqual({ servers: ["proxy.example:3128"] });
    expect(await observe({ url: "http://x.test/", proxyInfo: null })).toEqual({
      direct: true,
    });
  });

  test("Chrome: the IP of a proxy set by IP", async () => {
    expect(await observe({ url: "http://x.a.test/", ip: "127.0.0.1" })).toEqual({
      servers: ["127.0.0.1:7890"],
    });
  });

  test("Chrome: an expected proxy set by IP, but another IP: direct", async () => {
    expect(await observe({ url: "http://x.a.test/", ip: "5.6.7.8" })).toEqual({
      direct: true,
    });
  });

  test("Chrome: proxies set by hostname can't be told", async () => {
    expect(await observe({ url: "http://x.n.test/", ip: "5.6.7.8" })).toBe(
      undefined
    );
  });

  test("Chrome: an uncertain route stays unknown", async () => {
    // the CIDR rule can't be checked against a hostname
    expect(await observe({ url: "http://other.test/", ip: "5.6.7.8" })).toBe(
      undefined
    );
  });

  test("Chrome: loopback hosts are never proxied", async () => {
    expect(await observe({ url: "http://localhost:3000/", ip: "127.0.0.1" })).toEqual(
      { direct: true }
    );
  });

  test("Chrome: cached responses are ignored", async () => {
    expect(
      await observe({ url: "http://x.a.test/", ip: "127.0.0.1", fromCache: true })
    ).toBe(undefined);
  });
});

describe("createRouteResolver", () => {
  // local proxies: same IP, different ports
  const proxyA = proxy("proxyA", { default: server("127.0.0.1", 7890) });
  const proxyB = proxy("proxyB", { default: server("127.0.0.1", 1080) });
  const pac: ProfileSimple = {
    profileID: "pac",
    profileName: "pac",
    color: "",
    proxyType: "pac",
    pacScript: { data: "function FindProxyForURL() { return 'DIRECT'; }" },
  };
  const both = ["127.0.0.1:7890", "127.0.0.1:1080"]; // what Chrome observes

  beforeEach(() => {
    store = {
      proxyA,
      proxyB,
      pac,
      auto: auto(
        [
          { type: "domain", condition: "a.test", profileID: "proxyA" },
          { type: "domain", condition: "pac.test", profileID: "pac" },
          { type: "cidr", condition: "10.0.0.0/8", profileID: "proxyA" },
        ],
        "proxyB"
      ),
    };
  });

  const resolve = async (url: string, observed?: any) =>
    (await createRouteResolver(store.auto))(url, observed);

  test("without an observation, the rules decide", async () => {
    expect((await resolve("http://a.test/")).profile?.profileID).toBe("proxyA");
  });

  test("an observed direct route wins", async () => {
    const r = await resolve("http://a.test/", { direct: true });
    expect(r).toEqual({ profile: expect.objectContaining({ profileID: "direct" }), uncertain: false });
  });

  test("a server only one profile uses confirms that profile", async () => {
    const r = await resolve("http://pac.test/", { servers: ["127.0.0.1:1080"] });
    expect(r.profile?.profileID).toBe("proxyB");
    expect(r.uncertain).toBe(false);
  });

  test("same-IP proxies don't confirm an uncertain prediction", async () => {
    // CIDR → proxyA, else proxyB: either may have been used
    const r = await resolve("http://other.test/", { servers: both });
    expect(r.profile?.profileID).toBe("proxyA");
    expect(r.uncertain).toBe(true);
  });

  test("same-IP proxies keep a certain prediction", async () => {
    const r = await resolve("http://a.test/", { servers: both });
    expect(r.profile?.profileID).toBe("proxyA");
    expect(r.uncertain).toBe(false);
  });

  test("a proxied request predicted otherwise becomes uncertain", async () => {
    const r = await resolve("http://pac.test/", { servers: both });
    expect(r.profile?.profileID).toBe("pac");
    expect(r.uncertain).toBe(true);
  });

  test("a server no profile uses keeps the prediction", async () => {
    const r = await resolve("http://pac.test/", { servers: ["9.9.9.9:9"] });
    expect(r.profile?.profileID).toBe("pac");
    expect(r.uncertain).toBe(false);
  });
});
