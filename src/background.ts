import { setIndicator } from "./models/indicator";
import { getCurrentProxySetting, onCurrentProxySettingChanged } from "./models/proxy";


async function initIndicator() {
  await setIndicator(await getCurrentProxySetting())
  onCurrentProxySettingChanged(async (proxy) => {
    await setIndicator(proxy)
  })
}


initIndicator().catch(console.error)