import { ProfileConfig } from "../profile"
import { get, set } from "../store"
import { SimpleProxyValue, genSimpleProxyCfg } from "./proxyRules"

export type ProxyValue = SimpleProxyValue

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

export async function setProxy(val: ProxyValue) {
  switch (val) {
    case 'system':
    case 'direct':
      await defaultSetProxy(genSimpleProxyCfg(val), val)
      return
  }

  switch (val.proxyType) {
    case 'proxy':
    case 'pac':
      await defaultSetProxy(genSimpleProxyCfg(val), val)
      return
  }
}


async function defaultSetProxy(cfg: chrome.proxy.ProxyConfig, meta: ProxyValue) {
  await chrome.proxy.settings.set({
    value: cfg,
    scope: "regular",
  })

  if (typeof meta != 'string' && meta.profileID) {
    await set<ProfileConfig>(keyActiveProfile, meta)
  }
}
