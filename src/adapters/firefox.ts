/// <reference types="@types/firefox-webext-browser" />

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

export class Firefox extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    return await browser.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const ret = await browser.storage.local.get(key);
    return ret[key];
  }

  async setProxy(cfg: ProxyConfig): Promise<void> {
    await browser.proxy.settings.set({
      value: cfg,
      scope: "regular",
    });
  }

  async clearProxy(): Promise<void> {
    await browser.proxy.settings.clear({ scope: "regular" });
  }

  async getProxySettings(): Promise<ProxySettingResultDetails> {
    return (await browser.proxy.settings.get({})) as any;
  }

  onProxyError(callback: (error: ProxyErrorDetails) => void): void {
    browser.proxy.onError.addListener(callback);
  }
  onProxyChanged(callback: (setting: ProxySettingResultDetails) => void): void {
    browser.proxy.settings.onChange.addListener(callback);
  }

  async setBadge(text: string, color: string): Promise<void> {
    await browser.action.setBadgeText({
      text: text.trimStart().substring(0, 2),
    });
    await browser.action.setBadgeBackgroundColor({
      color: color,
    });
  }

  onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
  ): void {
    browser.webRequest.onAuthRequired.addListener(
      callback,
      { urls: ["<all_urls>"] },
      ["asyncBlocking"]
    );
  }

  onWebRequestCompleted(
    callback: (details: WebRequestCompletedDetails) => void
  ): void {
    browser.webRequest.onCompleted.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }

  onWebRequestErrorOccurred(
    callback: (details: WebRequestErrorOccurredDetails) => void
  ): void {
    browser.webRequest.onErrorOccurred.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }
  currentLocale(): string {
    return browser.i18n.getUILanguage();
  }
  getMessage(key: string, substitutions?: string | string[]): string {
    return browser.i18n.getMessage(key, substitutions);
  }
}
