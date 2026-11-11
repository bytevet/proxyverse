import { Host, SimpleProxyServer } from "@/adapters";
import { deepClone, withLock } from "./utils";
import type { ProxyEndpoint } from "./sync/api";
import { SYNC_BUILD } from "./sync/buildEnv";
import { syncOrigin } from "./sync/config";

export type ProxyAuthInfo = {
  username: string;
  password: string;
};

export type ProxyServer = SimpleProxyServer & {
  auth?: ProxyAuthInfo;
};

export function sanitizeProxyServer(v: ProxyServer): SimpleProxyServer {
  return {
    host: v.host,
    port: v.port,
  };
}

// PAC script configuration. `data` is the effective script text;
// when `sourceURL` is set, `data` is refreshed from that URL periodically.
// `refreshIntervalMinutes`:
//   - undefined → use DEFAULT_PAC_REFRESH_MINUTES
//   - 0         → auto-refresh disabled (manual "Fetch Now" still works)
//   - positive  → refresh every N minutes
export type PacScriptConfig = {
  data?: string;
  sourceURL?: string;
  refreshIntervalMinutes?: number;
  lastFetched?: number;
  lastError?: string;
};

// Default auto-refresh cadence for PAC URLs when the user hasn't chosen one.
export const DEFAULT_PAC_REFRESH_MINUTES = 60;

// Discrete interval options offered in the UI (minutes). `0` means "disabled".
export const PAC_REFRESH_INTERVAL_OPTIONS: number[] = [
  5, 15, 30, 60, 180, 360, 720, 1440, 0,
];

export function resolvePacRefreshMinutes(cfg: PacScriptConfig): number {
  const v = cfg.refreshIntervalMinutes;
  if (v === undefined) {
    return DEFAULT_PAC_REFRESH_MINUTES;
  }
  return v < 0 ? 0 : v;
}

export type ProxyConfigMeta = {
  profileID: string;
  color: string;
  profileName: string;
  proxyType: "proxy" | "pac" | "system" | "direct" | "auto";
  /** What the toolbar badge shows; the name's first 2 characters if unset. */
  badge?: string;
};

// the basic proxy config, with authentication and pac script support
export type ProxyConfigSimple =
  | {
      proxyType: "proxy";
      proxyRules: {
        default: ProxyServer;
        http?: ProxyServer;
        https?: ProxyServer;
        ftp?: ProxyServer;
        bypassList: string[];
      };
      /**
       * Servers the browser tries in order when `proxyRules.default` doesn't
       * answer. The editor doesn't offer them (built-in profiles use them).
       */
      failover?: ProxyServer[];
      pacScript?: PacScriptConfig;
    }
  | {
      proxyType: "pac";
      proxyRules?: {
        default: ProxyServer;
        http?: ProxyServer;
        https?: ProxyServer;
        ftp?: ProxyServer;
        bypassList: string[];
      };
      pacScript: PacScriptConfig;
    };

// advanced proxy config, with auto switch support
export type AutoSwitchType = "domain" | "cidr" | "url" | "regex" | "disabled";
export type AutoSwitchRule = {
  type: AutoSwitchType;
  condition: string;
  profileID: string;
};

export type ProxyConfigAutoSwitch = {
  rules: AutoSwitchRule[];
  defaultProfileID: string;
};

export type ProfileSimple = ProxyConfigMeta & ProxyConfigSimple;

export type ProfilePreset = ProxyConfigMeta & {
  proxyType: "system" | "direct";
};

export type ProfileAutoSwitch = ProxyConfigMeta & {
  proxyType: "auto";
} & ProxyConfigAutoSwitch;

export type ProxyProfile = ProfileSimple | ProfilePreset | ProfileAutoSwitch;

export const TRUE_PRIVACY_ID = "trueprivacy";

/** Where the True Privacy Proxy nodes are, as the last token named them. */
const keyTruePrivacyEndpoints = "trueprivacy.endpoints";
export type { ProxyEndpoint };

/**
 * Stands in for the nodes until byte.vet names them with a token: it never
 * resolves, so requests routed to True Privacy Proxy fail rather than go
 * anywhere else (RFC 6761 `.invalid`).
 */
const NO_TRUE_PRIVACY_NODE: ProxyEndpoint = {
  host: "trueprivacy.invalid",
  port: 443,
};

/**
 * True Privacy Proxy through `endpoints`, in preference order, as byte.vet
 * named them with the last token; nowhere when there are none. Its
 * credentials (a short-lived token) are never part of the profile: the auth
 * provider asks for them.
 *
 * `apiHost` (byte.vet) bypasses it: the extension's own requests follow the
 * proxy settings, and through the proxy a refused token could never be
 * replaced, as the request for a new one would be refused too.
 */
export function truePrivacyProfile(
  endpoints: ProxyEndpoint[] = [],
  apiHost = new URL(SYNC_BUILD.origin).hostname
): ProfileSimple {
  const servers: ProxyServer[] = (
    endpoints.length ? endpoints : [NO_TRUE_PRIVACY_NODE]
  ).map(({ host, port }) => ({ scheme: "https", host, port }));
  return {
    profileID: TRUE_PRIVACY_ID,
    color: "#0B8F80",
    profileName: "True Privacy Proxy",
    badge: "TP",
    proxyType: "proxy",
    proxyRules: { default: servers[0], bypassList: [apiHost] },
    ...(servers.length > 1 ? { failover: servers.slice(1) } : {}),
  };
}

export async function getTruePrivacyEndpoints(): Promise<ProxyEndpoint[]> {
  return (await Host.get<ProxyEndpoint[]>(keyTruePrivacyEndpoints)) ?? [];
}

/** Remember the nodes a token named; true when they changed. */
export async function setTruePrivacyEndpoints(
  endpoints: ProxyEndpoint[]
): Promise<boolean> {
  const old = await getTruePrivacyEndpoints();
  if (JSON.stringify(old) === JSON.stringify(endpoints)) return false;
  await Host.set(keyTruePrivacyEndpoints, endpoints);
  return true;
}

export const SystemProfile: Record<string, ProxyProfile> = {
  DIRECT: {
    profileID: "direct",
    color: "#7ad39e",
    profileName: "Direct",
    proxyType: "direct",
  },
  SYSTEM: {
    profileID: "system",
    color: "#0000",
    profileName: "", // should be empty
    proxyType: "system",
  },
  // with no node; getProfile() gives the current ones
  TRUE_PRIVACY: truePrivacyProfile(),
};

const keyProfileStorage = "profiles";
export type ProfilesStorage = Record<string, ProxyProfile>;
const onProfileUpdateListeners: ((
  p: ProfilesStorage,
  old: ProfilesStorage
) => void)[] = [];
let storageListenerRegistered = false;

// list all user defined profiles. System profiles are not included
export async function listProfiles(): Promise<ProfilesStorage> {
  const s = await Host.get<ProfilesStorage>(keyProfileStorage);
  return s || {};
}

/**
 * Subscribe to profile updates. Fires in every extension context (popup,
 * config page, background) whenever the profiles storage key is written,
 * regardless of which context made the write — backed by the browser's
 * storage change events.
 */
export function onProfileUpdate(
  callback: (p: ProfilesStorage, old: ProfilesStorage) => void
): () => void {
  if (!storageListenerRegistered) {
    storageListenerRegistered = true;
    Host.onLocalStorageChanged((changes) => {
      if (!(keyProfileStorage in changes)) return;
      const { newValue, oldValue } = changes[keyProfileStorage];
      const profiles = (newValue ?? {}) as ProfilesStorage;
      const old = (oldValue ?? {}) as ProfilesStorage;
      onProfileUpdateListeners.forEach((cb) => cb(profiles, old));
    });
  }
  onProfileUpdateListeners.push(callback);
  return () => {
    const i = onProfileUpdateListeners.indexOf(callback);
    if (i >= 0) onProfileUpdateListeners.splice(i, 1);
  };
}

/**
 * Read, change and write back the stored profiles while holding a lock shared
 * by every extension context, so concurrent writers (the config page, PAC
 * refresh, sync) never overwrite each other's changes. `mutate` changes the
 * map in place.
 */
export function updateProfiles(
  mutate: (profiles: ProfilesStorage) => void | Promise<void>
): Promise<void> {
  return withLock("proxyverse-profiles", async () => {
    const data = await listProfiles();
    await mutate(data);
    await Host.set(keyProfileStorage, deepClone(data));
  });
}

/** Save a single profile to the storage. */
export async function saveProfile(profile: ProxyProfile) {
  await updateProfiles((data) => {
    data[profile.profileID] = deepClone(profile);
  });
}

export async function saveManyProfiles(profiles: ProxyProfile[]) {
  await updateProfiles((data) => {
    profiles.forEach((p) => {
      data[p.profileID] = deepClone(p);
    });
  });
}

/** Every proxy server a proxy profile may use, failover included. */
export function serversOf(profile: ProxyProfile): ProxyServer[] {
  if (profile.proxyType !== "proxy") return [];
  const { default: d, http, https, ftp } = profile.proxyRules;
  return [d, http, https, ftp, ...(profile.failover ?? [])].filter(
    (s): s is ProxyServer => !!s
  );
}

export function getSystemProfile(profileID: string): ProxyProfile | undefined {
  return Object.values(SystemProfile).find((p) => p.profileID === profileID);
}

/** Find a system profile, or a user profile in `profiles`. */
export function lookupProfile(
  profiles: ProfilesStorage,
  profileID: string
): ProxyProfile | undefined {
  return getSystemProfile(profileID) ?? profiles[profileID];
}

export async function getProfile(
  profileID: string,
  userProfileOnly?: boolean
): Promise<ProxyProfile | undefined> {
  if (!userProfileOnly) {
    if (profileID === TRUE_PRIVACY_ID) {
      const [endpoints, origin] = await Promise.all([
        getTruePrivacyEndpoints(),
        syncOrigin(),
      ]);
      return truePrivacyProfile(endpoints, new URL(origin).hostname);
    }
    const p = getSystemProfile(profileID);
    if (p) {
      return p;
    }
  }

  const data = await listProfiles();
  return data[profileID];
}

export async function deleteProfile(profileID: string) {
  await updateProfiles((data) => {
    delete data[profileID];
  });
}
