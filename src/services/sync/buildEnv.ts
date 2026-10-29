// Build-time sync settings, chosen by PROXYVERSE_ENV when the extension is
// built: Vite replaces the __SYNC_*__ identifiers with the values from
// build/env.ts (vitest too, as it reads vite.config.ts). Store builds always
// get "production".

declare const __SYNC_ORIGIN__: string;
declare const __SYNC_CLIENT_ID__: string;
declare const __SYNC_ORIGIN_OVERRIDE__: boolean;

export const SYNC_BUILD = {
  /** The byte.vet origin serving OAuth and the sync API, no trailing slash. */
  origin: __SYNC_ORIGIN__,
  clientID: __SYNC_CLIENT_ID__,
  /** e2e builds only: the origin may be overridden at runtime from storage. */
  allowOriginOverride: __SYNC_ORIGIN_OVERRIDE__,
} as const;
