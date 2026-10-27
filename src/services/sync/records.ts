import * as inner from "@/services/profile";
import { exportableProfile } from "@/services/config/proxyverse";
import {
  FORMAT_VERSION,
  ProxyProfile,
} from "@/services/config/proxyverse/schema";
import { DarkMode, defaultDarkMode, keyDarkMode } from "@/services/theme";
import { defaultLanguage, keyLanguage } from "@/services/i18n";
import { defaultActionBehavior, keyActionBehavior } from "@/services/ui";
import { deepClone } from "@/services/utils";

/**
 * The records of sync (spec §3): what local storage turns into on the wire,
 * and back. One profile or one preference is one record.
 */

/** Payload schema version: the config file format (spec §3.5). */
export const PAYLOAD_SCHEMA = FORMAT_VERSION;
/** The only payload encoding v1 reads and writes (spec §3.4). */
export const PAYLOAD_ENCODING = "json";

/** The preferences that sync. New ones are added here explicitly. */
export const SYNCED_PREFS = [
  keyDarkMode,
  keyLanguage,
  keyActionBehavior,
] as const;
export type SyncedPref = (typeof SYNCED_PREFS)[number];

/** Each synced pref's value when unset, from the module that owns it. */
export const SYNCED_PREF_DEFAULTS: Record<SyncedPref, unknown> = {
  [keyDarkMode]: defaultDarkMode,
  [keyLanguage]: defaultLanguage,
  [keyActionBehavior]: defaultActionBehavior,
};

export type ProfilePayload = ProxyProfile;
export type PrefPayload = { value: number | string };
export type Payload = ProfilePayload | PrefPayload;

const PROFILE_PREFIX = "profile:";
const PREF_PREFIX = "pref:";

export const profileRecordID = (profileID: string) =>
  `${PROFILE_PREFIX}${profileID}`;
export const prefRecordID = (key: SyncedPref) => `${PREF_PREFIX}${key}`;

export type ParsedRecordID =
  | { kind: "profile"; profileID: string }
  | { kind: "pref"; key: SyncedPref };

/** What a record ID names; undefined for unknown kinds or prefs. */
export function parseRecordID(id: string): ParsedRecordID | undefined {
  if (id.startsWith(PROFILE_PREFIX)) {
    const profileID = id.slice(PROFILE_PREFIX.length);
    return profileID ? { kind: "profile", profileID } : undefined;
  }
  if (id.startsWith(PREF_PREFIX)) {
    const key = id.slice(PREF_PREFIX.length);
    return isSyncedPref(key) ? { kind: "pref", key } : undefined;
  }
  return undefined;
}

const isSyncedPref = (key: string): key is SyncedPref =>
  (SYNCED_PREFS as readonly string[]).includes(key);

// --- preferences ---

// a numeric enum's values also hold its member names
const DARK_MODES: unknown[] = Object.values(DarkMode).filter(
  (v) => typeof v === "number"
);
// lenient, as on the server: a new locale needs no schema bump
const LANGUAGE_CODE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Whether `value` is valid for pref `key`, by the server's rules (§3.2). */
export function isValidPrefValue(key: SyncedPref, value: unknown): boolean {
  switch (key) {
    case keyDarkMode:
      return DARK_MODES.includes(value);
    case keyLanguage:
      return (
        value === "auto" ||
        (typeof value === "string" && LANGUAGE_CODE.test(value))
      );
    case keyActionBehavior:
      return value === "popup" || value === "sidebar";
  }
}

function decodePref(key: SyncedPref, data: unknown): PrefPayload | undefined {
  if (typeof data !== "object" || data === null || !("value" in data)) {
    return undefined;
  }
  const { value } = data;
  return isValidPrefValue(key, value)
    ? { value: value as PrefPayload["value"] }
    : undefined;
}

// --- profiles ---

/**
 * A profile as it syncs (spec §3.6): the export format, which drops runtime
 * fields (e.g. `pacScript.lastFetched`), without the fetched script of a
 * PAC URL (each device fetches it) and with the color upper-cased, as the
 * profile editor saves it. Undefined for system or invalid profiles.
 */
export function normalizeProfile(
  p: inner.ProxyProfile
): ProfilePayload | undefined {
  // a copy: zod keeps nested arrays' items by reference, and `p` may be
  // a Vue proxy
  const payload = exportableProfile(deepClone(p));
  if (!payload) return undefined;

  payload.color = payload.color.toUpperCase();
  if (payload.proxyType === "pac" && payload.pacScript.sourceURL) {
    delete payload.pacScript.data;
  }
  return payload;
}

/**
 * A remote record's payload, normalized: undefined if this version can't
 * read it (an invalid payload, an unknown pref, a system profile, or a
 * profile not matching its record ID).
 */
export function decodeRemote(id: string, data: unknown): Payload | undefined {
  const parsed = parseRecordID(id);
  if (parsed?.kind === "pref") return decodePref(parsed.key, data);
  if (parsed?.kind === "profile") return decodeProfile(parsed.profileID, data);
  return undefined;
}

function decodeProfile(profileID: string, data: unknown): ProfilePayload | undefined {
  if (inner.getSystemProfile(profileID)) return undefined;

  const profile = ProxyProfile.safeParse(data);
  if (!profile.success || profile.data.profileID !== profileID) {
    return undefined;
  }
  // normalized, so its hash matches the one this device computes once the
  // profile is stored
  return normalizeProfile(profile.data);
}

/**
 * The profile to store for a remote payload. A PAC URL profile whose URL
 * didn't change keeps this device's fetched script and fetch status;
 * otherwise it's stored without a script, so the PAC fetcher fetches it.
 */
export function mergeIncomingProfile(
  remote: ProfilePayload,
  localExisting?: inner.ProxyProfile
): inner.ProxyProfile {
  const merged: inner.ProxyProfile = deepClone(remote);
  const sourceURL =
    merged.proxyType === "pac" ? merged.pacScript.sourceURL : undefined;
  if (
    merged.proxyType !== "pac" ||
    !sourceURL ||
    localExisting?.proxyType !== "pac" ||
    localExisting.pacScript.sourceURL !== sourceURL
  ) {
    return merged;
  }

  const { data, lastFetched, lastError } = localExisting.pacScript;
  merged.pacScript = deepClone({
    ...merged.pacScript,
    data,
    lastFetched,
    lastError,
  });
  return merged;
}

// --- hashing ---

/**
 * JSON with object keys sorted and no whitespace, so equal payloads always
 * serialize, and hash, the same. Like `JSON.stringify`, it drops undefined
 * object members and writes undefined array items as null.
 */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => (v === undefined ? "null" : canonicalJSON(v)))
      .join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const members = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 (hex) of a payload's canonical JSON (spec §3.6). */
export async function hashPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// --- local state ---

export type LocalRecord = { payload: Payload; hash: string };

export type LocalSource = {
  profiles: inner.ProfilesStorage;
  /** Stored values of the synced prefs; unset ones are absent. */
  prefs: Partial<Record<SyncedPref, unknown>>;
  /** Profile IDs that stay on this device (spec §5.6). */
  localOnly: string[];
  syncPrefs: boolean;
};

/**
 * The records this device's storage holds, by record ID. System profiles,
 * local-only and invalid profiles are left out, as are prefs that are unset,
 * invalid, or not synced on this device.
 */
export async function collectLocalRecords({
  profiles,
  prefs,
  localOnly,
  syncPrefs,
}: LocalSource): Promise<Map<string, LocalRecord>> {
  const payloads: [string, Payload][] = [];
  const skipped = new Set(localOnly);

  for (const [key, profile] of Object.entries(profiles)) {
    if (skipped.has(key) || inner.getSystemProfile(key)) continue;
    const payload = normalizeProfile(profile);
    // another device rejects a payload naming a different profile
    if (!payload || payload.profileID !== key) continue;
    payloads.push([profileRecordID(key), payload]);
  }

  if (syncPrefs) {
    for (const key of SYNCED_PREFS) {
      const value = prefs[key];
      if (value === undefined || !isValidPrefValue(key, value)) continue;
      payloads.push([prefRecordID(key), { value: value as PrefPayload["value"] }]);
    }
  }

  const hashes = await Promise.all(payloads.map(([, p]) => hashPayload(p)));
  const records = new Map<string, LocalRecord>(
    payloads.map(([id, payload], i) => [id, { payload, hash: hashes[i] }])
  );

  return records;
}
