import { BaseAdapter } from "./base";
import { Chrome } from "./chrome";
import { Firefox } from "./firefox";
import { WebBrowser } from "./web";

function chooseAdapter(): BaseAdapter {
  // Detect Firefox specifically using browser.runtime.getBrowserInfo
  // This is a Firefox-specific API that doesn't exist in Chrome/Edge
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getBrowserInfo
  if (typeof globalThis.browser?.runtime?.getBrowserInfo === "function") {
    return new Firefox();
  }

  if (globalThis.chrome?.proxy) {
    return new Chrome();
  }

  return new WebBrowser();
}

export const Host = chooseAdapter();
export type {
  ProxyConfig,
  WebAuthenticationChallengeDetails,
  BlockingResponse,
  WebRequestCompletedDetails as WebResponseDetails,
  ProxyErrorDetails,
  ProxySettingResultDetails,
  SimpleProxyServer,
  PacScript,
  ProxyRules,
} from "./base";
