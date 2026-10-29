// Build environments, chosen by PROXYVERSE_ENV when the extension is built.
// They set the byte.vet origin and OAuth client the sync feature talks to
// (read at runtime by src/services/sync/buildEnv.ts) and a few manifest
// details (build/manifest.ts). Store builds are always "production".

export type BuildEnv = "production" | "northernlight" | "e2e";

/** The sync server and OAuth client a build talks to. */
export type SyncTarget = {
  /** The byte.vet origin serving OAuth and the sync API, no trailing slash. */
  origin: string;
  clientID: string;
  /** Whether the origin may be overridden at runtime (e2e only). */
  originOverride: boolean;
};

export const BUILD_ENVS: Record<BuildEnv, SyncTarget> = {
  production: {
    origin: "https://byte.vet",
    clientID: "proxyverse-extension",
    originOverride: false,
  },
  northernlight: {
    origin: "https://northernlight.byte.vet",
    clientID: "proxyverse-extension-dev",
    originOverride: false,
  },
  e2e: {
    // placeholder: the e2e suite sets the real origin at runtime
    origin: "http://127.0.0.1",
    clientID: "proxyverse-extension-dev",
    originOverride: true,
  },
};

/** Parse PROXYVERSE_ENV; unset or empty means "production". */
export function parseBuildEnv(value: string | undefined): BuildEnv {
  if (!value) return "production";
  if (Object.hasOwn(BUILD_ENVS, value)) return value as BuildEnv;
  throw new Error(
    `Unknown PROXYVERSE_ENV "${value}"; expected one of: ${Object.keys(
      BUILD_ENVS
    ).join(", ")}`
  );
}

/** Vite `define` entries for src/services/sync/buildEnv.ts. */
export function syncDefines(env: BuildEnv): Record<string, string> {
  const { origin, clientID, originOverride } = BUILD_ENVS[env];
  return {
    __SYNC_ORIGIN__: JSON.stringify(origin),
    __SYNC_CLIENT_ID__: JSON.stringify(clientID),
    __SYNC_ORIGIN_OVERRIDE__: JSON.stringify(originOverride),
  };
}
