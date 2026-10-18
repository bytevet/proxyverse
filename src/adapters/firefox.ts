import type { Browser, Proxy } from "webextension-polyfill";
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
  WebRequestBeforeRequestDetails,
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./base";

// `browser` is globally typed as `typeof chrome` by @types/chrome; use Firefox typings here
const browser = (globalThis as unknown as { browser: Browser }).browser;

export class Firefox extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    return await browser.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const ret = await browser.storage.local.get(key);
    return ret[key] as T | undefined;
  }

  onLocalStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): void {
    browser.storage.local.onChanged.addListener(callback);
  }

  async setSession<T>(key: string, val: T): Promise<void> {
    await browser.storage.session.set({
      [key]: val,
    });
  }

  async getSession<T>(key: string): Promise<T | undefined> {
    const ret = await browser.storage.session.get(key);
    return ret[key] as T | undefined;
  }

  async removeSession(key: string): Promise<void> {
    await browser.storage.session.remove(key);
  }

  async getAllSession(): Promise<Record<string, unknown>> {
    return await browser.storage.session.get(null);
  }

  onSessionStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    browser.storage.session.onChanged.addListener(callback);
    return () => browser.storage.session.onChanged.removeListener(callback);
  }

  async setProxy(cfg: ProxyConfig): Promise<void> {
    const proxyCfg: Proxy.ProxyConfig = {};

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
    browser.proxy.onError.addListener(callback as any);
  }
  onProxyChanged(callback: (setting: ProxySettingResultDetails) => void): void {
    browser.proxy.settings.onChange.addListener(callback as any);
  }

  async setBadge(text: string, color: string, tabID?: number): Promise<void> {
    await browser.action.setBadgeText({
      text,
      tabId: tabID,
    });
    await browser.action.setBadgeBackgroundColor({
      color: color,
      tabId: tabID,
    });
  }

  async getTab(tabID: number): Promise<Tab | undefined> {
    return await browser.tabs.get(tabID).catch(() => undefined);
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

  async reloadTab(tabID: number): Promise<void> {
    await browser.tabs.reload(tabID);
  }

  onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void {
    browser.runtime.onMessage.addListener(callback as any);
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

  onWebRequestBeforeRequest(
    callback: (details: WebRequestBeforeRequestDetails) => void
  ): void {
    browser.webRequest.onBeforeRequest.addListener(callback as any, {
      urls: ["<all_urls>"],
    });
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

  async createPeriodicAlarm(
    name: string,
    periodInMinutes: number
  ): Promise<void> {
    await browser.alarms.create(name, { periodInMinutes });
  }
  async clearAlarm(name: string): Promise<void> {
    await browser.alarms.clear(name);
  }
  async getAllAlarmNames(): Promise<string[]> {
    const all = await browser.alarms.getAll();
    return all.map((a) => a.name);
  }
  onAlarm(callback: (name: string) => void): void {
    browser.alarms.onAlarm.addListener((alarm) => callback(alarm.name));
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
