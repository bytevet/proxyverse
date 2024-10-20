import { Host } from "@/adapters";
import {
  ProxyProfile,
  ProxyAuthInfo,
  SystemProfile,
  getProfile,
  ProfileAuthSwitch,
} from "../profile";
import { ProxySettingResultDetails } from "@/adapters";
import { ProfileConverter } from "./profile2config";

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

export async function getCurrentProxySetting() {
  const setting = await Host.getProxySettings();
  return await wrapProxySetting(setting);
}

export function onCurrentProxySettingChanged(
  cb: (setting: ProxySetting) => void
) {
  Host.onProxyChanged(async (setting) => {
    const ret = await wrapProxySetting(setting);
    cb(ret);
  });
}

export async function setProxy(val: ProxyProfile) {
  switch (val.proxyType) {
    case "system":
      await Host.clearProxy();
      break;

    default:
      const profile = new ProfileConverter(val, getProfile);
      await Host.setProxy(await profile.toProxyConfig());
      break;
  }

  await Host.set<ProxyProfile>(keyActiveProfile, val);
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
  if (!newProfile || current.activeProfile.proxyType in ["system", "direct"]) {
    return;
  }

  const profile = new ProfileConverter(newProfile, getProfile);
  await Host.setProxy(await profile.toProxyConfig());
}

export async function previewAutoSwitchPac(val: ProfileAuthSwitch) {
  const profile = new ProfileConverter(val, getProfile);
  return await profile.toPAC();
}

export async function getAuthInfos(
  host: string,
  port: number
): Promise<ProxyAuthInfo[]> {
  const profile = await Host.get<ProxyProfile>(keyActiveProfile);
  if (!profile || profile.proxyType !== "proxy") {
    return [];
  }

  const ret: ProxyAuthInfo[] = [];
  const auths = [
    profile.proxyRules.default,
    profile.proxyRules.ftp,
    profile.proxyRules.http,
    profile.proxyRules.https,
  ];

  // check if there's any matching host and port
  auths.map((item) => {
    if (!item) return;

    if (
      item.host == host &&
      (item.port === undefined || item.port == port) &&
      item.auth
    ) {
      ret.push(item.auth);
    }
  });

  return ret;
}
