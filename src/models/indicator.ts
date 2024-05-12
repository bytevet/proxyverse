import { SystemProfile } from "./profile";
import { ProxySetting } from "./proxy";

export async function setIndicator(proxy: ProxySetting) {
  const curMode = proxy.setting.value?.mode
  let profile = proxy.setting.levelOfControl == 'controlled_by_this_extension' ?
    proxy.activeProfile : undefined

  // overide profile
  switch (curMode) {
    case 'system':
      profile = SystemProfile.SYSTEM
      break
    case 'direct':
      profile = SystemProfile.DIRECT
      break
  }

  if (profile) {
    await setBadge(profile.profileName, profile.color)
  } else {
    // clear badge
    await setBadge('', SystemProfile.SYSTEM.color)
  }
}

async function setBadge(text: string, color: string) {
  await chrome.action.setBadgeText({
    text: text.trimStart().substring(0, 2)
  })
  await chrome.action.setBadgeBackgroundColor({
    color: color
  })
}