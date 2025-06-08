import { Host, PacScript, SimpleProxyServer } from "@/adapters";

export type ProxyAuthInfo = {
  username: string;
  password: string;
};

export interface ProxyServer extends SimpleProxyServer {
  auth?: ProxyAuthInfo;
  scheme: "direct" | "http" | "https" | "socks4" | "socks5";
}

export function sanitizeProxyServer(v: ProxyServer): SimpleProxyServer {
  return {
    host: v.host,
    port: v.port,
  };
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
      pacScript?: PacScript;
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
      pacScript: PacScript;
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
  await Host.set(keyProfileStorage, profiles);
  onProfileUpdateListeners.map((cb) => cb(profiles));
}

/**
 * Save a single profile to the storage.
 * Please be noticed that this is not promise-safe. If you want to save multiple profiles, use `saveManyProfiles` instead.
 *
 * @param profile
 */
export async function saveProfile(profile: ProxyProfile) {
  const data = await listProfiles();
  data[profile.profileID] = profile;
  await overwriteProfiles(data);
}

export async function saveManyProfiles(profiles: ProxyProfile[]) {
  let data = await listProfiles();
  profiles.forEach((p) => {
    data[p.profileID] = p;
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
