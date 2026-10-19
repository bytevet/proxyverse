import { describe, expect, test } from "vitest";
import {
  MAX_EXPANSION,
  regexToWildcards,
} from "@/services/config/switchyomega/regex";
import { shExpMatch } from "@/services/proxy/pacSimulator";

const SAMPLES = [
  "example.com",
  "www.example.com",
  "a.b.example.com",
  "example.com.cn",
  "examplexcom",
  "notexample.com",
  "google.com",
  "www.google.com.hk",
  "http://example.com/",
  "https://example.com/",
  "https://www.example.com/",
  "http://www.example.com/path?q=1",
  "https://example.org/api/v1",
  "ftp://example.com/",
  "http://foo.bar/baz",
  "https://a-b.c_d/",
  "",
];

describe("regexToWildcards", () => {
  test.each([
    ["example\\.com", ["*example.com*"]],
    ["^example\\.com$", ["example.com"]],
    ["(^|\\.)example\\.com$", undefined], // `^` inside a group
    ["\\.example\\.com$", ["*.example.com"]],
    ["^https?://", ["http://*", "https://*"]],
    [
      "^https?://(www\\.)?example\\.com/",
      [
        "http://example.com/*",
        "http://www.example.com/*",
        "https://example.com/*",
        "https://www.example.com/*",
      ],
    ],
    ["^(?:a|b)\\.com$", ["a.com", "b.com"]],
    ["^a\\.com$|^b\\.com$", ["a.com", "b.com"]],
    ["google", ["*google*"]],
    ["^.*\\.google\\..*$", ["*.google.*"]],
    ["^a.+b$", ["a?*b"]],
    ["^a.?b$", ["ab", "a?b"]],
    ["^a.*?b$", ["a*b"]],
    ["", ["*"]],
    ["^api\\.example\\.(com|org)/v\\?", ["api.example.com/v?*", "api.example.org/v?*"]],
  ])("translates %s", (re, expected) => {
    expect(regexToWildcards(re)?.sort()).toEqual(expected?.sort());
  });

  test.each([
    "[a-z]+\\.com",
    "^\\d+\\.example",
    "a+b",
    "ab*",
    "a{2}",
    "(?=a)b",
    "(?!a)b",
    "(a)\\1",
    "\\bfoo",
    "a\\+b",
    "a\\(b",
    "a(b",
    "a)b",
    "a$b",
    "(a$)",
    "^[^\\/]+blogspot\\.(.*)",
    "foo\\",
  ])("rejects %s", (re) => {
    expect(regexToWildcards(re)).toBeUndefined();
  });

  test("caps the expansion", () => {
    // 2^5 = 32 alternatives
    expect(regexToWildcards("^a?b?c?d?e?$")).toBeUndefined();
    expect(regexToWildcards("^a?b?c?d?$")).toHaveLength(MAX_EXPANSION);
  });

  test.each([
    "example\\.com",
    "^example\\.com$",
    "\\.example\\.com$",
    "^https?://(www\\.)?example\\.com/",
    "^(?:www|a\\.b)\\.example\\.com$",
    "google",
    "^.*\\.google\\..*$",
    "^h.+p://",
    "^https?://example\\.(com|org)",
    "e.ample",
    "^ftp:|^https:",
    "",
  ])("matches exactly what the regex matches: %s", (re) => {
    const wildcards = regexToWildcards(re);
    expect(wildcards).toBeDefined();
    for (const s of SAMPLES) {
      expect(
        wildcards!.some((w) => shExpMatch(s, w)),
        `${re} on "${s}"`
      ).toBe(new RegExp(re).test(s));
    }
  });
});
