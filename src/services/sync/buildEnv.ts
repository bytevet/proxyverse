// Build-time sync settings, chosen by the PROXYVERSE_ENV variable when the
// extension is built (see vite.config.ts). Store builds always get
// "production". Vite replaces the __SYNC_*__ identifiers with literals; the
// typeof guards keep this module usable where they aren't defined.

export type SyncBuildEnv = "production" | "northernlight" | "e2e";

declare const __SYNC_ENV__: SyncBuildEnv | undefined;
declare const __SYNC_ORIGIN__: string | undefined;
declare const __SYNC_CLIENT_ID__: string | undefined;
declare const __SYNC_ORIGIN_OVERRIDE__: boolean | undefined;

export const SYNC_BUILD = {
  env: (typeof __SYNC_ENV__ !== "undefined" && __SYNC_ENV__) || "production",
  /** The byte.vet origin serving OAuth and the sync API, no trailing slash. */
  origin:
    (typeof __SYNC_ORIGIN__ !== "undefined" && __SYNC_ORIGIN__) ||
    "https://byte.vet",
  clientID:
    (typeof __SYNC_CLIENT_ID__ !== "undefined" && __SYNC_CLIENT_ID__) ||
    "proxyverse-extension",
  /** e2e builds only: the origin may be overridden at runtime from storage. */
  allowOriginOverride:
    typeof __SYNC_ORIGIN_OVERRIDE__ !== "undefined" &&
    __SYNC_ORIGIN_OVERRIDE__ === true,
} as const;
