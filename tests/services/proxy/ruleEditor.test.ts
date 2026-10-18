import { expect, test, describe } from "vitest";
import type { ProfileAutoSwitch } from "@/services/profile";
import {
  ruleConditions,
  siteDomain,
  upsertDomainRule,
  upsertDomainRules,
} from "@/services/proxy/ruleEditor";

const baseProfile = (): ProfileAutoSwitch => ({
  profileID: "auto",
  color: "",
  profileName: "Auto",
  proxyType: "auto",
  defaultProfileID: "direct",
  rules: [
    { type: "domain", condition: "*.example.com", profileID: "proxyA" },
    { type: "domain", condition: "cdn.example.com", profileID: "proxyA" },
    { type: "url", condition: "https://foo.com/*", profileID: "proxyB" },
  ],
});

describe("upsertDomainRule", () => {
  test("prepends a new rule for an unknown host", () => {
    const ret = upsertDomainRule(baseProfile(), "foo.com", "proxyB");
    expect(ret.rules).toHaveLength(4);
    expect(ret.rules[0]).toEqual({
      type: "domain",
      condition: "foo.com",
      profileID: "proxyB",
    });
  });

  test("updates an exact match and moves it to the top", () => {
    const ret = upsertDomainRule(baseProfile(), "cdn.example.com", "direct");
    expect(ret.rules).toHaveLength(3);
    expect(ret.rules[0]).toEqual({
      type: "domain",
      condition: "cdn.example.com",
      profileID: "direct",
    });
    // wildcard rule is left untouched
    expect(ret.rules[1]).toEqual({
      type: "domain",
      condition: "*.example.com",
      profileID: "proxyA",
    });
  });

  test("does not match wildcard or non-domain rules", () => {
    const ret = upsertDomainRule(baseProfile(), "example.com", "direct");
    expect(ret.rules).toHaveLength(4);
    expect(ret.rules[0].condition).toBe("example.com");
  });

  test("refuses to route to itself", () => {
    expect(() => upsertDomainRule(baseProfile(), "foo.com", "auto")).toThrow();
  });

  test("does not mutate the input profile", () => {
    const profile = baseProfile();
    upsertDomainRule(profile, "cdn.example.com", "direct");
    expect(profile).toEqual(baseProfile());
  });
});

describe("site rules", () => {
  test("siteDomain uses the registrable domain", () => {
    expect(siteDomain("a.b.example.com")).toBe("example.com");
    expect(siteDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(siteDomain("example.com")).toBe("example.com");
    expect(siteDomain("foo.github.io")).toBe("foo.github.io");
  });

  test("siteDomain is undefined without a parent domain", () => {
    for (const host of ["github.io", "localhost", "intranet", "10.1.2.3", "[::1]"]) {
      expect(siteDomain(host)).toBeUndefined();
    }
  });

  test("ruleConditions covers the apex and its subdomains for a site", () => {
    expect(ruleConditions("www.example.com", "host")).toEqual(["www.example.com"]);
    expect(ruleConditions("www.example.com", "site")).toEqual([
      "example.com",
      "*.example.com",
    ]);
    // no site: falls back to the exact host
    expect(ruleConditions("localhost", "site")).toEqual(["localhost"]);
  });

  test("upsertDomainRules puts the rules on top, in order", () => {
    const ret = upsertDomainRules(
      baseProfile(),
      ["example.com", "*.example.com"],
      "proxyB"
    );
    expect(ret.rules.map((r) => [r.condition, r.profileID])).toEqual([
      ["example.com", "proxyB"],
      ["*.example.com", "proxyB"], // existing rule, updated and moved up
      ["cdn.example.com", "proxyA"], // exact rules are kept
      ["https://foo.com/*", "proxyB"],
    ]);
  });
});
