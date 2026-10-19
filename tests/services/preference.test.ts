import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import {
  DarkMode,
  applyStoredDarkMode,
  changeDarkMode,
  followDarkMode,
  useDarkMode,
} from "@/services/preference";

// the bits of the DOM the theme touches
let systemDark = false;
const body = new Map<string, string>();
const root = { style: { colorScheme: "" } };
beforeAll(() => {
  vi.stubGlobal("document", {
    documentElement: root,
    body: {
      setAttribute: (k: string, v: string) => body.set(k, v),
      removeAttribute: (k: string) => body.delete(k),
    },
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: systemDark, addEventListener: () => {} }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const shownTheme = () => [body.get("arco-theme") ?? "light", root.style.colorScheme];

describe("dark mode", () => {
  const { setting, shown } = useDarkMode();

  test("applies the stored setting, following the system by default", async () => {
    vi.spyOn(Host, "get").mockResolvedValueOnce(undefined);
    systemDark = true;
    await applyStoredDarkMode();
    expect(setting.value).toBe(DarkMode.Default);
    expect(shown()).toBe(DarkMode.Dark);
    expect(shownTheme()).toEqual(["dark", "dark"]);
  });

  test("a change applies and stores the setting", async () => {
    const set = vi.spyOn(Host, "set").mockResolvedValue();
    await changeDarkMode(DarkMode.Light);
    expect(setting.value).toBe(DarkMode.Light);
    expect(shownTheme()).toEqual(["light", "light"]);
    expect(set).toHaveBeenCalledWith("theme.darkmode", DarkMode.Light);
  });

  test("follows changes made in other pages", () => {
    let listener: (changes: Record<string, { newValue?: unknown }>) => void =
      () => {};
    vi.spyOn(Host, "onLocalStorageChanged").mockImplementation((l) => {
      listener = l;
      return () => {};
    });
    followDarkMode();

    listener({ "theme.darkmode": { newValue: DarkMode.Dark } });
    expect(setting.value).toBe(DarkMode.Dark);
    expect(shownTheme()).toEqual(["dark", "dark"]);

    // unset: follow the (now light) system
    systemDark = false;
    listener({ "theme.darkmode": {} });
    expect(setting.value).toBe(DarkMode.Default);
    expect(shownTheme()).toEqual(["light", "light"]);
  });
});
