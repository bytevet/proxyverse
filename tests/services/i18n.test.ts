import { describe, expect, test } from "vitest";
import {
  LANGUAGES,
  catalogLookup,
  formatMessage,
  type Catalog,
} from "@/services/i18n";

const locales = import.meta.glob<Catalog>("/public/_locales/*/messages.json", {
  eager: true,
  import: "default",
});
const catalogOf = (code: string) =>
  locales[`/public/_locales/${code}/messages.json`];

describe("formatMessage", () => {
  test.each([
    ["plain", undefined, "plain"],
    ["$1 profiles have been imported", "3", "3 profiles have been imported"],
    ["$2 then $1", ["a", "b"], "b then a"],
    ["anchored with ^ and $$, e.g.", undefined, "anchored with ^ and $, e.g."],
    ["missing $1.", undefined, "missing ."],
  ])("%s", (message, subs, expected) => {
    expect(formatMessage({ message }, subs as any)).toBe(expected);
  });

  test("named placeholders, case-insensitive, referring to substitutions", () => {
    expect(
      formatMessage(
        {
          message: "Hello $User$, you have $COUNT$ items ($$)",
          placeholders: {
            user: { content: "$1" },
            count: { content: "$2" },
          },
        },
        ["Ann", "2"]
      )
    ).toBe("Hello Ann, you have 2 items ($)");
  });

  test("an unknown message is empty, like chrome.i18n", () => {
    expect(formatMessage(undefined)).toBe("");
  });
});

describe("catalogs", () => {
  test("every locale directory is offered, and nothing else", () => {
    const dirs = Object.keys(locales)
      .map((p) => p.split("/")[3])
      .sort();
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(dirs);
  });

  // missing messages are fine (English shows), broken ones aren't
  test("translations keep their message's substitutions", () => {
    const en = catalogOf("en");
    const subs = (m: string) => [...m.matchAll(/\$(\$|\d)/g)].map((x) => x[0]).sort();
    for (const { code } of LANGUAGES) {
      const catalog = catalogOf(code);
      for (const [key, { message }] of Object.entries(catalog)) {
        expect(en[key], `${code} ${key} isn't an English message`).toBeDefined();
        expect(subs(message), `${code} ${key}`).toEqual(subs(en[key].message));
      }
    }
  });

  test("the chosen language falls back to English per message", () => {
    const t = catalogLookup(
      { both: { message: "chosen" } },
      { both: { message: "fallback" }, only_en: { message: "English $1" } }
    );
    expect(t("both")).toBe("chosen");
    expect(t("only_en", "x")).toBe("English x");
    expect(t("no_such_message")).toBe("");
  });
});
