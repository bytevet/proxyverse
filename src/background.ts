import { setIndicator } from "./models/indicator";
import { getAuthInfos, getCurrentProxySetting, onCurrentProxySettingChanged } from "./models/proxy";


// indicator
async function initIndicator() {
  await setIndicator(await getCurrentProxySetting())
  onCurrentProxySettingChanged(async (proxy) => {
    await setIndicator(proxy)
  })
}

initIndicator().catch(console.error)


// proxy auth provider
class ProxyAuthProvider {
  // requests[requestID] = request attempts. 0 means the 1st attempt
  static requests: Record<string, number> = {}

  static onCompleted(details: chrome.webRequest.WebResponseDetails) {
    if (ProxyAuthProvider.requests[details.requestId]) {
      delete ProxyAuthProvider.requests[details.requestId]
    }
  }

  static onAuthRequired(details: chrome.webRequest.WebAuthenticationChallengeDetails,
    callback?: (response: chrome.webRequest.BlockingResponse) => void) {

    if (!details.isProxy) {
      callback && callback({ cancel: true })
      return
    }

    if (ProxyAuthProvider.requests[details.requestId] === undefined) {
      // 0 means the 1st attempt
      ProxyAuthProvider.requests[details.requestId] = 0
    } else {
      ProxyAuthProvider.requests[details.requestId]++
    }

    getAuthInfos(details.challenger.host, details.challenger.port).then((authInfos) => {
      const auth = authInfos.at(ProxyAuthProvider.requests[details.requestId])
      if (!auth) {
        callback && callback({ cancel: true })
        return
      }

      callback && callback({
        authCredentials: {
          username: auth.username,
          password: auth.password,
        }
      })
    })
  }
}

chrome.webRequest.onAuthRequired.addListener(ProxyAuthProvider.onAuthRequired, { urls: ["<all_urls>"] }, ['asyncBlocking'])
chrome.webRequest.onCompleted.addListener(ProxyAuthProvider.onCompleted, { urls: ["<all_urls>"] })
chrome.webRequest.onErrorOccurred.addListener(ProxyAuthProvider.onCompleted, { urls: ["<all_urls>"] })
chrome.proxy.onProxyError.addListener(console.warn)
