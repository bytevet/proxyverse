/// <reference types="@types/chrome" />

import {
  BaseAdapter,
  BlockingResponse,
  ProxyConfig,
  ProxyErrorDetails,
  ProxySettingResultDetails,
  WebAuthenticationChallengeDetails,
  WebRequestCompletedDetails,
  WebRequestErrorOccurredDetails,
} from "./base";

export class Chrome extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    return await chrome.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const ret = await chrome.storage.local.get(key);
    return ret[key];
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

  async setBadge(text: string, color: string): Promise<void> {
    await chrome.action.setBadgeText({
      text: text.trimStart().substring(0, 2),
    });
    await chrome.action.setBadgeBackgroundColor({
      color: color,
    });
  }

  onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
  ): void {
    chrome.webRequest.onAuthRequired.addListener(
      callback,
      { urls: ["<all_urls>"] },
      ["asyncBlocking"]
    );
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
