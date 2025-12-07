export type WebAuthenticationChallengeDetails =
  | chrome.webRequest.OnAuthRequiredDetails
  | browser.webRequest._OnAuthRequiredDetails;
export type BlockingResponse = chrome.webRequest.BlockingResponse;

export type WebRequestResponseStartedDetails =
  | chrome.webRequest.OnResponseStartedDetails
  | browser.webRequest._OnResponseStartedDetails;

export type WebRequestCompletedDetails =
  | chrome.webRequest.OnCompletedDetails
  | browser.webRequest._OnCompletedDetails;

export type WebRequestErrorOccurredDetails =
  | chrome.webRequest.OnErrorOccurredDetails
  | browser.webRequest._OnErrorOccurredDetails;

export type MessageSender =
  | chrome.runtime.MessageSender
  | browser.runtime.MessageSender;

export type Tab = chrome.tabs.Tab | browser.tabs.Tab;

export type ProxyConfig = chrome.proxy.ProxyConfig;

export type ProxyErrorDetails = chrome.proxy.ErrorDetails | Error;
export type ProxySettingResultDetails =
  | chrome.types.ChromeSettingGetResult<ProxyConfig>
  | {
      /**
       * One of
       * • not_controllable: cannot be controlled by any extension
       * • controlled_by_other_extensions: controlled by extensions with higher precedence
       * • controllable_by_this_extension: can be controlled by this extension
       * • controlled_by_this_extension: controlled by this extension
       */
      levelOfControl:
        | "not_controllable"
        | "controlled_by_other_extensions"
        | "controllable_by_this_extension"
        | "controlled_by_this_extension";
      /** The value of the setting. */
      value: ProxyConfig;
      /**
       * Optional.
       * Whether the effective value is specific to the incognito session.
       * This property will only be present if the incognito property in the details parameter of get() was true.
       */
      incognitoSpecific?: boolean | undefined;
    };

export type SimpleProxyServer = {
  host: string;
  port?: number;
  scheme?: "direct" | "http" | "https" | "socks4" | "socks5";
};
export type PacScript = chrome.proxy.PacScript;
export type ProxyRules = chrome.proxy.ProxyRules;

export enum BrowserFlavor {
  Unknown = "unknown",
  Web = "web", // now only for local dev purpose
  Chrome = "chrome",
}

export abstract class BaseAdapter {
  get flavor(): BrowserFlavor {
    return BrowserFlavor.Unknown;
  }

  // local storage
  abstract set<T>(key: string, val: T): Promise<void>;
  abstract get<T>(key: string): Promise<T | undefined>;
  async getWithDefault<T>(key: string, defaultVal: T): Promise<T> {
    const ret = await this.get<T>(key);
    if (ret === undefined) {
      return defaultVal;
    }

    return ret;
  }

  // proxy
  abstract setProxy(cfg: ProxyConfig): Promise<void>;
  abstract clearProxy(): Promise<void>;
  abstract onProxyError(callback: (error: ProxyErrorDetails) => void): void;
  abstract onProxyChanged(
    callback: (setting: ProxySettingResultDetails) => void
  ): void;
  abstract getProxySettings(): Promise<ProxySettingResultDetails>;

  // indicator
  abstract setBadge(text: string, color: string, tabID?: number): Promise<void>;

  // webRequest
  abstract onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      asyncCallback?: (response: BlockingResponse) => void
    ) => BlockingResponse | undefined
  ): void;
  abstract onWebRequestResponseStarted(
    callback: (details: WebRequestResponseStartedDetails) => void
  ): void;
  abstract onWebRequestCompleted(
    callback: (details: WebRequestCompletedDetails) => void
  ): void;
  abstract onWebRequestErrorOccurred(
    callback: (details: WebRequestErrorOccurredDetails) => void
  ): void;

  // tabs
  abstract getActiveTab(): Promise<Tab | undefined>;
  abstract onTabRemoved(callback: (tabID: number) => void): void;

  // messages
  abstract onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void;
  abstract sendMessage(message: any): Promise<any>;

  // i18n
  abstract currentLocale(): string;
  abstract getMessage(key: string, substitutions?: string | string[]): string;

  // compatible issues, return an error message in HTML format
  async error(): Promise<string | undefined> {
    return;
  }
}
