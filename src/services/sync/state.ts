import { Host } from "@/adapters";
import { deepClone, withLock } from "@/services/utils";
import type { SyncRecord } from "./api";

/**
 * Sync's own storage (spec §5.1), in `storage.local` and never synced:
 * the tokens, the engine's bookkeeping, and this device's sync settings.
 */

export const keySyncAuth = "sync.auth";
export const keySyncState = "sync.state";
export const keySyncSettings = "sync.settings";
const SYNC_KEYS = [keySyncAuth, keySyncState, keySyncSettings] as const;
type SyncStorageKey = (typeof SYNC_KEYS)[number];

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
  /**
   * The first sync found data on both this device and the account, and
   * waits for the user to choose how to combine them (spec §5.7).
   */
  needsFirstChoice?: boolean;
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
});

/** Signed in, with a sign-in the server hasn't refused. */
export const isSignedIn = (auth: SyncAuth | undefined): auth is SyncAuth =>
  !!auth && !auth.expired;

// --- auth ---

export async function getSyncAuth(): Promise<SyncAuth | undefined> {
  return Host.get<SyncAuth>(keySyncAuth);
}

export async function setSyncAuth(auth: SyncAuth) {
  await Host.set(keySyncAuth, deepClone(auth));
}

export async function clearSyncAuth() {
  await Host.remove(keySyncAuth);
}

// --- state ---

export async function getSyncState(): Promise<SyncState | undefined> {
  return Host.get<SyncState>(keySyncState);
}

export async function setSyncState(state: SyncState) {
  await Host.set(keySyncState, deepClone(state));
}

export async function clearSyncState() {
  await Host.remove(keySyncState);
}

// --- settings ---

/** Stored settings with missing fields filled in with their defaults. */
export const withSyncDefaults = (
  stored: Partial<SyncSettings> | undefined
): SyncSettings => ({ ...DEFAULT_SYNC_SETTINGS, ...stored });

/** This device's settings; missing fields get their defaults. */
export async function getSyncSettings(): Promise<SyncSettings> {
  return withSyncDefaults(await Host.get<Partial<SyncSettings>>(keySyncSettings));
}

/**
 * Change this device's settings. Read-modify-write under a lock shared by
 * every extension context, so two pages changing different settings don't
 * overwrite each other.
 */
export function updateSyncSettings(
  mutate: (settings: SyncSettings) => void
): Promise<void> {
  return withLock("proxyverse-sync-settings", async () => {
    const settings = await getSyncSettings();
    mutate(settings);
    await Host.set(keySyncSettings, deepClone(settings));
  });
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
