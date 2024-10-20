import { expect, test, describe } from "vitest";
import { ProxyProfile, SystemProfile } from "@/services/profile";
import { ProfileConverter } from "@/services/proxy/profile2config";

const profiles: Record<string, ProxyProfile> = {
  simpleProxy: {
    profileID: "simpleProxy",
    color: "",
    profileName: "",
    proxyType: "proxy",
    proxyRules: {
      default: {
        scheme: "http",
        host: "127.0.0.1",
        port: 8080,
      },
      https: {
        scheme: "direct",
        host: "",
      },
      bypassList: [
        "<local>",
        "127.0.0.1",
        "192.168.0.1/16",
        "[::1]",
        "fefe:13::abc/33",
      ],
    },
    pacScript: {},
  },
};

describe("testing generating ProxyConfig for direct and system", () => {
  test("proxy config mode", async () => {
    const profile = new ProfileConverter(SystemProfile.DIRECT);
    const cfg = await profile.toProxyConfig();
    expect(cfg.mode).toBe("direct");
  });

  test("proxy config mode for others", async () => {
    const profile = new ProfileConverter(profiles.simpleProxy);
    const cfg = await profile.toProxyConfig();
    expect(cfg.mode).toBe("pac_script");
  });
});

describe("testing bypass list", () => {
  test("bypass list with ipv6", async () => {
    const profile = new ProfileConverter(profiles.simpleProxy);
    const cfg = await profile.toProxyConfig();
    expect(cfg.pacScript?.data).toMatch(
      /.*?isInNet\(host, '192\.168\.0\.1', '255\.255\.0\.0'\).*?/
    );
    expect(cfg.pacScript?.data).toMatch(
      /.*?isInNet\(host, 'fefe:13::abc', 'ffff:ffff:8000:0:0:0:0:0'\).*?/
    );
  });
});
