// this adapter is for local testing purpose

import {
  BaseAdapter,
  BlockingResponse,
  BrowserFlavor,
  ExtensionInfo,
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
} from "./base";

import i18nData from "@/../public/_locales/en/messages.json";
import { formatMessage, lowerCaseKeys } from "./messages";

const english = lowerCaseKeys(i18nData);

export class WebBrowser extends BaseAdapter {
  get flavor() {
    return BrowserFlavor.Web;
  }

  private storageListeners: ((
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>
  ) => void)[] = [];

  async set<T>(key: string, val: T): Promise<void> {
    const oldValue = await this.get(key);
    localStorage.setItem(key, JSON.stringify(val));
    const changes = { [key]: { newValue: val, oldValue } };
    this.storageListeners.forEach((cb) => cb(changes));
  }
  async get<T>(key: string): Promise<T | undefined> {
    let s: any;
    s = localStorage.getItem(key);
    return s && JSON.parse(s);
  }
  async remove(key: string): Promise<void> {
    const oldValue = await this.get(key);
    localStorage.removeItem(key);
    const changes = { [key]: { newValue: undefined, oldValue } };
    this.storageListeners.forEach((cb) => cb(changes));
  }

  onLocalStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    this.storageListeners.push(callback);
    return () => {
      this.storageListeners = this.storageListeners.filter((l) => l !== callback);
    };
  }

  private session: Record<string, unknown> = {};
  private sessionListeners: ((
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>
  ) => void)[] = [];

  async setSession<T>(key: string, val: T): Promise<void> {
    this.session[key] = val;
    const changes = { [key]: { newValue: val } };
    this.sessionListeners.forEach((cb) => cb(changes));
  }
  async getSession<T>(key: string): Promise<T | undefined> {
    return this.session[key] as T | undefined;
  }
  async getAllSession(): Promise<Record<string, unknown>> {
    return { ...this.session };
  }
  async removeSession(key: string): Promise<void> {
    delete this.session[key];
    const changes = { [key]: { newValue: undefined } };
    this.sessionListeners.forEach((cb) => cb(changes));
  }
  onSessionStorageChanged(
    callback: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  ): () => void {
    this.sessionListeners.push(callback);
    return () => {
      this.sessionListeners = this.sessionListeners.filter(
        (cb) => cb !== callback
      );
    };
  }

  async setProxy(_: ProxyConfig): Promise<void> {
    window.localStorage.setItem("proxy", JSON.stringify(_));
  }
  async clearProxy(): Promise<void> {
    window.localStorage.removeItem("proxy");
  }
  async getProxySettings(): Promise<ProxySettingResultDetails> {
    const proxy = window.localStorage.getItem("proxy");
    if (proxy) {
      return {
        levelOfControl: "controlled_by_this_extension",
        value: {
          mode: "pac_script",
          pacScript: {
            url: proxy,
          },
        },
      };
    }
    return {
      levelOfControl: "controlled_by_this_extension",
      value: {
        mode: "system",
      },
    };
  }

  onProxyError(_: (error: ProxyErrorDetails) => void): void {
    throw new Error("Method not implemented.");
  }
  onProxyChanged(_: (setting: ProxySettingResultDetails) => void): void {
    throw new Error("Method not implemented.");
  }

  async setBadge(text: string, color: string, tabID?: number): Promise<void> {
    return console.log(`Badge: ${text}, ${color}, ${tabID}`);
  }
  onTabRemoved(_callback: (tabID: number) => void): void {
    throw new Error("Method not implemented.");
  }
  onActiveTabChanged(_callback: () => void): () => void {
    return () => {};
  }
  sidebarSupported(): boolean {
    return false;
  }
  async applyActionBehavior(behavior: ActionBehavior): Promise<void> {
    console.log(`Toolbar icon opens: ${behavior}`);
  }
  async reloadTab(tabID: number): Promise<void> {
    console.log(`Reload tab: ${tabID}`);
  }


  async extensionInfo(): Promise<ExtensionInfo> {
    return { version: "0.0.0", browser: "web", os: "unknown" };
  }
  async getTab(_tabID: number): Promise<Tab | undefined> {
    return this.getActiveTab();
  }
  async getActiveTab(): Promise<Tab | undefined> {
    return {
      id: 1,
      index: 0,
      url: "https://www.google.com",
      active: true,
      pinned: false,
      highlighted: true,
      incognito: false,
      audible: false,
      autoDiscardable: false,
      discarded: false,
      favIconUrl: "",
    };
  }
  // messages stay within the page, as there's no background here
  private messageListeners: ((
    message: any,
    sender: MessageSender,
    sendResponse: (response: any) => void
  ) => void)[] = [];

  onMessage(
    callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void {
    this.messageListeners.push(callback);
  }
  async sendMessage(message: any): Promise<any> {
    return new Promise((resolve) => {
      this.messageListeners.forEach((cb) => cb(message, {}, resolve));
      if (!this.messageListeners.length) resolve(undefined);
    });
  }

  onWebRequestAuthRequired(
    _: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestBeforeRequest(
    _: (details: WebRequestBeforeRequestDetails) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestResponseStarted(
    _: (details: WebRequestResponseStartedDetails) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestCompleted(
    _: (details: WebRequestCompletedDetails) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestErrorOccurred(
    _: (details: WebRequestErrorOccurredDetails) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  async createPeriodicAlarm(_: string, __: number): Promise<void> {
    // no-op for local dev
  }
  async clearAlarm(_: string): Promise<void> {
    // no-op for local dev
  }
  async getAllAlarmNames(): Promise<string[]> {
    return [];
  }
  onAlarm(_: (name: string) => void): void {
    // no-op for local dev
  }

  protected nativeLocale(): string {
    return "en-US";
  }
  protected nativeMessage(key: string, substitutions?: string | string[]) {
    return formatMessage(english[key.toLowerCase()], substitutions);
  }
}
