import { get, set } from "./store"

export type ProxyAuthInfo = {
  username: string,
  password: string,
}

export interface ProxyServer extends chrome.proxy.ProxyServer {
  auth?: ProxyAuthInfo
  scheme: 'direct' | 'http' | 'https' | 'socks4' | 'socks5'
}

export function sanitizeProxyServer(v: ProxyServer): chrome.proxy.ProxyServer {
  return {
    host: v.host,
    port: v.port
  }
}

type ProxyConfigMeta = {
  profileID: string,
  color: string,
  profileName: string,
}

export type ProxyConfigSimple = ProxyConfigMeta & {
  proxyType: 'proxy' | 'pac',
  proxyRules: {
    default: ProxyServer,
    http?: ProxyServer,
    https?: ProxyServer,
    ftp?: ProxyServer,
    bypassList: string[]
  },
  pacScript: chrome.proxy.PacScript
}

export type ProxyConfigPreset = ProxyConfigMeta & {
  proxyType: 'system' | 'direct'
}

export type ProfileConfig = ProxyConfigSimple | ProxyConfigPreset


export const SystemProfile: Record<string, ProfileConfig> = {
  DIRECT: {
    profileID: '367DEDBC-6750-4454-8321-4E4B088E20B1',
    color: '#7ad39e',
    profileName: 'DIRECT',
    proxyType: 'direct'
  },
  SYSTEM: {
    profileID: '4FDEF36F-F389-4AF3-9BBC-B2E01B3B09E6',
    color: '#0000',
    profileName: '', // no name needed for `system`
    proxyType: 'system'
  },
}


const keyProfileStorage = 'profiles'
export type ProfilesStorage = {
  [key: string]: ProfileConfig
}
const onProfileUpdateListeners: ((p: ProfilesStorage) => void)[] = []

export async function listProfiles(): Promise<ProfilesStorage> {
  const s = await get<ProfilesStorage>(keyProfileStorage)
  return s || {}
}

export function onProfileUpdate(callback: (p: ProfilesStorage) => void) {
  onProfileUpdateListeners.push(callback)
}

async function overwriteProfiles(profiles: ProfilesStorage) {
  await set(keyProfileStorage, profiles)
  onProfileUpdateListeners.map(cb => cb(profiles))
}

export async function saveProfile(profile: ProfileConfig) {
  const data = await listProfiles()
  data[profile.profileID] = profile
  await overwriteProfiles(data)
}

export async function getProfile(profileID: string): Promise<ProfileConfig | undefined> {
  const data = await listProfiles()
  return data[profileID]
}

export async function deleteProfile(profileID: string) {
  const data = await listProfiles()
  delete data[profileID]
  await overwriteProfiles(data)
}