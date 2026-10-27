import { expect, type Page } from "@playwright/test";
import type { ProxyProfile } from "@/services/profile";
import type { SyncState } from "@/services/sync/state";
import type { Servers } from "../servers";
import type { ServiceWorker } from "../fixtures/sw";

// e2e builds sign in as the dev client
const CLIENT_ID = "proxyverse-extension-dev";

/** Point the extension at the fake byte.vet (e2e builds only). */
export async function useFakeByteVet(sw: ServiceWorker, servers: Servers) {
  await sw.eval(
    (origin) => chrome.storage.local.set({ "sync.devOrigin": origin }),
    servers.syncOrigin
  );
}

/**
 * Sign in without the browser's auth window: store tokens the fake server
 * issued, as a completed sign-in does. The background starts syncing.
 */
export async function signInDirectly(sw: ServiceWorker, servers: Servers) {
  await useFakeByteVet(sw, servers);
  const tokens = servers.sync.issueTokens(undefined, CLIENT_ID);
  const { sub, email } = servers.sync.user;
  await sw.eval(
    ({ tokens, account }) =>
      chrome.storage.local.set({
        "sync.auth": {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          account,
        },
      }),
    { tokens, account: { sub, email } }
  );
}

/** Wait until this device has finished a sync run without error. */
export async function expectSynced(sw: ServiceWorker, since = 0) {
  await expect
    .poll(async () => {
      const state = (await sw.getLocal("sync.state")) as SyncState | undefined;
      return state?.lastSync && state.lastSync.at > since && !state.lastSync.error
        ? "synced"
        : JSON.stringify(state?.lastSync ?? state?.phase ?? "not yet");
    }, { timeout: 15_000 })
    .toBe("synced");
}

/** A record of `profile` as another device would have pushed it. */
export function remoteProfile(profile: ProxyProfile, deleted = false) {
  return {
    id: `profile:${profile.profileID}`,
    deleted,
    data: deleted ? null : profile,
    deviceID: "other-device",
  };
}

/** The Sync section of the Preference page. */
export class SyncSection {
  constructor(readonly page: Page) {}

  byId(id: string) {
    return this.page.getByTestId(id);
  }

  async syncNow() {
    await this.byId("pref-sync-now").click();
  }

  /** Click a button guarded by a popconfirm, and confirm. */
  async confirm(testID: string) {
    await this.byId(testID).click();
    await this.page.locator(".arco-popconfirm:visible .arco-btn-primary").click();
  }
}
