import { expect, test, describe } from "vitest";
import {
  ProxyProfile,
  SystemProfile,
  ProfileAutoSwitch,
} from "@/services/profile";
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

describe("testing findProfile function", () => {
  const profileLoader = async (id: string) => profiles[id];

  test("simple profiles return themselves", async () => {
    const url = new URL("https://example.com");

    const direct = new ProfileConverter(SystemProfile.DIRECT);
    expect((await direct.findProfile(url)).profile).toBe(direct);
    expect((await direct.findProfile(url)).isConfident).toBe(true);

    const system = new ProfileConverter(SystemProfile.SYSTEM);
    expect((await system.findProfile(url)).profile).toBe(system);
    expect((await system.findProfile(url)).isConfident).toBe(true);

    const pac = new ProfileConverter(profiles.pacProxy);
    expect((await pac.findProfile(url)).profile).toBe(pac);
    expect((await pac.findProfile(url)).isConfident).toBe(true);
  });

  test("auto profile matches rules and falls back to default", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);

    // Domain rule match
    expect(
      (await profile.findProfile(new URL("https://test.example.com"))).profile
    ).toBeDefined();

    // URL rule match
    expect(
      (await profile.findProfile(new URL("http://example.com/api/v1/users")))
        .profile
    ).toBeDefined();

    // CIDR rule match
    expect(
      (await profile.findProfile(new URL("http://192.168.10.50"))).profile
    ).toBeDefined();

    // No match - falls back to default
    expect(
      (await profile.findProfile(new URL("https://other.com"))).profile
    ).toBeDefined();
  });

  test("auto profile handles edge cases", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);

    // CIDR with hostname (non-IP) - non-confident
    const hostnameResult = await profile.findProfile(
      new URL("http://example.com")
    );
    expect(hostnameResult.profile).toBeDefined();
    expect(hostnameResult.isConfident).toBe(false);

    // Missing profile in rule - skips and uses default
    expect(
      (await profile.findProfile(new URL("https://test.404.com"))).profile
    ).toBeDefined();

    // Disabled rule - skipped
    const autoWithDisabled: ProfileAutoSwitch = {
      profileID: "autoDisabled",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [
        {
          type: "disabled",
          condition: "*.example.com",
          profileID: "simpleProxy",
        },
        { type: "domain", condition: "*.test.com", profileID: "simpleProxy" },
      ],
      defaultProfileID: "direct",
    };
    const disabledProfile = new ProfileConverter(
      autoWithDisabled,
      profileLoader
    );
    expect(
      (await disabledProfile.findProfile(new URL("https://test.example.com")))
        .profile
    ).toBeDefined();

    // Missing default profile - falls back to DIRECT
    const autoMissingDefault: ProfileAutoSwitch = {
      profileID: "autoMissingDefault",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [],
      defaultProfileID: "missing-default",
    };
    const missingDefaultProfile = new ProfileConverter(
      autoMissingDefault,
      profileLoader
    );
    const result = await missingDefaultProfile.findProfile(
      new URL("https://other.com")
    );
    expect(result.profile).toBeDefined();
    expect((await result.profile!.toProxyConfig()).mode).toBe("direct");
  });

  test("nested auto profiles work correctly", async () => {
    const profile = new ProfileConverter(profiles.autoProxy2, profileLoader);
    const result = await profile.findProfile(
      new URL("https://test.example.com")
    );

    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(true);
  });

  test("first matching rule wins", async () => {
    const autoMultiple: ProfileAutoSwitch = {
      profileID: "autoMultiple",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [
        {
          type: "domain",
          condition: "*.example.com",
          profileID: "simpleProxy",
        },
        { type: "domain", condition: "*.example.com", profileID: "pacProxy" },
      ],
      defaultProfileID: "direct",
    };

    const profile = new ProfileConverter(autoMultiple, profileLoader);
    const result = await profile.findProfile(
      new URL("https://test.example.com")
    );

    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(true);
  });
});
