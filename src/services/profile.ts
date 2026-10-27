import { Host, SimpleProxyServer } from "@/adapters";
import { deepClone, withLock } from "./utils";

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
