/// <reference types="@types/chrome" />

import {
  BaseAdapter,
  BlockingResponse,
  BrowserFlavor,
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
  POPUP_PAGE,
  SIDEBAR_PAGE,
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

  onLocalStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    chrome.storage.local.onChanged.addListener(callback);
    return () => chrome.storage.local.onChanged.removeListener(callback);
  }

  async setSession<T>(key: string, val: T): Promise<void> {
    await chrome.storage.session.set({
      [key]: val,
    });
  }

  async getSession<T>(key: string): Promise<T | undefined> {
    const ret = await chrome.storage.session.get(key);
    return ret[key] as T | undefined;
  }

  async removeSession(key: string): Promise<void> {
    await chrome.storage.session.remove(key);
  }

  async getAllSession(): Promise<Record<string, unknown>> {
    return await chrome.storage.session.get(null);
  }

  onSessionStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    chrome.storage.session.onChanged.addListener(callback);
    return () => chrome.storage.session.onChanged.removeListener(callback);
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
      text,
      tabId: tabID,
    });
    await chrome.action.setBadgeBackgroundColor({
      color: color,
      tabId: tabID,
    });
  }

  async getTab(tabID: number): Promise<Tab | undefined> {
    return await chrome.tabs.get(tabID).catch(() => undefined);
  }

  async getActiveTab(): Promise<Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  onTabRemoved(callback: (tabID: number) => void): void {
    chrome.tabs.onRemoved.addListener(callback);
  }

  onActiveTabChanged(callback: () => void): () => void {
    let windowID: number | undefined;
    chrome.windows.getCurrent().then((w) => (windowID = w.id));
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (info.windowId === windowID) callback();
    };
    const onUpdated = (
      _: number,
      change: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && tab.windowId === windowID && change.url) callback();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }

  sidebarSupported(): boolean {
    // setPanelBehavior: Chrome 116+
    return typeof chrome.sidePanel?.setPanelBehavior === "function";
  }

  async applyActionBehavior(behavior: ActionBehavior): Promise<void> {
    const sidebar = behavior === "sidebar" && this.sidebarSupported();
    await chrome.action.setPopup({ popup: sidebar ? "" : POPUP_PAGE });
    if (!this.sidebarSupported()) return;
    // off the browser's side panel menu unless chosen
    await chrome.sidePanel.setOptions({ enabled: sidebar, path: SIDEBAR_PAGE });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidebar });
  }

  async reloadTab(tabID: number): Promise<void> {
    await chrome.tabs.reload(tabID);
  }

  onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void {
    chrome.runtime.onMessage.addListener(callback);
  }

  sendMessage(message: any): Promise<any> {
    return chrome.runtime.sendMessage(message);
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

  onWebRequestBeforeRequest(
    callback: (details: WebRequestBeforeRequestDetails) => void
  ): void {
    chrome.webRequest.onBeforeRequest.addListener(callback as any, {
      urls: ["<all_urls>"],
    });
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

  async createPeriodicAlarm(
    name: string,
    periodInMinutes: number
  ): Promise<void> {
    await chrome.alarms.create(name, { periodInMinutes });
  }
  async clearAlarm(name: string): Promise<void> {
    await chrome.alarms.clear(name);
  }
  async getAllAlarmNames(): Promise<string[]> {
    const all = await chrome.alarms.getAll();
    return all.map((a) => a.name);
  }
  onAlarm(callback: (name: string) => void): void {
    chrome.alarms.onAlarm.addListener((alarm) => callback(alarm.name));
  }

  protected nativeLocale(): string {
    return chrome.i18n.getUILanguage();
  }
  protected nativeMessage(key: string, substitutions?: string | string[]) {
    return chrome.i18n.getMessage(key, substitutions);
  }
}
