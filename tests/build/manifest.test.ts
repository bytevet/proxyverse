import { describe, expect, test } from "vitest";
import base from "../../manifest.json";
import { buildManifest, crxVersion } from "../../build/manifest.ts";
import { BUILD_ENVS, parseBuildEnv, syncDefines } from "../../build/env.ts";

const KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAdevkey";
const common = { version: "1.2.3-beta", serviceWorker: "assets/bg-abc.js" };

// the Chrome production manifest: the root one with the version and the
// built service worker filled in
const chromeExpected = () => {
  const m: any = JSON.parse(JSON.stringify(base));
  m.version = "1.2.3";
  m.version_name = "1.2.3-beta";
  m.background.service_worker = "assets/bg-abc.js";
  return m;
};

describe("buildManifest", () => {
  test("Chrome production fills in the version and service worker only", () => {
    const m: any = buildManifest(base, { ...common, mode: "chrome", env: "production" });
    expect(m).toEqual(chromeExpected());
    // sync's sign-in window; no install or update warning on Chrome
    expect(m.permissions).toContain("identity");
    expect(m).not.toHaveProperty("optional_permissions");
    expect(m).not.toHaveProperty("key");
  });

  test("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(base));
    buildManifest(base, { ...common, mode: "firefox", env: "e2e" });
    buildManifest(base, { ...common, mode: "chrome", env: "e2e", devKey: KEY });
    expect(base).toEqual(copy);
  });

  test("Firefox: gecko and sidebar transforms", () => {
    const m: any = buildManifest(base, { ...common, mode: "firefox", env: "production" });
    expect(m.permissions).toContain("identity");
    expect(m.permissions).not.toContain("sidePanel");
    expect(m).not.toHaveProperty("optional_permissions");
    expect(m.background).toEqual({ type: "module", scripts: ["assets/bg-abc.js"] });
    expect(m).not.toHaveProperty("version_name");
    expect(m.version).toBe("1.2.3");
    expect(m).not.toHaveProperty("side_panel");
    expect(m.sidebar_action).toEqual({
      default_panel: "index.html#/sidebar",
      default_icon: "mini-logo.png",
      open_at_install: false,
    });
    expect(m.browser_specific_settings).toEqual({
      gecko: { id: "proxyverse@byte.vet", strict_min_version: "115.0" },
    });
    expect(m).not.toHaveProperty("key");
  });

  test("Chrome dev builds carry the key, production never does", () => {
    for (const env of ["northernlight", "e2e"] as const) {
      const m = buildManifest(base, { ...common, mode: "chrome", env, devKey: KEY });
      expect(m.key).toBe(KEY);
    }
    for (const mode of ["chrome", "firefox"] as const) {
      const m = buildManifest(
        { ...base, key: "stale" },
        { ...common, mode, env: "production", devKey: KEY }
      );
      expect(m).not.toHaveProperty("key");
    }
    expect(
      buildManifest(base, { ...common, mode: "firefox", env: "northernlight", devKey: KEY })
    ).not.toHaveProperty("key");
  });

  test("a Chrome dev build without the key fails", () => {
    expect(() =>
      buildManifest(base, { ...common, mode: "chrome", env: "northernlight" })
    ).toThrow(/dev key/);
  });
});

describe("crxVersion", () => {
  test("from CRX_VER", () => {
    expect(crxVersion(undefined)).toBe("0.0.0-dev");
    expect(crxVersion("v1.2.3")).toBe("1.2.3");
    expect(crxVersion("1.2.3-rc.1234567890")).toBe("1.2.3-rc.12345");
  });
});

describe("build env", () => {
  test("parses PROXYVERSE_ENV", () => {
    expect(parseBuildEnv(undefined)).toBe("production");
    expect(parseBuildEnv("")).toBe("production");
    expect(parseBuildEnv("northernlight")).toBe("northernlight");
    expect(parseBuildEnv("e2e")).toBe("e2e");
    expect(() => parseBuildEnv("staging")).toThrow(/Unknown PROXYVERSE_ENV "staging"/);
    expect(() => parseBuildEnv("toString")).toThrow();
  });

  test("defines JSON literals", () => {
    expect(syncDefines("production")).toEqual({
      __SYNC_ORIGIN__: '"https://byte.vet"',
      __SYNC_CLIENT_ID__: '"proxyverse-extension"',
      __SYNC_ORIGIN_OVERRIDE__: "false",
    });
    expect(BUILD_ENVS.northernlight.clientID).toBe("proxyverse-extension-dev");
    expect(syncDefines("e2e").__SYNC_ORIGIN_OVERRIDE__).toBe("true");
  });
});
