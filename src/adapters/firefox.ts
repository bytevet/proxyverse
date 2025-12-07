/// <reference types="@types/firefox-webext-browser" />

import {
  BaseAdapter,
  BlockingResponse,
  MessageSender,
  ProxyConfig,
  ProxyErrorDetails,
  ProxySettingResultDetails,
  Tab,
  WebAuthenticationChallengeDetails,
  WebRequestCompletedDetails,
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./base";

export class Firefox extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    return await browser.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const ret = await browser.storage.local.get(key);
    return ret[key];
  }

  async setProxy(cfg: ProxyConfig): Promise<void> {
    const proxyCfg: browser.proxy.ProxyConfig = {};

    switch (cfg.mode) {
      case "direct":
        proxyCfg.proxyType = "none";
        break;
      case "auto_detect":
        proxyCfg.proxyType = "autoDetect";
        break;
      case "pac_script":
        proxyCfg.proxyType = "autoConfig";
        proxyCfg.autoConfigUrl =
          cfg.pacScript?.url ||
          "data:text/javascript," +
            encodeURIComponent(cfg.pacScript?.data || "");
        break;
      case "system":
        proxyCfg.proxyType = "system";
        break;
    }

    await browser.proxy.settings.set({
      value: proxyCfg,
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

  async setBadge(text: string, color: string, tabID?: number): Promise<void> {
    await browser.action.setBadgeText({
      text: text.trimStart().substring(0, 2),
      tabId: tabID,
    });
    await browser.action.setBadgeBackgroundColor({
      color: color,
      tabId: tabID,
    });
  }

  async getActiveTab(): Promise<Tab | undefined> {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0];
  }

  onTabRemoved(callback: (tabID: number) => void): void {
    browser.tabs.onRemoved.addListener(callback);
  }

  onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void {
    browser.runtime.onMessage.addListener(callback);
  }

  sendMessage(message: any): Promise<any> {
    return browser.runtime.sendMessage(message);
  }

  onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      asyncCallback?: (response: BlockingResponse) => void
    ) => BlockingResponse | undefined
  ): void {
    browser.webRequest.onAuthRequired.addListener(
      callback as any,
      { urls: ["<all_urls>"] },
      ["asyncBlocking"]
    );
  }

  onWebRequestResponseStarted(
    callback: (details: WebRequestResponseStartedDetails) => void
  ): void {
    browser.webRequest.onResponseStarted.addListener(callback, {
      urls: ["<all_urls>"],
    });
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

  // compatible issues
  async error(): Promise<string | undefined> {
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/settings
    if (!(await browser.extension.isAllowedIncognitoAccess())) {
      return browser.i18n.getMessage("firefox_incognito_access_error_html");
    }

    return;
  }
}
