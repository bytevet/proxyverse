import { BaseAdapter } from "./base";
import { Chrome } from "./chrome";
import { Firefox } from "./firefox";
import { WebBrowser } from "./web";

function chooseAdapter(): BaseAdapter {
  // Firefox supports browser.* and chrome.* APIs
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
  if (globalThis.browser?.proxy) {
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
