import {
  BaseAdapter,
  BlockingResponse,
  ProxyConfig,
  ProxyErrorDetails,
  WebAuthenticationChallengeDetails,
  WebResponseDetails,
} from "./base";

export class Chrome extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    return await chrome.storage.local.set({
      [key]: val,
    });
  }

  async get<T>(key: string): Promise<T | null> {
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

  onProxyError(callback: (error: ProxyErrorDetails) => void): void {
    chrome.proxy.onProxyError.addListener(callback);
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

  onWebRequestCompleted(callback: (details: WebResponseDetails) => void): void {
    chrome.webRequest.onCompleted.addListener(callback, {
      urls: ["<all_urls>"],
    });
  }

  onWebRequestErrorOccurred(
    callback: (details: WebResponseDetails) => void
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
