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

describe("PAC profile with sourceURL metadata", () => {
  test("does not leak sourceURL / lastFetched / lastError into ProxyConfig", async () => {
    const profile: ProxyProfile = {
      profileID: "pacUrl",
      color: "",
      profileName: "",
      proxyType: "pac",
      pacScript: {
        data: "function FindProxyForURL(u, h) { return 'DIRECT'; }",
        sourceURL: "https://example.com/proxy.pac",
        lastFetched: 1700000000000,
        lastError: "prior error",
      },
    };

    const converter = new ProfileConverter(profile);
    const cfg = await converter.toProxyConfig();

    expect(cfg.mode).toBe("pac_script");
    expect(cfg.pacScript?.data).toBe(
      "function FindProxyForURL(u, h) { return 'DIRECT'; }"
    );
    // Chrome's native PacScript type only has `data` and `url` — make sure
    // our bookkeeping fields don't bleed through.
    expect(Object.keys(cfg.pacScript ?? {})).toEqual(["data"]);
  });

  test("handles empty data gracefully when only sourceURL is set", async () => {
    const profile: ProxyProfile = {
      profileID: "pacUrlOnly",
      color: "",
      profileName: "",
      proxyType: "pac",
      pacScript: {
        sourceURL: "https://example.com/proxy.pac",
      },
    };

    const converter = new ProfileConverter(profile);
    const cfg = await converter.toProxyConfig();

    expect(cfg.mode).toBe("pac_script");
    expect(cfg.pacScript?.data).toBe("");
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

  test("auto profile matches domain rule", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const result = await profile.findProfile(
      new URL("https://test.example.com"),
    );
    expect(result.profile?.profile.profileID).toBe("simpleProxy");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile matches url rule", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const result = await profile.findProfile(
      new URL("http://example.com/api/v1/users"),
    );
    expect(result.profile?.profile.profileID).toBe("pacProxy");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile matches cidr rule with IP", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const result = await profile.findProfile(new URL("http://192.168.10.50"));
    expect(result.profile?.profile.profileID).toBe("simpleProxy");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile falls back to default when no rule matches", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    // Use an IP that doesn't match any domain/URL/CIDR rule
    const result = await profile.findProfile(new URL("http://10.0.0.1"));
    expect(result.profile?.profile.profileID).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("CIDR rule returns non-confident for hostname (no DNS in extension)", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    // hostname can't be resolved to IP in extension context, so CIDR
    // evaluation returns UNKNOWN → result is non-confident
    const result = await profile.findProfile(new URL("http://unknown-host.org"));
    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(false);
  });

  test("auto profile skips rules with missing profiles", async () => {
    // Create an auto profile where the only matching rule has a missing profile,
    // and no CIDR rules to avoid DNS-resolution ambiguity
    const autoMissing: ProfileAutoSwitch = {
      profileID: "autoMissing",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [
        { type: "domain", condition: "*.404.com", profileID: "non-exists" },
      ],
      defaultProfileID: "direct",
    };
    const profile = new ProfileConverter(autoMissing, profileLoader);
    const result = await profile.findProfile(new URL("https://test.404.com"));
    expect(result.profile?.profile.profileID).toBe("direct");
  });

  test("auto profile skips disabled rules", async () => {
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
      new URL("https://test.example.com"),
    );

    expect(result.profile?.profile.profileID).toBe("simpleProxy");
    expect(result.isConfident).toBe(true);
  });
});
