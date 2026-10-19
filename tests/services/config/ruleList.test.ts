import { describe, expect, test } from "vitest";
import {
  conditionFromString,
  parseRuleList,
} from "@/services/config/switchyomega/ruleList";

const flat = (rules: ReturnType<typeof parseRuleList>) =>
  rules.map((r) => [
    r.condition.conditionType.replace(/Condition$/, ""),
    r.condition.pattern ?? `${r.condition.ip}/${r.condition.prefixLength}`,
    r.profileName,
  ]);

describe("conditionFromString", () => {
  test.each([
    ["a.test", "HostWildcardCondition", "a.test"],
    [": [weird", "HostWildcardCondition", "[weird"],
    ["hostwildcard: a.test", "HostWildcardCondition", "a.test"],
    ["R: ^a$", "HostRegexCondition", "^a$"],
    ["UR: ^http:", "UrlRegexCondition", "^http:"],
    ["U: *://a/*", "UrlWildcardCondition", "*://a/*"],
    ["KW: word", "KeywordCondition", "word"],
    ["B: <local>", "BypassCondition", "<local>"],
    ["Lv: 1~2", "HostLevelsCondition", "1~2"],
    ["Disabled: a.test", "FalseCondition", "a.test"],
  ])("%s", (str, conditionType, pattern) => {
    expect(conditionFromString(str)).toEqual({ conditionType, pattern });
  });

  test("Ip and True", () => {
    expect(conditionFromString("Ip: 10.0.0.0/8")).toEqual({
      conditionType: "IpCondition",
      ip: "10.0.0.0",
      prefixLength: 8,
    });
    expect(conditionFromString("Ip: ::1")).toMatchObject({ prefixLength: 128 });
    expect(conditionFromString("True:")).toEqual({ conditionType: "TrueCondition" });
  });

  test("unknown types", () => {
    expect(conditionFromString("Nope: x")).toBeUndefined();
  });
});

describe("parseRuleList", () => {
  test("SwitchyOmega format", () => {
    const text = [
      "[SwitchyOmega Conditions]",
      "; a comment",
      "@note a note",
      "a.test",
      "!b.a.test",
      "Ip: 10.0.0.0/8",
    ].join("\r\n");
    expect(flat(parseRuleList(text, false, "match", "default"))).toEqual([
      ["HostWildcard", "a.test", "match"],
      ["HostWildcard", "b.a.test", "default"],
      ["Ip", "10.0.0.0/8", "match"],
    ]);
  });

  test("SwitchyOmega format with results", () => {
    const text = [
      "[SwitchyOmega Conditions]",
      "@with result",
      "a.test +proxy",
      "!b.test",
      "no result",
      "* +other",
    ].join("\n");
    expect(flat(parseRuleList(text, false, "match", "default"))).toEqual([
      ["HostWildcard", "a.test", "proxy"],
      ["HostWildcard", "b.test", "other"],
      ["HostWildcard", "*", "other"],
    ]);
  });

  test("legacy Switchy format", () => {
    const text = [
      "#BEGIN",
      "[Wildcard]",
      "*.a.test/*",
      "*://b.test/*",
      "!c.test",
      "@http://d.test/x",
      "[RegExp]",
      "^https://e\\.test/",
      "#END",
      "ignored.test",
    ].join("\n");
    expect(flat(parseRuleList(text, false, "match", "default"))).toEqual([
      ["UrlWildcard", "*c.test*", "default"],
      ["UrlWildcard", "*.a.test/*", "match"],
      ["HostWildcard", "b.test", "match"],
      ["UrlWildcard", "http://d.test/x", "match"],
      ["UrlRegex", "^https://e\\.test/", "match"],
    ]);
  });

  test("AutoProxy format, plain and base64", () => {
    const text = [
      "[AutoProxy 0.2.9]",
      "! comment",
      "||a.test",
      "|https://b.test/",
      "/^https?:\\/\\/c\\.test/",
      "d.test",
      "e.test/*.js",
      "@@||f.a.test",
    ].join("\n");
    const expected = [
      ["HostWildcard", "*.f.a.test", "default"],
      ["HostWildcard", "*.a.test", "match"],
      ["UrlWildcard", "https://b.test/*", "match"],
      ["UrlRegex", "^https?:\\/\\/c\\.test", "match"],
      ["Keyword", "d.test", "match"],
      ["UrlWildcard", "http://*e.test/*.js*", "match"],
    ];
    expect(flat(parseRuleList(text, true, "match", "default"))).toEqual(
      expected
    );
    // gfwlist is served base64-encoded; recognised whatever the format says
    const base64 = btoa(text);
    expect(flat(parseRuleList(base64, false, "match", "default"))).toEqual(
      expected
    );
  });
});
