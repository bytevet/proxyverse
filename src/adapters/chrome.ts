/// <reference types="@types/chrome" />

import {
  BaseAdapter,
  BlockingResponse,
  BrowserFlavor,
  ProxyConfig,
  ProxyErrorDetails,
  ProxySettingResultDetails,
  WebAuthenticationChallengeDetails,
  WebRequestCompletedDetails,
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./base";

export class Chrome extends BaseAdapter {
  get flavor() {
    return BrowserFlavor.Chrome;
  }

  async set<T>(key: string, val: T): Promise<void> {
    return await chrome.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const ret = await chrome.storage.local.get(key);
    return ret[key] as T | undefined;
  }

  async setProxy(cfg: ProxyConfig): Promise<void> {
    await chrome.proxy.settings.set({
      value: cfg,
      scope: "regular",
    });
  }

  async clearProxy(): Promise<void> {
    await chrome.proxy.settings.clear({ scope: "regular" });
  }

  async getProxySettings(): Promise<ProxySettingResultDetails> {
    return (await chrome.proxy.settings.get({})) as any;
  }

  onProxyError(callback: (error: ProxyErrorDetails) => void): void {
    chrome.proxy.onProxyError.addListener(callback);
  }
  onProxyChanged(callback: (setting: ProxySettingResultDetails) => void): void {
    chrome.proxy.settings.onChange.addListener(callback);
  }

  async setBadge(text: string, color: string, tabID?: number): Promise<void> {
    await chrome.action.setBadgeText({
      text: text.trimStart().substring(0, 2),
      tabId: tabID,
    });
    await chrome.action.setBadgeBackgroundColor({
      color: color,
      tabId: tabID,
    });
  }

  onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      asyncCallback?: (response: BlockingResponse) => void
    ) => BlockingResponse | undefined
  ): void {
    chrome.webRequest.onAuthRequired.addListener(
      callback,
      { urls: ["<all_urls>"] },
      ["asyncBlocking"]
    );
  }

  onWebRequestResponseStarted(
    callback: (details: WebRequestResponseStartedDetails) => void
  ): void {
    chrome.webRequest.onResponseStarted.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }

  onWebRequestCompleted(
    callback: (details: WebRequestCompletedDetails) => void
  ): void {
    chrome.webRequest.onCompleted.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }

  onWebRequestErrorOccurred(
    callback: (details: WebRequestErrorOccurredDetails) => void
  ): void {
    chrome.webRequest.onErrorOccurred.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }
  currentLocale(): string {
    return chrome.i18n.getUILanguage();
  }
  getMessage(key: string, substitutions?: string | string[]): string {
    return chrome.i18n.getMessage(key, substitutions);
  }
}
