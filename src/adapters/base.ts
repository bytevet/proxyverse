import type { Runtime, Tabs, WebRequest } from "webextension-polyfill";

export type WebAuthenticationChallengeDetails =
  | chrome.webRequest.OnAuthRequiredDetails
  | WebRequest.OnAuthRequiredDetailsType;
export type BlockingResponse = chrome.webRequest.BlockingResponse;

// Firefox reports the proxy a request used (null when direct), which the
// webextension-polyfill types lack
export type WithProxyInfo = {
  proxyInfo?: { host: string; port: number; type: string } | null;
};

export type WebRequestResponseStartedDetails = (
  | chrome.webRequest.OnResponseStartedDetails
  | WebRequest.OnResponseStartedDetailsType
) &
  WithProxyInfo;

export type WebRequestCompletedDetails = (
  | chrome.webRequest.OnCompletedDetails
  | WebRequest.OnCompletedDetailsType
) &
  WithProxyInfo;

export type WebRequestBeforeRequestDetails =
  | chrome.webRequest.OnBeforeRequestDetails
  | WebRequest.OnBeforeRequestDetailsType;

export type WebRequestErrorOccurredDetails = (
  | chrome.webRequest.OnErrorOccurredDetails
  | WebRequest.OnErrorOccurredDetailsType
) &
  WithProxyInfo;

export type MessageSender =
  | chrome.runtime.MessageSender
  | Runtime.MessageSender;

export type Tab = chrome.tabs.Tab | Tabs.Tab;

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

/**
 * i18n APIs silently drop substitutions passed as a Proxy (e.g. a Vue
 * reactive array), so they always get a plain array.
 */
export function plainSubstitutions(substitutions?: string | string[]) {
  return typeof substitutions === "object"
    ? Array.from(substitutions, String)
    : substitutions;
}

/**
 * A UI language chosen in the extension, overriding the browser's, which
 * is all the native i18n APIs know (see `src/services/i18n.ts`).
 */
export type MessageOverride = {
  locale: string; // BCP 47, e.g. "zh-CN"
  getMessage(key: string, substitutions?: string | string[]): string;
};
let messageOverride: MessageOverride | undefined;

export function setMessageOverride(override: MessageOverride | undefined) {
  messageOverride = override;
}

/** The part of the browsers' `identity` API sign-in uses. */
type IdentityAPI = {
  launchWebAuthFlow(details: {
    url: string;
    interactive: boolean;
  }): Promise<string | undefined>;
  getRedirectURL(path: string): string;
};

export const IDENTITY_UNAVAILABLE =
  "The identity API is unavailable in this browser";

/** What this extension build runs on; sync names devices after it. */
export type ExtensionInfo = {
  /** The manifest version, e.g. "2.3.0". */
  version: string;
  browser: "chrome" | "edge" | "firefox" | "web";
  /** runtime.getPlatformInfo's os, e.g. "mac", "win", "linux". */
  os: string;
};

export type ActionBehavior = "popup" | "sidebar";

// the pages the toolbar icon opens
export const POPUP_PAGE = "index.html#/popup";
export const SIDEBAR_PAGE = "index.html#/sidebar";

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
  abstract remove(key: string): Promise<void>;
  async getWithDefault<T>(key: string, defaultVal: T): Promise<T> {
    const ret = await this.get<T>(key);
    if (ret === undefined) {
      return defaultVal;
    }

    return ret;
  }

  // Fires when local storage changes in any extension context, including
  // this one — the browser dispatches the event everywhere.
  abstract onLocalStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void;

  // session storage, cleared when the browser closes
  abstract setSession<T>(key: string, val: T): Promise<void>;
  abstract getSession<T>(key: string): Promise<T | undefined>;
  abstract removeSession(key: string): Promise<void>;
  abstract getAllSession(): Promise<Record<string, unknown>>;
  abstract onSessionStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void;

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
  abstract onWebRequestBeforeRequest(
    callback: (details: WebRequestBeforeRequestDetails) => void
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
  abstract getTab(tabID: number): Promise<Tab | undefined>;
  abstract listTabIDs(): Promise<number[]>;
  abstract onTabRemoved(callback: (tabID: number) => void): void;
  /**
   * Fires when the active tab of the current window changes, or navigates.
   * Returns a function removing the listener.
   */
  abstract onActiveTabChanged(callback: () => void): () => void;

  // toolbar action: what a click on the toolbar icon opens
  abstract sidebarSupported(): boolean;
  abstract applyActionBehavior(behavior: ActionBehavior): Promise<void>;
  /** Background only: set up what a toolbar click opens, if not a popup. */
  handleToolbarClicks(): void {}
  abstract reloadTab(tabID: number): Promise<void>;

  // identity: sign-in through a browser-hosted web auth flow (cloud sync).
  // Chrome and Firefox share the API; it's absent where a browser lacks it
  // (e.g. Firefox for Android, some Chromium forks).
  protected identity(): IdentityAPI | undefined {
    return undefined;
  }

  /** Resolves with the final redirect URL of the flow. */
  async launchWebAuthFlow(url: string, interactive: boolean): Promise<string> {
    const identity = this.identity();
    if (!identity) throw new Error(IDENTITY_UNAVAILABLE);
    const redirect = await identity.launchWebAuthFlow({ url, interactive });
    if (!redirect) throw new Error("The web auth flow returned no redirect URL");
    return redirect;
  }

  /** The extension's redirect URL for `path`, e.g. "/oauth". */
  getRedirectURL(path: string): string {
    const identity = this.identity();
    if (!identity) throw new Error(IDENTITY_UNAVAILABLE);
    return identity.getRedirectURL(path);
  }
  abstract extensionInfo(): Promise<ExtensionInfo>;

  // messages
  abstract onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void;
  abstract sendMessage(message: any): Promise<any>;

  // alarms
  abstract createPeriodicAlarm(
    name: string,
    periodInMinutes: number
  ): Promise<void>;
  abstract clearAlarm(name: string): Promise<void>;
  abstract getAllAlarmNames(): Promise<string[]>;
  abstract onAlarm(callback: (name: string) => void): void;

  // the browser started with a profile that has this extension. Listening
  // also gets the background started then.
  abstract onBrowserStartup(callback: () => void): void;

  // i18n: the chosen language if any, else the browser's. Arrow functions,
  // as `getMessage` is also called unbound, as `$t`.
  readonly currentLocale = (): string =>
    messageOverride?.locale ?? this.nativeLocale();
  readonly getMessage = (
    key: string,
    substitutions?: string | string[]
  ): string =>
    messageOverride?.getMessage(key, substitutions) ??
    this.nativeMessage(key, plainSubstitutions(substitutions));

  protected abstract nativeLocale(): string;
  protected abstract nativeMessage(
    key: string,
    substitutions?: string | string[]
  ): string;

  // compatible issues, return an error message in HTML format
  async error(): Promise<string | undefined> {
    return;
  }
}
