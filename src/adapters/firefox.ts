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
  ActionBehavior,
  ExtensionInfo,
  POPUP_PAGE,
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

  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  }

  onLocalStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    browser.storage.local.onChanged.addListener(callback);
    return () => browser.storage.local.onChanged.removeListener(callback);
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

  onActiveTabChanged(callback: () => void): () => void {
    let windowID: number | undefined;
    browser.windows.getCurrent().then((w) => (windowID = w.id));
    const onActivated = (info: { windowId: number }) => {
      if (info.windowId === windowID) callback();
    };
    const onUpdated = (
      _: number,
      change: { url?: string },
      tab: { active: boolean; windowId?: number }
    ) => {
      if (tab.active && tab.windowId === windowID && change.url) callback();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }

  sidebarSupported(): boolean {
    return browser.sidebarAction !== undefined;
  }

  // With no popup, a click fires `action.onClicked`, which the background
  // turns into `sidebarAction.toggle()` (see `handleToolbarClicks`).
  async applyActionBehavior(behavior: ActionBehavior): Promise<void> {
    const sidebar = behavior === "sidebar" && this.sidebarSupported();
    await browser.action.setPopup({ popup: sidebar ? "" : POPUP_PAGE });
  }

  /**
   * Toggle the sidebar on toolbar clicks. Call at the top level of the
   * background: the toggle must run synchronously in the click handler, and
   * clicks only reach it while no popup is set, i.e. in sidebar mode.
   */
  handleToolbarClicks() {
    browser.action.onClicked.addListener(() => {
      browser.sidebarAction.toggle();
    });
  }

  async reloadTab(tabID: number): Promise<void> {
    await browser.tabs.reload(tabID);
  }

  protected identity() {
    // typed as always there, but absent where the browser lacks the API
    return browser.identity as typeof browser.identity | undefined;
  }

  async extensionInfo(): Promise<ExtensionInfo> {
    const { os } = await browser.runtime.getPlatformInfo();
    return {
      version: browser.runtime.getManifest().version,
      browser: "firefox",
      os,
    };
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

  protected nativeLocale(): string {
    return browser.i18n.getUILanguage();
  }
  protected nativeMessage(key: string, substitutions?: string | string[]) {
    return browser.i18n.getMessage(key, substitutions);
  }

  // compatible issues
  async error(): Promise<string | undefined> {
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/settings
    if (!(await browser.extension.isAllowedIncognitoAccess())) {
      return this.getMessage("firefox_incognito_access_error_html");
    }

    return;
  }
}
