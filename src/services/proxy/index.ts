import { Host } from "@/adapters";
import {
  ProxyProfile,
  ProxyAuthInfo,
  SystemProfile,
  getProfile,
  listProfiles,
  lookupProfile,
  ProfileAutoSwitch,
  ProfilesStorage,
} from "../profile";
import { ProxySettingResultDetails } from "@/adapters";
import { ProfileConverter } from "./profile2config";
import { ProfileAuthProvider } from "./auth";
import { deepClone } from "../utils";

export type ProxySetting = {
  activeProfile?: ProxyProfile;
  setting: ProxySettingResultDetails;
};

const keyActiveProfile = "active-profile";

async function wrapProxySetting(setting: ProxySettingResultDetails) {
  const ret: ProxySetting = {
    setting,
  };

  if (setting.levelOfControl == "controlled_by_this_extension") {
    ret.activeProfile =
      (await Host.get<ProxyProfile>(keyActiveProfile)) || undefined;
  }

  switch (setting.value?.mode) {
    case "system":
      ret.activeProfile = SystemProfile.SYSTEM;
      break;
    case "direct":
      ret.activeProfile = SystemProfile.DIRECT;
      break;
  }

  return ret;
}

/**
 * Subscribe to changes of the active profile, including edits of it (e.g.
 * a new color), in any extension context.
 */
export function onActiveProfileChanged(callback: () => void): () => void {
  return Host.onLocalStorageChanged((changes) => {
    if (keyActiveProfile in changes) callback();
  });
}

export async function getCurrentProxySetting() {
  const setting = await Host.getProxySettings();
  return await wrapProxySetting(setting);
}

export async function setProxy(val: ProxyProfile) {
  const config =
    val.proxyType === "system"
      ? undefined
      : await new ProfileConverter(val, getProfile).toProxyConfig();

  // Save the snapshot before applying, as proxy change listeners (e.g. the
  // badge indicator) read it. Deep clone to remove any Proxy objects.
  await Host.set<ProxyProfile>(keyActiveProfile, deepClone(val));

  if (config) {
    await Host.setProxy(config);
  } else {
    await Host.clearProxy();
  }
}

/**
 * Refresh the current proxy setting. This is useful when the proxy setting is changed by user.
 * @returns
 */
export async function refreshProxy() {
  const current = await getCurrentProxySetting();
  // if it's not controlled by this extension, then do nothing
  if (!current.activeProfile) {
    return;
  }

  const newProfile = await getProfile(current.activeProfile.profileID);

  // if it's preset profiles, then do nothing
  if (!newProfile || ["system", "direct"].includes(current.activeProfile.proxyType)) {
    return;
  }

  // also refreshes the active profile snapshot
  await setProxy(newProfile);
}

/**
 * The IDs of `rootID` and every profile it routes to, directly or through
 * nested auto switch profiles. Missing profiles are included as well.
 */
export function profileTreeIDs(
  rootID: string,
  profiles: ProfilesStorage
): Set<string> {
  const ret = new Set<string>();
  const visit = (profileID: string) => {
    if (ret.has(profileID)) return; // avoid infinite loop
    ret.add(profileID);

    const profile = profiles[profileID];
    if (profile?.proxyType !== "auto") return;
    profile.rules
      .filter((rule) => rule.type !== "disabled")
      .forEach((rule) => visit(rule.profileID));
    visit(profile.defaultProfileID);
  };

  visit(rootID);
  return ret;
}

/**
 * Whether a change of the profiles storage affects the proxy config generated
 * for `rootID`.
 */
export function isProfileTreeChanged(
  rootID: string,
  profiles: ProfilesStorage,
  oldProfiles: ProfilesStorage
): boolean {
  return [...profileTreeIDs(rootID, profiles)].some(
    (id) => JSON.stringify(profiles[id]) !== JSON.stringify(oldProfiles[id])
  );
}

/**
 * Re-apply the active profile when a change of the profiles storage affects
 * it, no matter where the change comes from (config page, import, PAC refresh).
 */
export async function refreshProxyOnProfileUpdate(
  profiles: ProfilesStorage,
  oldProfiles: ProfilesStorage
) {
  const { activeProfile } = await getCurrentProxySetting();
  if (
    activeProfile &&
    isProfileTreeChanged(activeProfile.profileID, profiles, oldProfiles)
  ) {
    await refreshProxy();
  }
}

export async function previewAutoSwitchPac(val: ProfileAutoSwitch) {
  const profile = new ProfileConverter(val, getProfile);
  return await profile.toPAC();
}

export async function getAuthInfos(
  host: string,
  port: number
): Promise<ProxyAuthInfo[]> {
  const profile = await Host.get<ProxyProfile>(keyActiveProfile);
  if (!profile) {
    return [];
  }

  const authProvider = new ProfileAuthProvider(profile, getProfile);
  return await authProvider.getAuthInfos(host, port);
}

export type ResolvedProfile = {
  profile: ProxyProfile | undefined;
  uncertain: boolean;
};

/**
 * Build a resolver that simulates which profile `profile` uses for a URL.
 * Profiles are loaded once, so it's cheap to call for many URLs.
 */
export async function createProfileFinder(profile: ProxyProfile) {
  const profiles = await listProfiles();
  const converter = new ProfileConverter(
    profile,
    async (profileID) => lookupProfile(profiles, profileID)
  );

  return async (url: string): Promise<ResolvedProfile> => {
    try {
      const ret = await converter.findProfile(new URL(url));
      return { profile: ret.profile?.profile, uncertain: !ret.isConfident };
    } catch {
      return { profile: undefined, uncertain: true };
    }
  };
}
