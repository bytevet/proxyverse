// The manifest.json of a build, from the one at the repo root. Pure, so it
// can be unit-tested (tests/build/manifest.test.ts).
//
// Rolldown (Vite 8) panics on nested member expressions such as
// `manifest.background.service_worker` while transforming the config and
// the modules it imports, so this module only reads one level deep at a
// time, hoisting nested objects into locals.

import type { BuildEnv } from "./env.ts";

export type Manifest = Record<string, unknown>;

export type BuildManifestOptions = {
  mode: "chrome" | "firefox";
  env: BuildEnv;
  /** The CRX version, e.g. "1.2.3" or "1.2.3-beta" (see `crxVersion`). */
  version: string;
  /** The built background script's file name. */
  serviceWorker: string;
  /**
   * The dev public key (base64 DER), giving unpacked Chrome builds a fixed
   * extension ID. Required for Chrome northernlight and e2e builds.
   */
  devKey?: string;
};

const GECKO_ID = "proxyverse@byte.vet";

/** The CRX version from CRX_VER (e.g. a "v1.2.3" tag). */
export function crxVersion(crxVer: string | undefined): string {
  if (!crxVer) return "0.0.0-dev";
  const ver = crxVer.startsWith("v") ? crxVer.slice(1) : crxVer;
  return ver.slice(0, 14);
}

/** Envs whose Chrome builds carry the dev key. */
export function needsDevKey(mode: "chrome" | "firefox", env: BuildEnv) {
  return mode === "chrome" && env !== "production";
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : [];

export function buildManifest(
  base: Manifest,
  opts: BuildManifestOptions
): Manifest {
  const { mode, env, version, serviceWorker, devKey } = opts;
  const manifest: Manifest = JSON.parse(JSON.stringify(base));
  const background = { ...(manifest.background as Record<string, unknown>) };
  let permissions = strings(manifest.permissions);

  manifest.version = version.split("-", 1)[0];
  manifest.version_name = version;
  // the hashed file name avoids cache issues
  if (mode === "firefox") background.scripts = [serviceWorker];
  else background.service_worker = serviceWorker;

  if (mode === "firefox") {
    delete background.service_worker;

    delete manifest.version_name;

    // Firefox has a sidebar instead of Chrome's side panel
    delete manifest.side_panel;
    permissions = permissions.filter((p) => p !== "sidePanel");
    manifest.sidebar_action = {
      default_panel: "index.html#/sidebar",
      default_icon: "mini-logo.png",
      open_at_install: false,
    };

    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: "115.0",
      },
    };
  }

  delete manifest.key;
  if (needsDevKey(mode, env)) {
    if (!devKey) {
      throw new Error(`A ${env} Chrome build needs the dev key (devKey)`);
    }
    manifest.key = devKey;
  }

  manifest.background = background;
  manifest.permissions = permissions;

  return manifest;
}
