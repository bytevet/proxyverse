import { Host } from "@/adapters";
import type { ProxyUsage } from "@/services/sync/api";

// What every extension context knows about True Privacy Proxy. Only the
// background talks to byte.vet (its rate limit is shared with sync); it
// keeps the results in session storage, where pages read and follow them.

/**
 * Why the proxy can't get a token, or "ok".
 * - `not_ready`: signed in, but the first sync hasn't registered the device
 * - `signed_out`: byte.vet refused the sign-in
 * - `suspended`: the account's proxy access is suspended
 * - `unavailable`: no proxy on this byte.vet environment
 * - `error`: a network or server error; retried later
 */
export type TruePrivacyState =
  | "ok"
  | "not_ready"
  | "signed_out"
  | "suspended"
  | "unavailable"
  | "error";

export type TruePrivacyStatus = {
  state: TruePrivacyState;
  /** Don't ask byte.vet again before this time (ms), e.g. after a 429. */
  retryAt?: number;
};

export type UsageSnapshot = {
  usage: ProxyUsage;
  /** When it was fetched (ms). */
  fetchedAt: number;
};

/** The optional permission WebRTC protection needs (see manifest.json). */
export const WEBRTC_PERMISSION = "privacy";

export const OK_STATUS: TruePrivacyStatus = { state: "ok" };

export const keyTruePrivacyStatus = "trueprivacy.status";
export const keyTruePrivacyUsage = "trueprivacy.usage";

export async function getTruePrivacyStatus(): Promise<TruePrivacyStatus> {
  return (
    (await Host.getSession<TruePrivacyStatus>(keyTruePrivacyStatus)) ??
    OK_STATUS
  );
}

export async function getTruePrivacyUsage(): Promise<UsageSnapshot | undefined> {
  return Host.getSession<UsageSnapshot>(keyTruePrivacyUsage);
}

/** Have the background refresh the usage, if the stored one is old. */
export async function requestTruePrivacyUsage(): Promise<void> {
  await Host.sendMessage({ type: "trueprivacy:usage" }).catch(() => {});
}

/** The share of the quota used, 0 to 1. */
export const usageRatio = (u: ProxyUsage) =>
  u.quota > 0 ? Math.min(1, u.used / u.quota) : 1;

/** The first day of the next period (UTC), when the usage resets. */
export function resetDate(u: ProxyUsage): Date {
  const [y, m] = u.period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)); // months are 0-based: m is the next one
}
