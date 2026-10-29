import { describe, expect, test } from "vitest";
import type { ProxyProfile } from "@/services/profile";
import { SystemProfile } from "@/services/profile";
import {
  PAYLOAD_SCHEMA,
  canonicalJSON,
  collectLocalRecords,
  decodeRemote,
  type ProfilePayload,
  hashPayload,
  isValidPrefValue,
  mergeIncomingProfile,
  normalizeProfile,
  parseRecordID,
  prefRecordID,
  profileRecordID,
} from "@/services/sync/records";

const proxy: ProxyProfile = {
  profileID: "p1",
  profileName: "Office",
  color: "#abcdef",
  proxyType: "proxy",
  proxyRules: {
    default: {
      scheme: "http",
      host: "proxy.example",
      port: 8080,
      auth: { username: "u", password: "secret" },
    },
    bypassList: ["localhost"],
  },
};

const pacURL: ProxyProfile = {
  profileID: "pac1",
  profileName: "Corp PAC",
  color: "#112233",
  proxyType: "pac",
  pacScript: {
    sourceURL: "https://corp.example/proxy.pac",
    data: "function FindProxyForURL(){return 'DIRECT'}",
    refreshIntervalMinutes: 30,
    lastFetched: 1700000000000,
    lastError: "timeout",
  },
};

const pacInline: ProxyProfile = {
  profileID: "pac2",
  profileName: "Inline",
  color: "#445566",
  proxyType: "pac",
  pacScript: { data: "function FindProxyForURL(){return 'DIRECT'}" },
};

describe("record IDs", () => {
  test("name profiles and synced prefs", () => {
    expect(profileRecordID("p1")).toBe("profile:p1");
    expect(prefRecordID("ui.language")).toBe("pref:ui.language");
    expect(parseRecordID("profile:a:b")).toEqual({
      kind: "profile",
      profileID: "a:b",
    });
    expect(parseRecordID("pref:theme.darkmode")).toEqual({
      kind: "pref",
      key: "theme.darkmode",
    });
    expect(parseRecordID("pref:active-profile")).toBeUndefined();
    expect(parseRecordID("profile:")).toBeUndefined();
    expect(parseRecordID("other:x")).toBeUndefined();
  });

  test("the payload schema is the config format", () => {
    expect(PAYLOAD_SCHEMA).toBe("2025-01");
  });
});

describe("pref payloads", () => {
  test.each([
    ["theme.darkmode", 0, true],
    ["theme.darkmode", 2, true],
    ["theme.darkmode", 3, false],
    ["theme.darkmode", "1", false],
    ["ui.language", "auto", true],
    ["ui.language", "pt_BR", true],
    ["ui.language", "fil", true],
    ["ui.language", "pt-BR", false],
    ["ui.language", "EN", false],
    ["ui.actionBehavior", "sidebar", true],
    ["ui.actionBehavior", "tab", false],
    ["ui.failureBadge", false, true],
    ["ui.failureBadge", "off", false],
  ] as const)("%s = %j valid: %s", (key, value, valid) => {
    expect(isValidPrefValue(key, value)).toBe(valid);
  });

  test("decodes valid remote prefs only", () => {
    expect(decodeRemote("pref:ui.language", { value: "zh_CN" })).toEqual({
      value: "zh_CN",
    });
    expect(
      decodeRemote("pref:ui.language", { value: "zh_CN", x: 1 })
    ).toEqual({ value: "zh_CN" });
    expect(decodeRemote("pref:ui.language", { value: 1 })).toBeUndefined();
    expect(decodeRemote("pref:ui.language", null)).toBeUndefined();
    expect(decodeRemote("pref:other", { value: 1 })).toBeUndefined();
    expect(decodeRemote("profile:p1", { value: 1 })).toBeUndefined();
  });
});

describe("normalizeProfile", () => {
  test("upper-cases the color and keeps credentials", () => {
    const payload = normalizeProfile(proxy);
    expect(payload).toMatchObject({ color: "#ABCDEF", profileID: "p1" });
    expect(payload).toHaveProperty("proxyRules.default.auth.password", "secret");
  });

  test("drops runtime fields and the fetched script of a PAC URL", () => {
    expect(normalizeProfile(pacURL)).toEqual({
      profileID: "pac1",
      profileName: "Corp PAC",
      color: "#112233",
      proxyType: "pac",
      pacScript: {
        sourceURL: "https://corp.example/proxy.pac",
        refreshIntervalMinutes: 30,
      },
    });
  });

  test("keeps an inline PAC script", () => {
    expect(normalizeProfile(pacInline)).toHaveProperty(
      "pacScript.data",
      "function FindProxyForURL(){return 'DIRECT'}"
    );
  });

  test("never mutates its input", () => {
    const before = JSON.stringify([proxy, pacURL]);
    const payload = normalizeProfile(proxy)!;
    normalizeProfile(pacURL);
    if (payload.proxyType === "proxy") payload.proxyRules.bypassList.push("x");
    expect(JSON.stringify([proxy, pacURL])).toBe(before);
  });

  test("rejects system and invalid profiles", () => {
    expect(normalizeProfile(SystemProfile.DIRECT)).toBeUndefined();
    expect(
      normalizeProfile({ ...proxy, color: "red" } as ProxyProfile)
    ).toBeUndefined();
  });
});

describe("hashing", () => {
  test("canonical JSON sorts keys at every level, without whitespace", () => {
    expect(
      canonicalJSON({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" }, u: undefined })
    ).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJSON({ 10: 1, 9: 2, a: 3 })).toBe('{"10":1,"9":2,"a":3}');
    expect(canonicalJSON([undefined, null, "é"])).toBe('[null,null,"é"]');
  });

  test("equal payloads hash the same, whatever the key order", async () => {
    const a = await hashPayload({ x: 1, y: [1, 2] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPayload({ y: [1, 2], x: 1 })).toBe(a);
    expect(await hashPayload({ y: [2, 1], x: 1 })).not.toBe(a);
  });

  test("hashes the canonical JSON with SHA-256", async () => {
    // printf '{"a":1,"b":2}' | shasum -a 256
    expect(await hashPayload({ b: 2, a: 1 })).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    );
  });
});

describe("decodeRemote (profiles)", () => {
  test("validates and normalizes a remote payload", () => {
    expect(
      decodeRemote("profile:pac1", { ...pacURL, color: "#aabbcc" })
    ).toEqual(normalizeProfile({ ...pacURL, color: "#AABBCC" }));
  });

  test("requires the profile ID of the record", () => {
    expect(decodeRemote("profile:other", proxy)).toBeUndefined();
    expect(decodeRemote("pref:ui.language", proxy)).toBeUndefined();
  });

  test("rejects invalid payloads and system profiles", () => {
    expect(
      decodeRemote("profile:p1", { ...proxy, proxyType: "nope" })
    ).toBeUndefined();
    expect(decodeRemote("profile:p1", null)).toBeUndefined();
    expect(
      decodeRemote("profile:direct", SystemProfile.DIRECT)
    ).toBeUndefined();
  });
});

describe("mergeIncomingProfile", () => {
  const remote = normalizeProfile(pacURL)!;

  test("keeps the fetched script when the PAC URL is unchanged", () => {
    expect(mergeIncomingProfile(remote, pacURL)).toEqual({
      ...remote,
      pacScript: {
        ...(remote.proxyType === "pac" ? remote.pacScript : {}),
        data: pacURL.proxyType === "pac" ? pacURL.pacScript.data : "",
        lastFetched: 1700000000000,
        lastError: "timeout",
      },
    });
  });

  test("leaves the script to fetch when the PAC URL changed", () => {
    const moved = {
      ...pacURL,
      pacScript: { sourceURL: "https://old/", data: "old script" },
    } as ProxyProfile;
    const merged = mergeIncomingProfile(remote, moved);
    expect(merged).toEqual(remote);
    expect(merged).not.toHaveProperty("pacScript.data");
  });

  test("takes the remote as-is otherwise", () => {
    const p = normalizeProfile(proxy)!;
    expect(mergeIncomingProfile(p, pacURL)).toEqual(p);
    expect(mergeIncomingProfile(remote)).toEqual(remote);
    // a copy: storing it doesn't alias the payload
    expect(mergeIncomingProfile(p)).not.toBe(p);
  });
});

describe("collectLocalRecords", () => {
  const profiles = {
    p1: proxy,
    pac1: pacURL,
    local: { ...proxy, profileID: "local" },
    bad: { ...proxy, profileID: "bad", color: "nope" },
    direct: SystemProfile.DIRECT,
    mismatched: { ...proxy, profileID: "elsewhere" },
  } as Record<string, ProxyProfile>;
  const prefs = {
    "theme.darkmode": 1,
    "ui.language": "not a language",
    "ui.actionBehavior": "sidebar",
    "ui.failureBadge": false,
  };

  test("collects synced profiles and valid prefs, with their hashes", async () => {
    const records = await collectLocalRecords({
      profiles,
      prefs,
      localOnly: ["local"],
      syncPrefs: true,
    });
    expect([...records.keys()].sort()).toEqual([
      "pref:theme.darkmode",
      "pref:ui.actionBehavior",
      "pref:ui.failureBadge",
      "profile:p1",
      "profile:pac1",
    ]);
    const pac = records.get("profile:pac1")!;
    expect(pac.payload).toEqual(normalizeProfile(pacURL));
    expect(pac.hash).toBe(await hashPayload(pac.payload));
    expect(records.get("pref:theme.darkmode")?.payload).toEqual({ value: 1 });
  });

  test("leaves prefs out when they don't sync", async () => {
    const records = await collectLocalRecords({
      profiles: {},
      prefs,
      localOnly: [],
      syncPrefs: false,
    });
    expect(records.size).toBe(0);
  });

  test("a stored remote profile hashes like the remote payload", async () => {
    const remote = decodeRemote("profile:pac1", pacURL) as ProfilePayload;
    const stored = mergeIncomingProfile(remote, pacURL);
    const records = await collectLocalRecords({
      profiles: { pac1: stored },
      prefs: {},
      localOnly: [],
      syncPrefs: true,
    });
    expect(records.get("profile:pac1")?.hash).toBe(await hashPayload(remote));
  });
});
