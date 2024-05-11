import { ProxySetting } from "./proxy";

export async function setIndicator(proxy: ProxySetting) {
  const curMode = proxy.setting.value?.mode

  switch (curMode) {
    case 'system':
      return await setBadge('', '#000000')

    case 'direct':
      return await setBadge('DIRECT', '#7ad39e')
  }

  if (proxy.activeProfile) {
    await setBadge(proxy.activeProfile.profileName, proxy.activeProfile.color)
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