import { Host, SimpleProxyServer } from "@/adapters";
import { deepClone } from "./utils";

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
export type AutoSwitchType = "domain" | "cidr" | "url" | "disabled";
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
const onProfileUpdateListeners: ((p: ProfilesStorage) => void)[] = [];

// list all user defined profiles. System profiles are not included
export async function listProfiles(): Promise<ProfilesStorage> {
  const s = await Host.get<ProfilesStorage>(keyProfileStorage);
  return s || {};
}

export function onProfileUpdate(callback: (p: ProfilesStorage) => void) {
  onProfileUpdateListeners.push(callback);
}

async function overwriteProfiles(profiles: ProfilesStorage) {
  await Host.set(keyProfileStorage, deepClone(profiles));
  onProfileUpdateListeners.forEach((cb) => cb(profiles));
}

/**
 * Save a single profile to the storage.
 * Please be noticed that this is not promise-safe. If you want to save multiple profiles, use `saveManyProfiles` instead.
 *
 * @param profile
 */
export async function saveProfile(profile: ProxyProfile) {
  const data = await listProfiles();
  data[profile.profileID] = deepClone(profile);
  await overwriteProfiles(data);
}

export async function saveManyProfiles(profiles: ProxyProfile[]) {
  let data = await listProfiles();
  profiles.forEach((p) => {
    data[p.profileID] = deepClone(p);
  });
  await overwriteProfiles(data);
}

export async function getProfile(
  profileID: string,
  userProfileOnly?: boolean
): Promise<ProxyProfile | undefined> {
  if (!userProfileOnly) {
    // check if it's a system profile
    for (const p of Object.values(SystemProfile)) {
      if (p.profileID === profileID) {
        return p;
      }
    }
  }

  const data = await listProfiles();
  return data[profileID];
}

export async function deleteProfile(profileID: string) {
  const data = await listProfiles();
  delete data[profileID];
  await overwriteProfiles(data);
}
