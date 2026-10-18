import {
  BlockingResponse,
  Host,
  WebAuthenticationChallengeDetails,
  WebResponseDetails,
} from "./adapters";
import {
  WebRequestBeforeRequestDetails,
  WebRequestCompletedDetails,
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./adapters/base";
import { TabIndicator } from "./services/indicator";
import {
  createProfileFinder,
  getAuthInfos,
  getCurrentProxySetting,
  onActiveProfileChanged,
  refreshProxyOnProfileUpdate,
} from "./services/proxy";
import { WebRequestStatsService } from "./services/stats";
import {
  handlePacRefreshAlarm,
  reconcilePacAlarms,
  refreshActivePacIfStale,
} from "./services/proxy/pacFetcher";
import { onProfileUpdate } from "./services/profile";

// indicator
const tabIndicator = new TabIndicator(
  async () => (await getCurrentProxySetting()).activeProfile
);

// the badge follows the proxy setting, and edits of the active profile
// (e.g. a new color leaves the proxy setting unchanged)
const refreshIndicator = () => tabIndicator.refresh().catch(console.error);
Host.onProxyChanged(refreshIndicator);
onActiveProfileChanged(refreshIndicator);
refreshIndicator();

// Keep the proxy config in sync with the stored profiles, whichever context
// changed them (config page, popup, import, PAC refresh).
onProfileUpdate((profiles, old) => {
  refreshProxyOnProfileUpdate(profiles, old).catch(console.error);
});

// Per-profile PAC script refresh. Each PAC profile with a sourceURL and a
// positive refresh interval owns a `pac-refresh:<profileID>` alarm. The
// wake-time refresh only hits the active profile (with a staleness guard) —
// the SW wakes on every main-frame request, so fetching all URL-backed
// profiles here would mean back-to-back PAC requests during normal browsing.
function initPacRefresh() {
  Host.onAlarm((name) => {
    handlePacRefreshAlarm(name).catch(console.error);
  });

  onProfileUpdate((profiles) => {
    reconcilePacAlarms(profiles).catch(console.error);
  });

  Promise.all([reconcilePacAlarms(), refreshActivePacIfStale()]).catch(
    console.error,
  );
}

initPacRefresh();

// proxy auth provider
class ProxyAuthProvider {
  // requests[requestID] = request attempts. 0 means the 1st attempt
  static requests: Record<string, number> = {};

  static onCompleted(
    details: WebResponseDetails | WebRequestErrorOccurredDetails,
  ) {
    if (ProxyAuthProvider.requests[details.requestId]) {
      delete ProxyAuthProvider.requests[details.requestId];
    }
  }

  static onAuthRequired(
    details: WebAuthenticationChallengeDetails,
    asyncCallback?: (response: BlockingResponse) => void,
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
          ProxyAuthProvider.requests[details.requestId],
        );
        if (!auth) {
          asyncCallback && asyncCallback({});
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
      },
    );
  }
}

Host.onWebRequestAuthRequired(ProxyAuthProvider.onAuthRequired);
Host.onWebRequestCompleted(ProxyAuthProvider.onCompleted);
Host.onWebRequestErrorOccurred(ProxyAuthProvider.onCompleted);

// web request stats
class StatsProvider {
  // the badge signals failures the user hasn't seen yet
  static stats: WebRequestStatsService = new WebRequestStatsService((s) =>
    tabIndicator.setFailures(s.tabID, s.unseenFailures).catch(console.warn)
  );

  static async onResponseStarted(details: WebRequestResponseStartedDetails) {
    if (details.type !== "main_frame") {
      // ignore all non-main-frame requests
      return;
    }
    const proxySetting = await getCurrentProxySetting();
    if (details.tabId > 0 && proxySetting.activeProfile) {
      if (!URL.canParse(details.url)) {
        return;
      }
      const find = await createProfileFinder(proxySetting.activeProfile);
      const { profile, uncertain } = await find(details.url);

      if (profile && !uncertain) {
        // Sometimes the indicator doesn't update properly in Chrome, so we need to wait a bit.
        setTimeout(
          () => tabIndicator.setTabProfile(details.tabId, profile),
          50
        );
        return;
      }

      await tabIndicator.setTabProfile(
        details.tabId,
        proxySetting.activeProfile
      );
    }
  }

  static onBeforeRequest(details: WebRequestBeforeRequestDetails) {
    StatsProvider.stats.addRequest(details);
  }

  static onRequestCompleted(details: WebRequestCompletedDetails) {
    StatsProvider.stats.completeRequest(details);
  }

  static onRequestError(details: WebRequestErrorOccurredDetails) {
    StatsProvider.stats.addFailedRequest(details);
  }

  static onTabRemoved(tabID: number) {
    tabIndicator.removeTab(tabID);
    StatsProvider.stats.closeTab(tabID);
  }
}

// resume signaling failures after the service worker restarted
StatsProvider.stats.restore().catch(console.warn);
Host.onWebRequestBeforeRequest(StatsProvider.onBeforeRequest);
Host.onWebRequestResponseStarted(StatsProvider.onResponseStarted);
Host.onWebRequestCompleted(StatsProvider.onRequestCompleted);
Host.onWebRequestErrorOccurred(StatsProvider.onRequestError);
Host.onTabRemoved(StatsProvider.onTabRemoved);

Host.onProxyError(console.warn);
