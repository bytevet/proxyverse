import { Host } from "@/adapters";
import { listProfiles, updateProfiles } from "@/services/profile";
import { SyncApi, type SnapshotMeta } from "./api";
import {
  expireSignIn,
  getAccessToken,
  refreshAccessToken,
  signOut,
} from "./auth";
import { syncOrigin } from "./config";
import { SyncEngine, type FirstChoice, type SyncDevice } from "./engine";
import { SYNCED_PREFS, type SyncedPref } from "./records";
import {
  getSyncAuth,
  getSyncSettings,
  getSyncState,
  isSignedIn,
  setSyncState,
} from "./state";

/**
 * Sync for this extension: the engine over this device's storage, and the
 * messages extension pages use to drive it in the background.
 */

const device: SyncDevice = {
  profiles: listProfiles,
  updateProfiles,
  async prefs() {
    const values = await Promise.all(SYNCED_PREFS.map((key) => Host.get(key)));
    const prefs: Partial<Record<SyncedPref, unknown>> = {};
    SYNCED_PREFS.forEach((key, i) => {
      if (values[i] !== undefined) prefs[key] = values[i];
    });
    return prefs;
  },
  setPref: (key, value) => Host.set(key, value),
  state: getSyncState,
  setState: setSyncState,
  settings: getSyncSettings,
  signedIn: async () => isSignedIn(await getSyncAuth()),
};

// what this extension build runs on; it doesn't change while it runs
let info: ReturnType<typeof Host.extensionInfo> | undefined;
const extensionInfo = () => (info ??= Host.extensionInfo());

async function api(deviceID: string): Promise<SyncApi> {
  // the token the client last used, so a refresh after a 401 replaces that
  // one and not one another context refreshed meanwhile
  let used: string | undefined;
  return new SyncApi({
    origin: await syncOrigin(),
    deviceID,
    version: (await extensionInfo()).version,
    getAccessToken: async () => (used = await getAccessToken()),
    refreshAccessToken: async () => (used = await refreshAccessToken(used)),
  });
}

let engine: Promise<SyncEngine> | undefined;

/** The engine of this context; only the background runs it. */
export function syncEngine(): Promise<SyncEngine> {
  engine ??= extensionInfo().then(
    (info) =>
      new SyncEngine({
        device,
        api,
        info,
        onAuthRejected: expireSignIn,
        onDeviceRevoked: signOut,
      })
  );
  return engine;
}

// --- messages from extension pages ---

export type SyncMessage =
  | { type: "sync:run" }
  | { type: "sync:first-choice"; choice: FirstChoice }
  | { type: "sync:snapshots" }
  | { type: "sync:restore"; snapshotID: string };

type SyncReply<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const isSyncMessage = (m: unknown): m is SyncMessage =>
  typeof m === "object" &&
  m !== null &&
  typeof (m as { type?: unknown }).type === "string" &&
  (m as { type: string }).type.startsWith("sync:");

async function send<T>(message: SyncMessage): Promise<T> {
  const reply: SyncReply<T> | undefined = await Host.sendMessage(message);
  if (!reply) throw Error("The background didn't answer");
  if (!reply.ok) throw Error(reply.error);
  return reply.value;
}

/** Sync now; resolves when the run is done (its result is in the state). */
export const requestSync = () => send<undefined>({ type: "sync:run" });

/** Finish the first sync the way the user chose (spec §5.7). */
export const chooseFirstSync = (choice: FirstChoice) =>
  send<undefined>({ type: "sync:first-choice", choice });

export const listSnapshots = () =>
  send<SnapshotMeta[]>({ type: "sync:snapshots" });

/** Restore the account to a snapshot, then sync it to this device. */
export const restoreSnapshot = (snapshotID: string) =>
  send<undefined>({ type: "sync:restore", snapshotID });

async function handle(message: SyncMessage): Promise<unknown> {
  const engine = await syncEngine();
  switch (message.type) {
    case "sync:run":
      return engine.run({ trigger: "manual" });
    case "sync:first-choice":
      return engine.run({ trigger: "manual", firstChoice: message.choice });
    case "sync:snapshots":
      return (await withApi()).listSnapshots();
    case "sync:restore":
      await (await withApi()).restoreSnapshot(message.snapshotID);
      return engine.run({ trigger: "manual" });
  }
}

async function withApi(): Promise<SyncApi> {
  const state = await getSyncState();
  if (!state) throw Error("Not synced yet");
  return api(state.deviceID);
}

/** Answer sync messages; call once, in the background. */
export function handleSyncMessages() {
  Host.onMessage((message, _sender, sendResponse) => {
    if (!isSyncMessage(message)) return;
    handle(message).then(
      (value) => sendResponse({ ok: true, value: value ?? undefined }),
      (e) => sendResponse({ ok: false, error: String(e?.message ?? e) })
    );
    return true; // Chrome: the response comes asynchronously
  });
}
