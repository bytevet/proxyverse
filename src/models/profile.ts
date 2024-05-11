import { get, set } from "./store"


export type ProxyServer = (chrome.proxy.ProxyServer & {
  auth?: {
    username: string,
    password: string,
  },
  scheme: 'direct' | 'http' | 'https' | 'socks4' | 'socks5'
})

type ProxyConfigSimple = {
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

export type ProfileConfig = {
  profileID: string,
  color: string,
  profileName: string,

} & (ProxyConfigSimple)


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