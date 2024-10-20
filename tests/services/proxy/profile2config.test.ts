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

  pacProxy: {
    profileID: "pacProxy",
    color: "",
    profileName: "",
    proxyType: "pac",
    proxyRules: {
      default: {
        scheme: "http",
        host: "",
      },
      bypassList: [],
    },
    pacScript: {
      data: "function FindProxyForURL(url, host) { return 'DIRECT'; }",
    },
  },

  autoProxy: {
    profileID: "autoProxy",
    color: "",
    profileName: "",
    proxyType: "auto",
    rules: [
      {
        type: "domain",
        condition: "*.example.com",
        profileID: "simpleProxy",
      },
      {
        type: "url",
        condition: "http://example.com/api/*",
        profileID: "pacProxy",
      },
      {
        type: "cidr",
        condition: "192.168.10.1/24",
        profileID: "simpleProxy",
      },
      {
        type: "domain",
        condition: "*.404.com",
        profileID: "non-exists",
      },
    ],
    defaultProfileID: "direct",
  },

  direct: {
    profileID: "direct",
    color: "",
    profileName: "",
    proxyType: "direct",
  },

  autoProxy2: {
    profileID: "autoProxy2",
    color: "",
    profileName: "",
    proxyType: "auto",
    rules: [
      {
        type: "domain",
        condition: "*.example.com",
        profileID: "autoProxy",
      },
    ],
    defaultProfileID: "direct",
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

describe("testing auto switch profile", () => {
  test("auto switch profile", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, async (id) => {
      return profiles[id];
    });
    const cfg = await profile.toProxyConfig();
    expect(cfg.mode).toBe("pac_script");

    expect(cfg.pacScript?.data).toContain(`
register('pacProxy', function () {
    function FindProxyForURL(url, host) {
        return 'DIRECT';
    }
    return FindProxyForURL;
}());`);

    expect(cfg.pacScript?.data).toContain(`
    if (isInNet(host, '192.168.10.1', '255.255.255.0')) {
        return profiles['simpleProxy'](url, host);
    }`);

    expect(cfg.pacScript?.data).toContain(
      `alert('Profile non-exists not found, skipped');`
    );
    expect(cfg.pacScript?.data).toContain(
      `return profiles['direct'](url, host);`
    );
  });
  test("nested auto switch profile", async () => {
    const profile = new ProfileConverter(profiles.autoProxy2, async (id) => {
      return profiles[id];
    });
    const cfg = await profile.toProxyConfig();
    expect(cfg.mode).toBe("pac_script");

    expect(cfg.pacScript?.data).toContain(`
    if (shExpMatch(host, '*.example.com')) {
        return profiles['autoProxy'](url, host);
    }`);
  });
});
