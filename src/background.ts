import {
  BlockingResponse,
  Host,
  WebAuthenticationChallengeDetails,
  WebResponseDetails,
} from "./adapters";
import {
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./adapters/base";
import { setIndicator } from "./services/indicator";
import {
  findProfile,
  getAuthInfos,
  getCurrentProxySetting,
} from "./services/proxy";
import { WebRequestStatsService } from "./services/stats";

// indicator
async function initIndicator() {
  const proxySetting = await getCurrentProxySetting();
  await setIndicator(proxySetting.activeProfile);
  Host.onProxyChanged(async () => {
    const proxySetting = await getCurrentProxySetting();
    await setIndicator(proxySetting.activeProfile);
  });
}

initIndicator().catch(console.error);

// proxy auth provider
class ProxyAuthProvider {
  // requests[requestID] = request attempts. 0 means the 1st attempt
  static requests: Record<string, number> = {};

  static onCompleted(
    details: WebResponseDetails | WebRequestErrorOccurredDetails
  ) {
    if (ProxyAuthProvider.requests[details.requestId]) {
      delete ProxyAuthProvider.requests[details.requestId];
    }
  }

  static onAuthRequired(
    details: WebAuthenticationChallengeDetails,
    asyncCallback?: (response: BlockingResponse) => void
  ): BlockingResponse | undefined {
    if (!details.isProxy) {
      asyncCallback && asyncCallback({});
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
          asyncCallback && asyncCallback({ cancel: true });
          return;
        }

        asyncCallback &&
          asyncCallback({
            authCredentials: {
              username: auth.username,
              password: auth.password,
            },
          });
        return;
      }
    );
  }
}

Host.onWebRequestAuthRequired(ProxyAuthProvider.onAuthRequired);
Host.onWebRequestCompleted(ProxyAuthProvider.onCompleted);
Host.onWebRequestErrorOccurred(ProxyAuthProvider.onCompleted);

// web request stats
class StatsProvider {
  private static stats: WebRequestStatsService = new WebRequestStatsService();

  static async onResponseStarted(details: WebRequestResponseStartedDetails) {
    if (details.type !== "main_frame") {
      // ignore all non-main-frame requests
      return;
    }
    // this.stats.addFailedRequest(details);
    // TODO: update indicator
    const proxySetting = await getCurrentProxySetting();
    console.log("onResponseStarted", details);
    if (details.tabId > 0 && proxySetting.activeProfile) {
      const ret = await findProfile(
        proxySetting.activeProfile,
        new URL(details.url)
      );

      StatsProvider.stats.setCurrentProfile(details.tabId, ret);

      if (ret.profile && ret.isConfident) {
        const profile = ret.profile.profile;
        setTimeout(() => setIndicator(profile, details.tabId), 50); // Sometimes the indicator doesn't update properly in Chrome, so we need to wait a bit.
        return;
      }

      await setIndicator(proxySetting.activeProfile, details.tabId);
    }
  }

  static onRequestError(details: WebRequestErrorOccurredDetails) {
    StatsProvider.stats.addFailedRequest(details);
  }

  static onTabRemoved(tabID: number) {
    StatsProvider.stats.closeTab(tabID);
  }
}
Host.onWebRequestResponseStarted(StatsProvider.onResponseStarted);
Host.onWebRequestErrorOccurred(StatsProvider.onRequestError);
Host.onTabRemoved(StatsProvider.onTabRemoved);

Host.onProxyError(console.warn);
