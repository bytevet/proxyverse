import { expect, test, describe } from "vitest";
import type { ProfilesStorage, ProxyProfile } from "@/services/profile";
import { isProfileTreeChanged, profileTreeIDs } from "@/services/proxy";

const proxy = (profileID: string, host = "127.0.0.1"): ProxyProfile => ({
  profileID,
  color: "",
  profileName: profileID,
  proxyType: "proxy",
  proxyRules: { default: { host, port: 8080 }, bypassList: [] },
});

const pac = (profileID: string, data: string): ProxyProfile => ({
  profileID,
  color: "",
  profileName: profileID,
  proxyType: "pac",
  pacScript: { data },
});

const profiles = (): ProfilesStorage => ({
  auto: {
    profileID: "auto",
    color: "",
    profileName: "auto",
    proxyType: "auto",
    defaultProfileID: "fallback",
    rules: [
      { type: "domain", condition: "a.com", profileID: "nested" },
      { type: "disabled", condition: "b.com", profileID: "unused" },
      { type: "domain", condition: "c.com", profileID: "direct" },
    ],
  },
  nested: {
    profileID: "nested",
    color: "",
    profileName: "nested",
    proxyType: "auto",
    defaultProfileID: "auto", // cycle
    rules: [{ type: "url", condition: "*", profileID: "pacSub" }],
  },
  pacSub: pac("pacSub", "return 'DIRECT';"),
  fallback: proxy("fallback"),
  unused: proxy("unused"),
  other: proxy("other"),
});

describe("profileTreeIDs", () => {
  test("walks nested auto profiles, skipping disabled rules", () => {
    expect(profileTreeIDs("auto", profiles())).toEqual(
      new Set(["auto", "nested", "pacSub", "direct", "fallback"])
    );
  });

  test("returns only itself for simple profiles", () => {
    expect(profileTreeIDs("other", profiles())).toEqual(new Set(["other"]));
  });
});

describe("isProfileTreeChanged", () => {
  test("detects a refreshed PAC script of a nested sub-profile", () => {
    const updated = profiles();
    updated.pacSub = pac("pacSub", "return 'PROXY 1.2.3.4:80';");
    expect(isProfileTreeChanged("auto", updated, profiles())).toBe(true);
  });

  test("detects a deleted sub-profile", () => {
    const updated = profiles();
    delete updated.fallback;
    expect(isProfileTreeChanged("auto", updated, profiles())).toBe(true);
  });

  test("detects a changed active profile", () => {
    const updated = profiles();
    updated.other = proxy("other", "10.0.0.1");
    expect(isProfileTreeChanged("other", updated, profiles())).toBe(true);
  });

  test("ignores profiles outside of the tree", () => {
    const updated = profiles();
    updated.other = proxy("other", "10.0.0.1");
    updated.unused = proxy("unused", "10.0.0.1");
    expect(isProfileTreeChanged("auto", updated, profiles())).toBe(false);
  });
});
