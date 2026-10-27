import { Host } from "@/adapters";
import { deepClone } from "@/services/utils";
import type { SyncRecord } from "./api";

/**
 * Sync's own storage (spec §5.1), in `storage.local` and never synced:
 * the tokens, the engine's bookkeeping, and this device's sync settings.
 */

export const keySyncAuth = "sync.auth";
export const keySyncState = "sync.state";
export const keySyncSettings = "sync.settings";
const SYNC_KEYS = [keySyncAuth, keySyncState, keySyncSettings] as const;
export type SyncStorageKey = (typeof SYNC_KEYS)[number];

export type SyncAuth = {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in ms since the epoch. */
  expiresAt: number;
  /** From userinfo: `sub` tells a different account apart, `email` is shown. */
  account?: { sub?: string; email?: string };
  /** The refresh token was refused: signed out until the user signs in. */
  expired?: boolean;
};

export type SyncPhase = "idle" | "needs-first-choice" | "error";

export type SyncState = {
  deviceID: string;
  /** The highest server `rev` applied. */
  cursor: number;
  /** The last HLC issued or seen. */
  clock?: string;
  /** The last version agreed with the server, per record. */
  base: Record<string, { rev: number; hlc: string; hash: string }>;
  /** This device's current version, per record. */
  local: Record<string, { hlc: string; hash: string }>;
  /** Records with a schema or encoding this version can't read (§3.5). */
  held: Record<string, SyncRecord>;
  phase: SyncPhase;
  lastSync?: { at: number; error?: { code: string; message?: string } };
  /** The first sync with the account is done (spec §5.7). */
  synced?: boolean;
  /**
   * Records the server refused for good (e.g. too large): not pushed again
   * until they change locally, so a bad record doesn't fail every run.
   */
  failed?: Record<string, { reason: string; hash: string }>;
  /** Don't sync on its own before `until` (ms), after `attempts` failures. */
  backoff?: { until: number; attempts: number };
  /** The extension version this device last registered with. */
  registered?: string;
};

export type SyncSettings = {
  /** Whether `pref:*` records sync on this device, both ways. */
  syncPrefs: boolean;
  /** Profile IDs that stay on this device (spec §5.6). */
  localOnly: string[];
};

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  syncPrefs: true,
  localOnly: [],
};

/** The state of a device that has never synced. */
export const initialSyncState = (): SyncState => ({
  deviceID: globalThis.crypto.randomUUID(),
  cursor: 0,
  base: {},
  local: {},
  held: {},
  phase: "idle",
});

// --- auth ---

// The adapters can't remove a local key, and browsers ignore an undefined
// value, so a cleared key holds null.

export async function getSyncAuth(): Promise<SyncAuth | undefined> {
  return (await Host.get<SyncAuth | null>(keySyncAuth)) ?? undefined;
}

export async function setSyncAuth(auth: SyncAuth) {
  await Host.set(keySyncAuth, deepClone(auth));
}

export async function clearSyncAuth() {
  await Host.set(keySyncAuth, null);
}

// --- state ---

export async function getSyncState(): Promise<SyncState | undefined> {
  return (await Host.get<SyncState | null>(keySyncState)) ?? undefined;
}

export async function setSyncState(state: SyncState) {
  await Host.set(keySyncState, deepClone(state));
}

export async function clearSyncState() {
  await Host.set(keySyncState, null);
}

// --- settings ---

/** This device's settings; missing fields get their defaults. */
export async function getSyncSettings(): Promise<SyncSettings> {
  const stored = await Host.get<Partial<SyncSettings> | null>(keySyncSettings);
  return { ...DEFAULT_SYNC_SETTINGS, ...stored };
}

export async function setSyncSettings(settings: SyncSettings) {
  await Host.set(keySyncSettings, deepClone(settings));
}

/**
 * Subscribe to writes of the sync keys, from any extension context. The
 * callback gets the changes of those keys only. Returns an unsubscribe.
 */
export function onSyncStorageChanged(
  callback: (
    changes: Partial<
      Record<SyncStorageKey, { newValue?: unknown; oldValue?: unknown }>
    >
  ) => void
): () => void {
  return Host.onLocalStorageChanged((changes) => {
    const ours = Object.fromEntries(
      SYNC_KEYS.filter((k) => k in changes).map((k) => [k, changes[k]])
    );
    if (Object.keys(ours).length) callback(ours);
  });
}
