import {
  BlockingResponse,
  Host,
  WebAuthenticationChallengeDetails,
  WebResponseDetails,
} from "./adapters";
import { setIndicator } from "./services/indicator";
import { getAuthInfos, getCurrentProxySetting } from "./services/proxy";
import { initializePresetProfiles } from "./presets";

// indicator
async function initIndicator() {
  await setIndicator(await getCurrentProxySetting());
  Host.onProxyChanged(async () => {
    await setIndicator(await getCurrentProxySetting());
  });
}

initIndicator().catch(console.error);

// proxy auth provider
class ProxyAuthProvider {
  // requests[requestID] = request attempts. 0 means the 1st attempt
  static requests: Record<string, number> = {};

  static onCompleted(details: WebResponseDetails) {
    if (ProxyAuthProvider.requests[details.requestId]) {
      delete ProxyAuthProvider.requests[details.requestId];
    }
  }

  static onAuthRequired(
    details: WebAuthenticationChallengeDetails,
    callback?: (response: BlockingResponse) => void
  ) {
    if (!details.isProxy) {
      callback && callback({ cancel: true });
      return;
    }

    if (ProxyAuthProvider.requests[details.requestId] === undefined) {
      // 0 means the 1st attempt
      ProxyAuthProvider.requests[details.requestId] = 0;
    } else {
      ProxyAuthProvider.requests[details.requestId]++;
    }

    getAuthInfos(details.challenger.host, details.challenger.port).then(
      (authInfos) => {
        const auth = authInfos.at(
          ProxyAuthProvider.requests[details.requestId]
        );
        if (!auth) {
          callback && callback({ cancel: true });
          return;
        }

        callback &&
          callback({
            authCredentials: {
              username: auth.username,
              password: auth.password,
            },
          });
      }
    );
  }
}

Host.onWebRequestAuthRequired(ProxyAuthProvider.onAuthRequired);
Host.onWebRequestCompleted(ProxyAuthProvider.onCompleted);
Host.onWebRequestErrorOccurred(ProxyAuthProvider.onCompleted);
Host.onProxyError(console.warn);

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await initializePresetProfiles();
  })();
});
