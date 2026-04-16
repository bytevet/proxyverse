import { Host } from "@/adapters";
import {
  ProfilesStorage,
  ProfileSimple,
  getProfile,
  listProfiles,
  resolvePacRefreshMinutes,
  saveManyProfiles,
} from "../profile";
import { getCurrentProxySetting, refreshProxy } from "./index";

export const PAC_FETCH_TIMEOUT_MS = 15_000;
export const PAC_REFRESH_ALARM_PREFIX = "pac-refresh:";
// Hard cap on fetched body to avoid runaway memory if a URL misbehaves.
const PAC_BODY_MAX_BYTES = 1_000_000;
// Minimum age of the active profile's last fetch before an SW-wake refresh
// will re-fetch it. Prevents the frequent SW wakes on page loads from
// turning into back-to-back PAC requests.
const PAC_WAKE_REFRESH_STALE_MS = 5 * 60 * 1000;

export class PacFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacFetchError";
  }
}

function isPacRefreshAlarm(name: string): boolean {
  return name.startsWith(PAC_REFRESH_ALARM_PREFIX);
}

export type FetchOptions = {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
};

/** Fetch a PAC script from a URL. Throws PacFetchError on failure. */
export async function fetchPacScript(
  url: string,
  options?: FetchOptions
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? PAC_FETCH_TIMEOUT_MS;
  const fetchFn = options?.fetchFn ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new PacFetchError(`HTTP ${response.status} ${response.statusText}`);
    }

    const body = await response.text();
    if (body.length > PAC_BODY_MAX_BYTES) {
      throw new PacFetchError(
        `PAC script too large (${body.length} > ${PAC_BODY_MAX_BYTES} bytes)`
      );
    }
    return body;
  } catch (e) {
    if (e instanceof PacFetchError) {
      throw e;
    }
    if ((e as Error).name === "AbortError") {
      throw new PacFetchError(`Request timed out after ${timeoutMs}ms`);
    }
    throw new PacFetchError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

export type RefreshResult = {
  profile: ProfileSimple;
  changed: boolean;
};

/**
 * Re-fetch a PAC profile's source URL. Returns an updated profile.
 *
 * - No sourceURL set → returns unchanged, changed=false.
 * - Success with new content → data updated, lastFetched stamped, lastError
 *   cleared, changed=true.
 * - Success with identical content → lastFetched stamped, lastError cleared,
 *   changed=false.
 * - Failure → data preserved, lastError set, changed=false.
 */
export async function refreshPacProfile(
  profile: ProfileSimple,
  options?: FetchOptions
): Promise<RefreshResult> {
  if (profile.proxyType !== "pac") {
    return { profile, changed: false };
  }

  const sourceURL = profile.pacScript.sourceURL?.trim();
  if (!sourceURL) {
    return { profile, changed: false };
  }

  const now = options?.now ?? Date.now;

  try {
    const body = await fetchPacScript(sourceURL, options);
    const previousData = profile.pacScript.data ?? "";
    const changed = body !== previousData;

    const updated: ProfileSimple = {
      ...profile,
      pacScript: {
        ...profile.pacScript,
        data: body,
        sourceURL,
        lastFetched: now(),
        lastError: undefined,
      },
    };
    return { profile: updated, changed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const updated: ProfileSimple = {
      ...profile,
      pacScript: {
        ...profile.pacScript,
        lastError: message,
      },
    };
    return { profile: updated, changed: false };
  }
}

async function refreshProxyIfActive(profileID: string): Promise<void> {
  const current = await getCurrentProxySetting();
  if (current.activeProfile?.profileID === profileID) {
    await refreshProxy();
  }
}

// Persist only when something meaningful to consumers changed. lastFetched
// stamps alone aren't worth a storage write + `onProfileUpdate` fanout — the
// UI's "last fetched" indicator only needs to be accurate after user action
// or a content change.
function shouldPersist(before: ProfileSimple, after: ProfileSimple): boolean {
  if (before.proxyType !== "pac" || after.proxyType !== "pac") return false;
  return (
    before.pacScript.data !== after.pacScript.data ||
    before.pacScript.lastError !== after.pacScript.lastError
  );
}

async function refreshProfile(profile: ProfileSimple): Promise<void> {
  if (profile.proxyType !== "pac") return;
  if (!profile.pacScript.sourceURL?.trim()) return;

  const result = await refreshPacProfile(profile);

  if (shouldPersist(profile, result.profile)) {
    await saveManyProfiles([result.profile]);
  }

  if (result.changed) {
    await refreshProxyIfActive(profile.profileID);
  }
}

export async function handlePacRefreshAlarm(name: string): Promise<void> {
  if (!isPacRefreshAlarm(name)) return;
  const profileID = name.slice(PAC_REFRESH_ALARM_PREFIX.length);
  if (!profileID) return;

  const profile = await getProfile(profileID, true);
  if (!profile || profile.proxyType !== "pac") return;
  await refreshProfile(profile);
}

/**
 * Refresh the active PAC profile if it hasn't been fetched recently. Runs
 * once on service worker wake to close the gap between SW dormancy and the
 * next scheduled alarm tick. Inactive profiles are handled by their own
 * alarms — fetching them on every SW wake would be wasteful, since the SW
 * wakes on every main-frame request.
 */
export async function refreshActivePacIfStale(
  options?: { staleMs?: number; now?: () => number }
): Promise<boolean> {
  const threshold = options?.staleMs ?? PAC_WAKE_REFRESH_STALE_MS;
  const now = options?.now ?? Date.now;

  const current = await getCurrentProxySetting();
  const active = current.activeProfile;
  if (!active || active.proxyType !== "pac") return false;
  if (!active.pacScript.sourceURL?.trim()) return false;

  const lastFetched = active.pacScript.lastFetched ?? 0;
  if (now() - lastFetched < threshold) return false;

  await refreshProfile(active);
  return true;
}

/**
 * Reconcile per-profile refresh alarms against current stored profiles.
 * Creates missing alarms, clears orphans. Idempotent.
 *
 * Note: `chrome.alarms.create` replaces any existing alarm of the same name,
 * resetting its next-tick time. Recreating on every reconcile would push
 * the next fetch out by a full period, so we only (re-)create when the
 * alarm is missing or the period changed.
 */
export async function reconcilePacAlarms(
  profiles?: ProfilesStorage
): Promise<void> {
  const resolved = profiles ?? (await listProfiles());
  const desired = new Map<string, number>();

  for (const profile of Object.values(resolved)) {
    if (profile.proxyType !== "pac") continue;
    if (!profile.pacScript.sourceURL?.trim()) continue;
    const period = resolvePacRefreshMinutes(profile.pacScript);
    if (period <= 0) continue;
    desired.set(
      `${PAC_REFRESH_ALARM_PREFIX}${profile.profileID}`,
      period
    );
  }

  const existingNames = (await Host.getAllAlarmNames()).filter(
    isPacRefreshAlarm
  );
  const existing = new Set(existingNames);

  await Promise.all([
    ...existingNames
      .filter((name) => !desired.has(name))
      .map((name) => Host.clearAlarm(name)),
    ...Array.from(desired.entries())
      .filter(([name]) => !existing.has(name))
      .map(([name, period]) => Host.createPeriodicAlarm(name, period)),
  ]);
}
