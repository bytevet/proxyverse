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
  getSystemProfile,
  serversOf,
} from "../profile";
import { ProxySettingResultDetails } from "@/adapters";
import { ProfileConverter } from "./profile2config";
import { ProfileAuthProvider, type DynamicAuth } from "./auth";
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

/**
 * A built-in profile as it currently is (e.g. True Privacy Proxy through the
 * nodes it uses now); user profiles as given.
 */
async function currentDefinition(profile: ProxyProfile): Promise<ProxyProfile> {
  return getSystemProfile(profile.profileID)
    ? (await getProfile(profile.profileID)) ?? profile
    : profile;
}

export async function setProxy(val: ProxyProfile) {
  val = await currentDefinition(val);
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

  // if it's preset profiles, then do nothing
  if (["system", "direct"].includes(current.activeProfile.proxyType)) {
    return;
  }

  // The active profile was deleted (here, or by sync on another device):
  // fall back to direct rather than keep applying a profile that's gone.
  const newProfile = await getProfile(current.activeProfile.profileID);

  // also refreshes the active profile snapshot
  await setProxy(newProfile ?? SystemProfile.DIRECT);
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
 * The active profile, and whether it is `profileID` or routes to it (through
 * auto switch profiles).
 */
export async function activeRoutesTo(profileID: string) {
  const [{ activeProfile }, profiles] = await Promise.all([
    getCurrentProxySetting(),
    listProfiles(),
  ]);
  if (!activeProfile) return { activeProfile, routes: false };
  profiles[activeProfile.profileID] ??= activeProfile;
  const routes = profileTreeIDs(activeProfile.profileID, profiles).has(profileID);
  return { activeProfile, routes };
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
  port: number,
  attempt = 0,
  dynamicAuth?: DynamicAuth
): Promise<ProxyAuthInfo[]> {
  const stored = await Host.get<ProxyProfile>(keyActiveProfile);
  if (!stored) {
    return [];
  }

  const profile = await currentDefinition(stored);
  const authProvider = new ProfileAuthProvider(
    profile,
    getProfile,
    dynamicAuth
  );
  return await authProvider.getAuthInfos(host, port, attempt);
}

const keyAuthWarmedUp = "proxy-auth-warmed-up";
// never resolves (RFC 2606), so the request goes no further than the proxy
const authWarmUpURL = "http://proxyverse-auth.invalid/";

/**
 * Get the browser to cache the credentials of the active proxy. Browsers
 * don't ask extensions for credentials on requests they can't see (e.g. the
 * new tab page's), and prompt the user instead; once a request of ours got
 * them, they're sent without asking. Runs once per browser session, and
 * again when `force`d (e.g. the proxy setting changed).
 */
export async function warmUpProxyAuth(force = false) {
  if (!force && (await Host.getSession(keyAuthWarmedUp))) return;
  await Host.setSession(keyAuthWarmedUp, true);

  const { activeProfile } = await getCurrentProxySetting();
  if (!activeProfile) return;
  const profiles = await listProfiles();
  profiles[activeProfile.profileID] = activeProfile;
  // stored credentials, or ones a built-in gets at runtime (True Privacy
  // Proxy's token): those are servers of built-ins with none stored
  const hasAuth = [...profileTreeIDs(activeProfile.profileID, profiles)].some(
    (id) => {
      const p = getSystemProfile(id) ?? profiles[id];
      return !!p && serversOf(p).some((s) => s.auth || getSystemProfile(id));
    }
  );
  if (!hasAuth) return;

  // the answer doesn't matter, only that the proxy challenged the request
  await fetch(authWarmUpURL, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
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
