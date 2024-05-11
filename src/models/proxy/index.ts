import { ProfileConfig, SystemProfile } from "../profile"
import { get, set } from "../store"
import { genSimpleProxyCfg } from "./proxyRules"

export type ProxySetting = {
  activeProfile?: ProfileConfig
  setting: chrome.types.ChromeSettingGetResultDetails
}

const keyActiveProfile = 'active-profile'

async function wrapProxySetting(setting: chrome.types.ChromeSettingGetResultDetails) {
  const ret: ProxySetting = {
    setting
  }

  if (setting.levelOfControl == 'controlled_by_this_extension') {
    ret.activeProfile = await get<ProfileConfig>(keyActiveProfile) || undefined
  }

  switch (setting.value?.mode) {
    case 'system':
      ret.activeProfile = SystemProfile.SYSTEM
      break
    case 'direct':
      ret.activeProfile = SystemProfile.DIRECT
      break
  }

  return ret
}

export async function getCurrentProxySetting() {
  const setting: chrome.types.ChromeSettingGetResultDetails = await chrome.proxy.settings.get({}) as any
  return await wrapProxySetting(setting)
}

export function onCurrentProxySettingChanged(cb: (setting: ProxySetting) => void) {
  chrome.proxy.settings.onChange.addListener(async (details) => {
    const ret = await wrapProxySetting(details)
    cb(ret)
  })
}

export async function setProxy(val: ProfileConfig) {
  switch (val.proxyType) {
    case 'system':
      await defaultClearProxy()
      break

    case 'direct':
    case 'proxy':
    case 'pac':
      await defaultSetProxy(genSimpleProxyCfg(val))
      break
  }

  await set<ProfileConfig>(keyActiveProfile, val)
}


async function defaultSetProxy(cfg: chrome.proxy.ProxyConfig) {
  await chrome.proxy.settings.set({
    value: cfg,
    scope: "regular",
  })
}

async function defaultClearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' })
}
