import { BaseAdapter } from "./base";
import { Chrome } from "./chrome";
import { WebBrowser } from "./web";

function chooseAdapter(): BaseAdapter {
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
  WebResponseDetails,
  ProxyErrorDetails,
  ProxySettingResultDetails,
  SimpleProxyServer,
  PacScript,
  ProxyRules,
} from "./base";
