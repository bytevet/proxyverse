import { describe, expect, test } from "vitest";
import { importConfig } from "@/services/config";
import { ProxyProfile } from "@/services/profile";
import sample from "./fixtures/zeroomega.bak?raw";

const backup = (profiles: object[], options: object = {}) =>
  JSON.stringify({
    schemaVersion: 2,
    "-downloadInterval": 1440,
    ...options,
    ...Object.fromEntries(profiles.map((p: any) => ["+" + p.name, p])),
  });

const byName = (profiles: ProxyProfile[], name: string) => {
  const p = profiles.find((p) => p.profileName === name);
  if (!p) throw Error(`no profile ${name}`);
  return p;
};

describe("ZeroOmega backup", () => {
  test("imports the sample backup", async () => {
    const { profiles, warnings } = await importConfig(sample, {});
    expect(warnings).toEqual([]);
    expect(profiles).toHaveLength(2);

    const proxy = byName(profiles, "proxy");
    expect(proxy).toEqual({
      profileID: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      profileName: "proxy",
      color: "#99CCEE",
      proxyType: "proxy",
      proxyRules: {
        default: { scheme: "http", host: "proxy.example.com", port: 8080 },
        bypassList: ["127.0.0.1", "::1", "localhost"],
      },
    });

    expect(byName(profiles, "auto switch")).toEqual({
      profileID: expect.any(String),
      profileName: "auto switch",
      color: "#99DD99",
      proxyType: "auto",
      defaultProfileID: "direct",
      rules: [
        { type: "domain", condition: "internal.example.com", profileID: "direct" },
        { type: "domain", condition: "example.com", profileID: proxy.profileID },
        { type: "domain", condition: "*.example.com", profileID: proxy.profileID },
      ],
    });
  });

  test("profile IDs are stable across imports", async () => {
    const a = await importConfig(sample, {});
    const b = await importConfig(sample, {});
    expect(a.profiles.map((p) => p.profileID)).toEqual(
      b.profiles.map((p) => p.profileID)
    );
    expect(new Set(a.profiles.map((p) => p.profileID)).size).toBe(2);
  });

  test("accepts a base64-encoded backup", async () => {
    const { profiles } = await importConfig(btoa(sample), {});
    expect(profiles).toEqual((await importConfig(sample, {})).profiles);
  });

  test("rejects unknown schema versions", async () => {
    await expect(
      importConfig(JSON.stringify({ schemaVersion: 9, "-x": 1 }), {})
    ).rejects.toThrow(/Unsupported SwitchyOmega backup version/);
  });
});

describe("profiles", () => {
  test("fixed profile with per-scheme servers and auth", async () => {
    const { profiles, warnings } = await importConfig(
      backup([
        {
          name: "fixed",
          profileType: "FixedProfile",
          color: "#123abc",
          proxyForHttp: { scheme: "http", host: "h.example", port: 80 },
          proxyForHttps: { scheme: "https", host: "s.example", port: 443 },
          proxyForFtp: { scheme: "socks4", host: "f.example", port: 1080 },
          bypassList: [
            { conditionType: "BypassCondition", pattern: "<local>" },
            { conditionType: "BypassCondition", pattern: ".local.test" },
            { conditionType: "BypassCondition", pattern: "10.0.0.0/8" },
            { conditionType: "BypassCondition", pattern: "[::1]" },
            { conditionType: "BypassCondition", pattern: "http://x.test" },
            { conditionType: "BypassCondition", pattern: "x.test:8080" },
          ],
          auth: {
            proxyForHttp: { username: "u", password: "p" },
            all: { username: "any", password: "pw" },
          },
        },
      ]),
      {}
    );

    expect(profiles).toEqual([
      {
        profileID: expect.any(String),
        profileName: "fixed",
        color: "#123ABC",
        proxyType: "proxy",
        proxyRules: {
          // no fallback proxy: other schemes go direct
          default: { scheme: "direct", host: "" },
          http: {
            scheme: "http",
            host: "h.example",
            port: 80,
            auth: { username: "u", password: "p" },
          },
          https: {
            scheme: "https",
            host: "s.example",
            port: 443,
            auth: { username: "any", password: "pw" },
          },
          ftp: {
            scheme: "socks4",
            host: "f.example",
            port: 1080,
            auth: { username: "any", password: "pw" },
          },
          bypassList: ["<local>", "*.local.test", "10.0.0.0/8", "::1"],
        },
      },
    ]);
    expect(warnings).toEqual([
      { profileName: "fixed", key: "import_warn_bypass_dropped", args: ["http://x.test"] },
      { profileName: "fixed", key: "import_warn_bypass_dropped", args: ["x.test:8080"] },
    ]);
  });

  test("PAC profiles", async () => {
    const { profiles, warnings } = await importConfig(
      backup(
        [
          {
            name: "remote",
            profileType: "PacProfile",
            pacUrl: "https://pac.example/proxy.pac",
            pacScript: "function FindProxyForURL(){return 'PROXY a:1'}",
            auth: { all: { username: "u", password: "p" } },
          },
          {
            name: "file",
            profileType: "PacProfile",
            pacUrl: "file:///etc/proxy.pac",
            pacScript: "function FindProxyForURL(){return 'DIRECT'}",
          },
          { name: "inline", profileType: "PacProfile", pacScript: "x" },
        ],
        { "-downloadInterval": 100 }
      ),
      {}
    );

    expect(byName(profiles, "remote")).toMatchObject({
      proxyType: "pac",
      pacScript: {
        sourceURL: "https://pac.example/proxy.pac",
        data: "function FindProxyForURL(){return 'PROXY a:1'}",
        refreshIntervalMinutes: 60, // nearest option to 100
      },
    });
    expect(byName(profiles, "file")).toMatchObject({
      pacScript: { sourceURL: undefined, data: "function FindProxyForURL(){return 'DIRECT'}" },
    });
    expect(byName(profiles, "inline")).toMatchObject({
      pacScript: { data: "x", sourceURL: undefined },
    });
    expect(warnings.map((w) => [w.profileName, w.key])).toEqual([
      ["remote", "import_warn_pac_auth_dropped"],
      ["file", "import_warn_pac_file_url"],
    ]);
  });

  test("switch profile with every condition type", async () => {
    const cond = (conditionType: string, extra: object) => ({
      condition: { conditionType, ...extra },
      profileName: "fixed",
    });
    const { profiles, warnings } = await importConfig(
      backup([
        {
          name: "fixed",
          profileType: "FixedProfile",
          fallbackProxy: { scheme: "socks5", host: "s.example", port: 1080 },
          bypassList: [],
        },
        {
          name: "switch",
          profileType: "SwitchProfile",
          defaultProfileName: "missing",
          rules: [
            cond("HostWildcardCondition", { pattern: "**.a.test|b.test" }),
            cond("HostWildcardCondition", { pattern: ".c.test" }),
            cond("UrlWildcardCondition", { pattern: "https://d.test/*" }),
            cond("KeywordCondition", { pattern: "e-word" }),
            cond("HostRegexCondition", { pattern: "^(www\\.)?f\\.test$" }),
            cond("UrlRegexCondition", { pattern: "^https?://g\\.test/" }),
            cond("HostRegexCondition", { pattern: "^h[0-9]+\\.test$" }),
            cond("UrlRegexCondition", { pattern: "^http://[a-z]+\\.test/(" }),
            cond("IpCondition", { ip: "192.168.0.0", prefixLength: 16 }),
            cond("BypassCondition", { pattern: "*.i.test" }),
            cond("HostLevelsCondition", { minValue: 1, maxValue: 2 }),
            cond("WeekdayCondition", { days: "-MTWTF-" }),
            cond("TimeCondition", { startHour: 9, endHour: 17 }),
            cond("TrueCondition", {}),
            cond("FalseCondition", { pattern: "j.test" }),
            { ...cond("HostWildcardCondition", { pattern: "k.test" }), profileName: "gone" },
          ],
        },
      ]),
      {}
    );

    const fixed = byName(profiles, "fixed").profileID;
    const sw = byName(profiles, "switch");
    expect(sw.proxyType === "auto" && sw.defaultProfileID).toBe("direct");
    expect(sw.proxyType === "auto" && sw.rules).toEqual(
      [
        ["domain", "*.a.test"],
        ["domain", "b.test"],
        ["domain", "c.test"],
        ["domain", "*.c.test"],
        ["url", "https://d.test/*"],
        ["url", "http://*e-word*"],
        ["domain", "f.test"],
        ["domain", "www.f.test"],
        ["regex", "^https?://g\\.test/"],
        ["disabled", "HostRegex: ^h[0-9]+\\.test$"],
        ["disabled", "UrlRegex: ^http://[a-z]+\\.test/("],
        ["cidr", "192.168.0.0/16"],
        ["domain", "*.i.test"],
        ["disabled", "HostLevels: 1~2"],
        ["disabled", "Weekday: -MTWTF-"],
        ["disabled", "Time: 9~17"],
        ["domain", "*"],
        ["disabled", "j.test"],
        ["domain", "k.test", "direct"],
      ].map(([type, condition, profileID]) => ({
        type,
        condition,
        profileID: profileID ?? fixed,
      }))
    );
    expect(warnings.map((w) => [w.key, ...(w.args ?? [])])).toEqual([
      ["import_warn_unsupported_condition", "HostRegex: ^h[0-9]+\\.test$"],
      ["import_warn_unsupported_condition", "UrlRegex: ^http://[a-z]+\\.test/("],
      ["import_warn_ip_condition", "192.168.0.0/16"],
      ["import_warn_unsupported_condition", "HostLevels: 1~2"],
      ["import_warn_unsupported_condition", "Weekday: -MTWTF-"],
      ["import_warn_unsupported_condition", "Time: 9~17"],
      ["import_warn_unknown_reference", "gone"],
      ["import_warn_unknown_reference", "missing"],
    ]);
  });

  test("an enabled attached rule list is merged into its switch profile", async () => {
    const { profiles, warnings } = await importConfig(
      backup([
        {
          name: "proxy",
          profileType: "FixedProfile",
          fallbackProxy: { scheme: "http", host: "p.example", port: 3128 },
          bypassList: [],
        },
        {
          name: "switch",
          profileType: "SwitchProfile",
          defaultProfileName: "__ruleListOf_switch",
          rules: [
            {
              condition: { conditionType: "HostWildcardCondition", pattern: "a.test" },
              profileName: "direct",
            },
          ],
        },
        {
          name: "__ruleListOf_switch",
          profileType: "RuleListProfile",
          format: "AutoProxy",
          matchProfileName: "proxy",
          defaultProfileName: "direct",
          sourceUrl: "https://example.com/gfwlist.txt",
          ruleList: "[AutoProxy 0.2.9]\n! comment\n||b.test\n@@||c.b.test\n",
        },
      ]),
      {}
    );

    expect(profiles.map((p) => p.profileName).sort()).toEqual(["proxy", "switch"]);
    const proxy = byName(profiles, "proxy").profileID;
    expect(byName(profiles, "switch")).toMatchObject({
      proxyType: "auto",
      defaultProfileID: "direct",
      rules: [
        { type: "domain", condition: "a.test", profileID: "direct" },
        { type: "domain", condition: "c.b.test", profileID: "direct" },
        { type: "domain", condition: "*.c.b.test", profileID: "direct" },
        { type: "domain", condition: "b.test", profileID: proxy },
        { type: "domain", condition: "*.b.test", profileID: proxy },
      ],
    });
    expect(warnings).toEqual([
      {
        profileName: "switch",
        key: "import_warn_rule_list_static",
        args: ["https://example.com/gfwlist.txt"],
      },
    ]);
  });

  test("a disabled attached rule list is left out", async () => {
    const { profiles } = await importConfig(
      backup([
        { name: "switch", profileType: "SwitchProfile", defaultProfileName: "direct", rules: [] },
        {
          name: "__ruleListOf_switch",
          profileType: "RuleListProfile",
          ruleList: "a.test",
        },
      ]),
      {}
    );
    expect(profiles.map((p) => p.profileName)).toEqual(["switch"]);
  });

  test("rule list and virtual profiles", async () => {
    const { profiles } = await importConfig(
      backup([
        {
          name: "list",
          profileType: "SwitchyRuleListProfile",
          matchProfileName: "virtual",
          defaultProfileName: "direct",
          ruleList: "[SwitchyOmega Conditions]\n; comment\na.test\n!b.a.test\nUrlWildcard: *://c.test/*\n",
        },
        { name: "virtual", profileType: "VirtualProfile", defaultProfileName: "auto_detect" },
      ]),
      {}
    );

    const virtual = byName(profiles, "virtual");
    const autoDetect = byName(profiles, "auto_detect");
    expect(virtual).toMatchObject({
      proxyType: "auto",
      rules: [],
      defaultProfileID: autoDetect.profileID,
    });
    expect(autoDetect).toMatchObject({
      proxyType: "pac",
      pacScript: { sourceURL: "http://wpad/wpad.dat" },
    });
    expect(byName(profiles, "list")).toMatchObject({
      rules: [
        { type: "domain", condition: "a.test", profileID: virtual.profileID },
        { type: "domain", condition: "b.a.test", profileID: "direct" },
        { type: "url", condition: "*://c.test/*", profileID: virtual.profileID },
      ],
    });
  });

  test("unknown profile types are skipped", async () => {
    const { profiles, warnings } = await importConfig(
      backup([
        { name: "odd", profileType: "FancyProfile" },
        { name: "virtual", profileType: "VirtualProfile", defaultProfileName: "odd" },
      ]),
      {}
    );
    expect(profiles.map((p) => p.profileName)).toEqual(["virtual"]);
    expect(warnings.map((w) => [w.profileName, w.key])).toEqual([
      ["odd", "import_warn_unknown_profile_type"],
      ["virtual", "import_warn_unknown_reference"],
    ]);
  });
});
