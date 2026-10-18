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

const { createRouteResolver, routeFactsOf } = await import(
  "@/services/proxy/route"
);
const { ProfileConverter } = await import("@/services/proxy/profile2config");

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

describe("ProfileConverter.findServer", () => {
  const p = proxy("p", {
    default: server("default.proxy", 1),
    https: server("https.proxy", 2),
    bypassList: ["<local>", "*.lan", "10.0.0.0/8"],
  });
  const choice = (url: string) => new ProfileConverter(p).findServer(new URL(url));
  const host = (url: string) => {
    const c = choice(url);
    return "server" in c ? c.server.host : c;
  };

  test("bypass list goes direct", () => {
    expect(choice("http://intranet/")).toEqual({ direct: true });
    expect(choice("http://nas.lan/")).toEqual({ direct: true });
    expect(choice("http://10.1.2.3/")).toEqual({ direct: true });
  });

  test("a CIDR bypass can't be checked against a hostname", () => {
    expect(choice("http://example.com/")).toEqual({ uncertain: true });
  });

  test("per-scheme servers, websockets like http(s)", () => {
    expect(host("http://1.2.3.4/")).toBe("default.proxy");
    expect(host("https://1.2.3.4/")).toBe("https.proxy");
    expect(host("wss://1.2.3.4/")).toBe("https.proxy");
    expect(host("ws://1.2.3.4/")).toBe("default.proxy");
  });
});

describe("routeFactsOf", () => {
  test("keeps only what tells the route", () => {
    expect(routeFactsOf({ proxyInfo: null, ip: "1.2.3.4" } as any)).toEqual({
      proxyInfo: null,
    });
    expect(routeFactsOf({ ip: "1.2.3.4", fromCache: false })).toEqual({
      ip: "1.2.3.4",
    });
    expect(routeFactsOf({})).toBeUndefined();
  });
});

describe("createRouteResolver", () => {
  // local proxies: same IP, different ports
  const proxyA = proxy("proxyA", { default: server("127.0.0.1", 7890) });
  const proxyB = proxy("proxyB", { default: server("127.0.0.1", 1080) });
  const named = proxy("named", { default: server("proxy.example", undefined, "https") });
  const pac: ProfileSimple = {
    profileID: "pac",
    profileName: "pac",
    color: "",
    proxyType: "pac",
    pacScript: { data: "function FindProxyForURL() { return 'DIRECT'; }" },
  };

  beforeEach(() => {
    store = {
      proxyA,
      proxyB,
      named,
      pac,
      auto: auto(
        [
          { type: "domain", condition: "a.test", profileID: "proxyA" },
          { type: "domain", condition: "n.test", profileID: "named" },
          { type: "domain", condition: "pac.test", profileID: "pac" },
          { type: "domain", condition: "d.test", profileID: "direct" },
          { type: "cidr", condition: "10.0.0.0/8", profileID: "proxyA" },
        ],
        "proxyB"
      ),
    };
  });

  const resolve = async (url: string, facts?: any) =>
    (await createRouteResolver(store.auto))(url, facts);
  const id = async (url: string, facts?: any) =>
    (await resolve(url, facts)).profile?.profileID;

  test("without facts, the rules decide", async () => {
    expect(await id("http://a.test/")).toBe("proxyA");
  });

  describe("Firefox: proxyInfo", () => {
    test("direct", async () => {
      expect(await resolve("http://a.test/", { proxyInfo: null })).toEqual({
        profile: expect.objectContaining({ profileID: "direct" }),
        uncertain: false,
      });
    });

    test("the profile of the proxy used, ports told apart", async () => {
      const facts = { proxyInfo: { host: "127.0.0.1", port: 1080, type: "http" } };
      expect(await resolve("http://pac.test/", facts)).toEqual({
        profile: expect.objectContaining({ profileID: "proxyB" }),
        uncertain: false,
      });
    });

    test("default ports", async () => {
      const facts = { proxyInfo: { host: "Proxy.example", port: 443, type: "https" } };
      expect(await id("http://other.test/", facts)).toBe("named");
    });

    test("a proxy no profile uses keeps the prediction", async () => {
      const facts = { proxyInfo: { host: "9.9.9.9", port: 9, type: "http" } };
      expect(await id("http://pac.test/", facts)).toBe("pac");
    });
  });

  describe("Chrome: ip", () => {
    const local = { ip: "127.0.0.1" };

    test("same-IP proxies don't confirm an uncertain prediction", async () => {
      // CIDR → proxyA, else proxyB: either may have been used
      const r = await resolve("http://other.test/", local);
      expect(r.profile?.profileID).toBe("proxyA");
      expect(r.uncertain).toBe(true);
    });

    test("same-IP proxies keep a certain prediction", async () => {
      const r = await resolve("http://a.test/", local);
      expect(r.profile?.profileID).toBe("proxyA");
      expect(r.uncertain).toBe(false);
    });

    test("a proxied request predicted otherwise becomes uncertain", async () => {
      const r = await resolve("http://d.test/", local);
      expect(r.profile?.profileID).toBe("direct");
      expect(r.uncertain).toBe(true);
    });

    test("an expected proxy set by IP, but another IP: direct", async () => {
      expect(await id("http://a.test/", { ip: "5.6.7.8" })).toBe("direct");
    });

    test("proxies set by hostname can't be told", async () => {
      const r = await resolve("http://n.test/", { ip: "5.6.7.8" });
      expect(r).toEqual({
        profile: expect.objectContaining({ profileID: "named" }),
        uncertain: false,
      });
    });

    test("loopback hosts are never proxied", async () => {
      expect(await id("http://localhost:3000/", local)).toBe("direct");
    });

    test("cached responses are ignored", async () => {
      expect(await id("http://d.test/", { ...local, fromCache: true })).toBe(
        "direct"
      );
      expect((await resolve("http://d.test/", { ...local, fromCache: true })).uncertain).toBe(
        false
      );
    });
  });
});
