import { Host } from "@/adapters";
import {
  SystemProfile,
  TRUE_PRIVACY_ID,
  onProfileUpdate,
  setTruePrivacyEndpoints,
  type ProxyAuthInfo,
} from "@/services/profile";
import {
  activeRoutesTo,
  getCurrentProxySetting,
  onActiveProfileChanged,
  refreshProxy,
  setProxy,
} from "@/services/proxy";
import type { DynamicAuth } from "@/services/proxy/auth";
import { SyncApiError } from "@/services/sync/api";
import { currentSyncApi } from "@/services/sync/index";
import {
  getSyncAuth,
  isSignedIn,
  keySyncAuth,
  keySyncState,
  onSyncStorageChanged,
  type SyncAuth,
} from "@/services/sync/state";
import { withLock } from "@/services/utils";
import { getTruePrivacyEnabled, onTruePrivacyEnabledChanged } from "./setting";
import {
  getTruePrivacyStatus,
  getTruePrivacyUsage,
  keyTruePrivacyStatus,
  keyTruePrivacyUsage,
  OK_STATUS,
  WEBRTC_PERMISSION,
  type TruePrivacyStatus,
} from "./state";

/**
 * True Privacy Proxy in the background: the access token the proxy nodes
 * take as the password, the usage pages show, and switching away from the
 * proxy when it can't be used any more.
 */

type StoredToken = {
  token: string;
  /** Expiry (ms). */
  expiresAt: number;
};

const keyToken = "trueprivacy.token";
const keyForcedAt = "trueprivacy.forcedAt";
// get a new token this long before the old one expires
const REFRESH_MARGIN_MS = 5 * 60_000;
// replace a refused token at most this often: when the nodes refuse every
// token, asking again would only spend the rate limit (shared with sync)
const MIN_FORCED_REFRESH_INTERVAL_MS = 60_000;
const USAGE_MAX_AGE_MS = 60_000;
const ERROR_BACKOFF_MS = 30_000;

const now = () => Date.now();

// every open page follows the status: write it only when it changes
async function setStatus(status: TruePrivacyStatus) {
  const old = await getTruePrivacyStatus();
  if (JSON.stringify(old) === JSON.stringify(status)) return;
  await Host.setSession(keyTruePrivacyStatus, status);
}

/** Whether the user can use the proxy: signed in and turned on. */
async function truePrivacyWanted(): Promise<boolean> {
  const [auth, enabled] = await Promise.all([
    getSyncAuth(),
    getTruePrivacyEnabled(),
  ]);
  return isSignedIn(auth) && enabled;
}

/**
 * A valid access token, fetching a new one when it's close to expiry, or
 * when the nodes refused `rejected`. Undefined when the proxy can't be used:
 * the nodes then answer 407 and requests fail (fail closed).
 */
export function getProxyToken(rejected?: string): Promise<string | undefined> {
  return withLock("proxyverse-trueprivacy-token", async () => {
    const cached = await Host.getSession<StoredToken>(keyToken);
    const valid = cached && cached.expiresAt > now() ? cached : undefined;

    if (rejected === undefined) {
      if (valid && valid.expiresAt - now() > REFRESH_MARGIN_MS) return valid.token;
    } else if (valid && valid.token !== rejected) {
      return valid.token; // already replaced, by another challenge
    } else {
      const forcedAt = (await Host.getSession<number>(keyForcedAt)) ?? 0;
      if (now() - forcedAt < MIN_FORCED_REFRESH_INTERVAL_MS) return valid?.token;
      await Host.setSession(keyForcedAt, now());
    }

    if (!(await truePrivacyWanted())) {
      await Host.removeSession(keyToken);
      return undefined;
    }
    const status = await getTruePrivacyStatus();
    if (status.retryAt && status.retryAt > now()) return valid?.token;

    const api = await currentSyncApi();
    if (!api) {
      await setStatus({ state: "not_ready" });
      return undefined;
    }

    try {
      const issued = await api.issueProxyToken();
      if (await setTruePrivacyEndpoints(issued.endpoints)) {
        await reapplyIfUsed();
      }
      if (!issued.endpoints.length) {
        // no nodes on this environment: nothing to use the token with
        throw new SyncApiError(503, "unavailable", "no proxy nodes");
      }
      await Host.setSession<StoredToken>(keyToken, {
        token: issued.token,
        expiresAt: issued.expiresAt * 1000,
      });
      await setStatus(OK_STATUS);
      return issued.token;
    } catch (e) {
      const failed = await failure(e);
      await setStatus(failed);
      if (failed.state === "suspended") await stopUsing();
      // a transient failure keeps the old token while it lasts
      return failed.state === "error" ? valid?.token : undefined;
    }
  });
}

function failure(e: unknown): TruePrivacyStatus {
  if (!(e instanceof SyncApiError)) {
    return { state: "error", retryAt: now() + ERROR_BACKOFF_MS };
  }
  switch (e.code) {
    case "proxy_suspended":
      return { state: "suspended" };
    case "invalid_token":
    case "device_revoked":
      return { state: "signed_out" };
    case "unavailable":
      return { state: "unavailable", retryAt: now() + ERROR_BACKOFF_MS };
    default:
      return {
        state: "error",
        retryAt: now() + (e.retryAfter ? e.retryAfter * 1000 : ERROR_BACKOFF_MS),
      };
  }
}

const credentials = (token: string): ProxyAuthInfo => ({
  username: "pv",
  password: token,
});

/**
 * The credentials of True Privacy Proxy for the auth provider: the current
 * token, then a new one when the nodes refused it. Nothing more after that.
 */
export const truePrivacyAuth: DynamicAuth = async (profile, attempt) => {
  if (profile.profileID !== TRUE_PRIVACY_ID) return [];
  if (attempt === 0) {
    const token = await getProxyToken();
    return token ? [credentials(token)] : [];
  }
  if (attempt === 1) {
    const old = (await Host.getSession<StoredToken>(keyToken))?.token;
    const token = await getProxyToken(old ?? "");
    return token ? [credentials(old ?? token), credentials(token)] : [];
  }
  return [];
};

/** This month's usage, from byte.vet when the stored one is over a minute old. */
export function refreshUsage(): Promise<void> {
  return withLock("proxyverse-trueprivacy-usage", async () => {
    const stored = await getTruePrivacyUsage();
    if (stored && now() - stored.fetchedAt < USAGE_MAX_AGE_MS) return;
    if (!(await truePrivacyWanted())) return;
    const api = await currentSyncApi();
    if (!api) return;
    try {
      const usage = await api.getProxyUsage();
      await Host.setSession(keyTruePrivacyUsage, { usage, fetchedAt: now() });
      if (usage.status === "suspended") {
        await setStatus({ state: "suspended" });
        await stopUsing();
      }
    } catch (e) {
      // keep showing the last usage; don't ask again for a while
      if (stored) {
        await Host.setSession(keyTruePrivacyUsage, { ...stored, fetchedAt: now() });
      }
      console.warn("True Privacy Proxy usage:", e);
    }
  });
}

/** Whether the active profile is True Privacy Proxy, or routes to it. */
const truePrivacyInUse = async () =>
  (await activeRoutesTo(TRUE_PRIVACY_ID)).routes;

/** Re-apply the active profile when it routes to True Privacy Proxy. */
async function reapplyIfUsed() {
  if (await truePrivacyInUse()) await refreshProxy();
}

// the policy last set, so a burst of triggers writes the browser setting once
let webRTCApplied: boolean | undefined;
let webRTCScheduled = false;

/**
 * WebRTC can reveal the real IP around the proxy. While True Privacy Proxy
 * may carry traffic, keep WebRTC to the proxy; give the browser's default
 * back otherwise. The policy is global, as the browser has no per-site one.
 * Needs the optional `privacy` permission, asked for when it's turned on.
 */
export async function applyWebRTCPolicy() {
  const [granted, inUse] = await Promise.all([
    Host.hasPermission(WEBRTC_PERMISSION),
    truePrivacyInUse(),
  ]);
  if (!granted) {
    webRTCApplied = undefined; // set it again once granted
    return;
  }
  if (inUse === webRTCApplied) return;
  await Host.setWebRTCProxyOnly(inUse);
  webRTCApplied = inUse;
}

/** Apply the policy once for a burst of triggers (one switch fires several). */
function scheduleWebRTCPolicy() {
  if (webRTCScheduled) return;
  webRTCScheduled = true;
  setTimeout(() => {
    webRTCScheduled = false;
    applyWebRTCPolicy().catch(console.error);
  }, 0);
}

/**
 * The proxy can't be used any more (turned off, signed out, suspended):
 * forget the token, and switch to Direct if it's the active profile. Rules
 * that route to it are left alone, so their sites fail rather than go out
 * without it.
 */
async function stopUsing() {
  const [{ activeProfile }] = await Promise.all([
    getCurrentProxySetting(),
    Host.removeSession(keyToken),
    Host.removeSession(keyTruePrivacyUsage),
  ]);
  if (activeProfile?.profileID === TRUE_PRIVACY_ID) {
    await setProxy(SystemProfile.DIRECT);
  }
}

type TruePrivacyMessage = { type: "trueprivacy:usage" };

export function initTruePrivacy() {
  Host.onMessage((message, _sender, sendResponse) => {
    if ((message as TruePrivacyMessage)?.type !== "trueprivacy:usage") return;
    refreshUsage()
      .catch(console.error)
      .finally(() => sendResponse({ ok: true }));
    return true; // Chrome: the response comes asynchronously
  });

  // `reset`: the situation changed (turned on, signed in), so an earlier
  // failure no longer holds; at start, keep it and its back-off
  const update = async (reset: boolean) => {
    if (await truePrivacyWanted()) {
      if (reset) await setStatus(OK_STATUS);
      // learn the nodes and get a token before the first request needs it
      await getProxyToken();
    } else {
      await stopUsing();
    }
  };
  onTruePrivacyEnabledChanged(() => update(true).catch(console.error));
  onSyncStorageChanged((changes) => {
    const auth = changes[keySyncAuth];
    const signInChanged =
      auth &&
      isSignedIn(auth.newValue as SyncAuth | undefined) !==
        isSignedIn(auth.oldValue as SyncAuth | undefined);
    // the first sync registered the device, which token requests need
    const registered =
      keySyncState in changes && !changes[keySyncState]?.oldValue;
    if (signInChanged || registered) update(true).catch(console.error);
  });
  update(false).catch(console.error);

  Host.onProxyChanged(scheduleWebRTCPolicy);
  onActiveProfileChanged(scheduleWebRTCPolicy);
  onProfileUpdate(scheduleWebRTCPolicy);
  Host.onPermissionsChanged(scheduleWebRTCPolicy);
  scheduleWebRTCPolicy();
}
