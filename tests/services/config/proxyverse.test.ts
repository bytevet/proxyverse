import { exportConfig, importConfig } from "@/services/config";
import { ProxyProfile, SystemProfile } from "@/services/profile";
import { expect, test, describe } from "vitest";

const mockInnerConfig: Record<
  string,
  ProxyProfile & {
    [key: string]: any; // Index signature to allow additional properties
  }
> = {
  "90750184-fb8f-4130-ad83-c997a7207300": {
    color: "#DCF190",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
      lastFetched: 1700000000000,
      lastError: "HTTP 500",
    },
    profileID: "90750184-fb8f-4130-ad83-c997a7207300",
    profileName: "PAC Script",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "pac",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "ac8eeebe-3a13-4969-881c-3c7419e91f95": {
    color: "#93BEFF",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
    profileName: "HTTP",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "localhost",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "proxy",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "bd4a7580-2c03-4465-acae-bde628ffbb16": {
    color: "#FBB0A7",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "bd4a7580-2c03-4465-acae-bde628ffbb16",
    profileName: "HTTP (with Auth)",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        auth: {
          password: "securepassword",
          username: "admin",
        },
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "proxy",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "direct",
        type: "url",
      },
    ],
  },
  "fb29f908-a284-4dca-b7e5-c606e6b3c2f1": {
    color: "#3491FA",
    defaultProfileID: "direct",
    pacScript: {
      data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
    },
    profileID: "fb29f908-a284-4dca-b7e5-c606e6b3c2f1",
    profileName: "Auto Switch",
    proxyRules: {
      bypassList: ["<local>", "127.0.0.1", "[::1]"],
      default: {
        host: "127.0.0.1",
        port: 8080,
        scheme: "http",
      },
    },
    proxyType: "auto",
    rules: [
      {
        condition: "example.com",
        profileID: "direct",
        type: "domain",
      },
      {
        condition: "http://example.com/api/*",
        profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
        type: "url",
      },
    ],
  },
};

const mockExportedJSON = {
  version: "2025-01",
  profiles: [
    {
      color: "#DCF190",
      profileID: "90750184-fb8f-4130-ad83-c997a7207300",
      profileName: "PAC Script",
      pacScript: {
        data: "function FindProxyForURL(url, host) {\n  // …\n  return 'DIRECT';\n}",
      },
      proxyType: "pac",
    },
    {
      color: "#93BEFF",
      profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
      profileName: "HTTP",
      proxyRules: {
        bypassList: ["<local>", "127.0.0.1", "[::1]"],
        default: {
          host: "localhost",
          scheme: "http",
          port: 8080,
        },
      },
      proxyType: "proxy",
    },
    {
      color: "#FBB0A7",
      profileID: "bd4a7580-2c03-4465-acae-bde628ffbb16",
      profileName: "HTTP (with Auth)",
      proxyRules: {
        bypassList: ["<local>", "127.0.0.1", "[::1]"],
        default: {
          host: "127.0.0.1",
          scheme: "http",
          port: 8080,
          auth: {
            username: "admin",
            password: "securepassword",
          },
        },
      },
      proxyType: "proxy",
    },
    {
      color: "#3491FA",
      profileID: "fb29f908-a284-4dca-b7e5-c606e6b3c2f1",
      profileName: "Auto Switch",
      defaultProfileID: "direct",
      proxyType: "auto",
      rules: [
        {
          type: "domain",
          condition: "example.com",
          profileID: "direct",
        },
        {
          type: "url",
          condition: "http://example.com/api/*",
          profileID: "ac8eeebe-3a13-4969-881c-3c7419e91f95",
        },
      ],
    },
  ],
};

const mockJSONToBeImported = {
  version: "2025-01",
  profiles: [
    {
      color: "#FBB0A7",
      profileID: "bd4a7580-2c03-4465-acae-bde628ffbb16",
      profileName: "HTTP (with Auth)",
      proxyRules: {
        bypassList: ["<local>", "127.0.0.1", "[::1]"],
        default: {
          host: "127.0.0.1",
          scheme: "http",
          port: 8080,
          auth: {
            username: "admin",
            password: "securepassword",
          },
        },
      },
      proxyType: "proxy",

      // additional properties
      dummy: "dummy",
    },
  ],
};

const mockJSONToBeImportedWithError = {
  version: "2025-01",
  profiles: [
    {
      color: "#FBB0A7",
      profileID: "bd4a7580-2c03-4465-acae-bde628ffbb16",
      profileName: "HTTP (with Auth)",
      proxyRules: {
        bypassList: ["<local>", "127.0.0.1", "[::1]"],
        default: {
          host: "127.0.0.1",
          scheme: "http",
          port: 65536, // invalid port
          auth: {
            username: "admin",
            password: "securepassword",
          },
        },
      },
      proxyType: "proxy",
    },
  ],
};

const importJSON = (obj: unknown) => importConfig(JSON.stringify(obj), {});

describe("exporting config", () => {
  test("exports the profile fields only", () => {
    const { json, count, skipped } = exportConfig(mockInnerConfig);

    expect(JSON.parse(json)).toEqual(mockExportedJSON);
    expect(count).toBe(mockExportedJSON.profiles.length);
    expect(skipped).toEqual([]);
  });

  test("leaves out invalid profiles and names them", () => {
    const [first] = Object.values(mockInnerConfig);
    expect(exportConfig({}).count).toBe(0);

    const { json, count, skipped } = exportConfig({
      ...mockInnerConfig,
      bad: { ...first, profileID: "bad", profileName: "Bad", color: "red" },
    });
    expect(count).toBe(mockExportedJSON.profiles.length);
    expect(skipped).toEqual(["Bad"]);
    expect(JSON.parse(json)).toEqual(mockExportedJSON);
  });

  test("an export imports back unchanged", async () => {
    const { json } = exportConfig(mockInnerConfig);
    const { profiles, warnings } = await importConfig(json, {});
    expect(profiles).toEqual(mockExportedJSON.profiles);
    expect(warnings).toEqual([]);
  });
});

describe("importing config", () => {
  test("rejects malformed JSON", async () => {
    await expect(importConfig("{blah", {})).rejects.toThrow(
      "Invalid config data"
    );
  });

  test("rejects unrecognized files", async () => {
    await expect(importConfig("{}", {})).rejects.toThrow(
      "Unrecognized config file"
    );
  });

  test("rejects unknown versions", async () => {
    await expect(
      importJSON({ version: "2099-01", profiles: [] })
    ).rejects.toThrow(/Unsupported config file/);
  });

  test("imports profiles, dropping unknown fields", async () => {
    const { profiles, warnings } = await importJSON(mockJSONToBeImported);
    expect(warnings).toEqual([]);

    const expectedProfile: any = { ...mockJSONToBeImported.profiles[0] };
    delete expectedProfile.dummy;
    expect(profiles).toEqual([expectedProfile]);
  });

  test("skips an invalid profile and keeps the others", async () => {
    const { profiles, warnings } = await importJSON({
      version: "2025-01",
      profiles: [
        ...mockJSONToBeImportedWithError.profiles,
        ...mockExportedJSON.profiles,
      ],
    });

    expect(profiles).toHaveLength(mockExportedJSON.profiles.length);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      profileName: "HTTP (with Auth)",
      key: "import_warn_invalid_profile",
    });
    expect(warnings[0].args![0]).toMatch(/^proxyRules\.default\.port: /);
  });

  test("skips reserved and repeated profile IDs", async () => {
    const [proxy] = mockExportedJSON.profiles.filter(
      (p) => p.proxyType === "proxy"
    );
    const { profiles, warnings } = await importJSON({
      version: "2025-01",
      profiles: [
        { ...proxy, profileID: "direct" },
        proxy,
        { ...proxy, profileName: "Again" },
      ],
    });

    expect(profiles).toEqual([proxy]);
    expect(warnings).toEqual([
      {
        profileName: proxy.profileName,
        key: "import_warn_reserved_id",
        args: ["direct"],
      },
      {
        profileName: "Again",
        key: "import_warn_duplicate_id",
        args: [proxy.profileID],
      },
    ]);
  });

  test("warns about rules routing to unknown profiles", async () => {
    const auto = {
      color: "#3491FA",
      profileID: "auto",
      profileName: "Auto",
      proxyType: "auto",
      defaultProfileID: "stored",
      rules: [
        { type: "domain", condition: "a.com", profileID: "missing" },
        { type: "domain", condition: "b.com", profileID: "missing" },
        { type: "domain", condition: "c.com", profileID: "direct" },
      ],
    };
    const file = JSON.stringify({ version: "2025-01", profiles: [auto] });

    const stored = { stored: { ...SystemProfile.DIRECT, profileID: "stored" } };
    const { warnings } = await importConfig(file, stored);
    expect(warnings).toEqual([
      {
        profileName: "Auto",
        key: "import_warn_unknown_reference",
        args: ["missing"],
      },
    ]);
  });
});
