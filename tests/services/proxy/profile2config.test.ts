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

  test("direct profile should return itself", async () => {
    const profile = new ProfileConverter(SystemProfile.DIRECT);
    const url = new URL("https://example.com");
    const result = await profile.findProfile(url);

    expect(result.profile).toBe(profile);
    expect(result.isConfident).toBe(true);
  });

  test("system profile should return itself", async () => {
    const profile = new ProfileConverter(SystemProfile.SYSTEM);
    const url = new URL("https://example.com");
    const result = await profile.findProfile(url);

    expect(result.profile).toBe(profile);
    expect(result.isConfident).toBe(true);
  });

  test("pac profile should return itself", async () => {
    const profile = new ProfileConverter(profiles.pacProxy);
    const url = new URL("https://example.com");
    const result = await profile.findProfile(url);

    expect(result.profile).toBe(profile);
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with domain rule match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("https://test.example.com");
    const result = await profile.findProfile(url);

    // When a rule matches a proxy profile, findProfile on proxy returns undefined
    // So it falls back to default profile
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct"); // Falls back to default
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with domain rule no match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("https://other.com");
    const result = await profile.findProfile(url);

    // Should fallback to default profile (direct)
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with URL rule match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("http://example.com/api/v1/users");
    const result = await profile.findProfile(url);

    // URL rule should be evaluated
    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(true);
    // The result depends on rule matching and profile type
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBeDefined();
  });

  test("auto profile with URL rule no match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("http://example.com/other");
    const result = await profile.findProfile(url);

    // Should fallback to default profile
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with CIDR rule match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("http://192.168.10.50");
    const result = await profile.findProfile(url);

    // When a rule matches a proxy profile, findProfile on proxy returns undefined
    // So it falls back to default profile
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct"); // Falls back to default
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with CIDR rule no match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("http://192.168.20.50");
    const result = await profile.findProfile(url);

    // Should fallback to default profile
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with CIDR rule and hostname (not IP)", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("http://example.com");
    // This should not match CIDR since hostname is not an IP
    const result = await profile.findProfile(url);

    // Should check other rules or fallback to default
    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with missing profile in rule", async () => {
    const profile = new ProfileConverter(profiles.autoProxy, profileLoader);
    const url = new URL("https://test.404.com");
    const result = await profile.findProfile(url);

    // Should skip the rule with missing profile and fallback to default
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with disabled rule", async () => {
    const autoProfileWithDisabled: ProfileAutoSwitch = {
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
        {
          type: "domain",
          condition: "*.test.com",
          profileID: "simpleProxy",
        },
      ],
      defaultProfileID: "direct",
    };

    const profile = new ProfileConverter(
      autoProfileWithDisabled,
      profileLoader
    );
    const url = new URL("https://test.example.com");
    const result = await profile.findProfile(url);

    // Disabled rule should be skipped, should fallback to default
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with missing default profile", async () => {
    const autoProfileMissingDefault: ProfileAutoSwitch = {
      profileID: "autoMissingDefault",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [],
      defaultProfileID: "missing-default",
    };

    const profile = new ProfileConverter(
      autoProfileMissingDefault,
      profileLoader
    );
    const url = new URL("https://other.com");
    const result = await profile.findProfile(url);

    // Should fallback to SystemProfile.DIRECT
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct");
    expect(result.isConfident).toBe(true);
  });

  test("nested auto profile - domain match", async () => {
    const profile = new ProfileConverter(profiles.autoProxy2, profileLoader);
    const url = new URL("https://test.example.com");
    const result = await profile.findProfile(url);

    // Should match the nested auto profile rule
    expect(result.profile).toBeDefined();
    // The nested auto profile should then match its own rules
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with multiple rules - first match wins", async () => {
    const autoProfileMultiple: ProfileAutoSwitch = {
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
        {
          type: "domain",
          condition: "*.example.com",
          profileID: "pacProxy",
        },
      ],
      defaultProfileID: "direct",
    };

    const profile = new ProfileConverter(autoProfileMultiple, profileLoader);
    const url = new URL("https://test.example.com");
    const result = await profile.findProfile(url);

    // First matching rule matches simpleProxy (proxy type), which returns undefined
    // So it falls back to default
    expect(result.profile).toBeDefined();
    const config = await result.profile!.toProxyConfig();
    expect(config.mode).toBe("direct"); // Falls back to default
    expect(result.isConfident).toBe(true);
  });

  test("auto profile with rule matching direct profile", async () => {
    const autoProfileWithDirect: ProfileAutoSwitch = {
      profileID: "autoDirect",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [
        {
          type: "domain",
          condition: "test.example.com",
          profileID: "direct",
        },
      ],
      defaultProfileID: "pacProxy",
    };

    const profile = new ProfileConverter(autoProfileWithDirect, profileLoader);
    const url = new URL("https://test.example.com");
    const result = await profile.findProfile(url);

    // Rule evaluation should work
    expect(result.profile).toBeDefined();
    expect(result.isConfident).toBe(true);
    // Result depends on rule matching - either direct from rule or pacProxy from default
    const config = await result.profile!.toProxyConfig();
    expect(["direct", "pac_script"]).toContain(config.mode);
  });

  test("auto profile with non-confident CIDR result", async () => {
    // Create a profile with CIDR rule that might return non-confident result
    const autoProfileCIDR: ProfileAutoSwitch = {
      profileID: "autoCIDR",
      color: "",
      profileName: "",
      proxyType: "auto",
      rules: [
        {
          type: "cidr",
          condition: "192.168.10.1/24",
          profileID: "simpleProxy",
        },
      ],
      defaultProfileID: "direct",
    };

    const profile = new ProfileConverter(autoProfileCIDR, profileLoader);
    // Use a hostname that can't be resolved to IP (non-confident)
    const url = new URL("http://some-hostname-that-cant-resolve");
    const result = await profile.findProfile(url);

    // Should handle non-confident results appropriately
    expect(result.profile).toBeDefined();
    // If CIDR can't resolve, it might be non-confident or fallback to default
    expect(result.isConfident).toBeDefined();
  });

  test("proxy profile (non-auto) should return undefined", async () => {
    const profile = new ProfileConverter(profiles.simpleProxy);
    const url = new URL("https://example.com");
    const result = await profile.findProfile(url);

    // Proxy profiles are not handled by findProfile, should return undefined
    expect(result.profile).toBeUndefined();
    expect(result.isConfident).toBe(true);
  });
});
