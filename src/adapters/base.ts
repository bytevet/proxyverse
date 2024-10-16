export type ProxyConfig = chrome.proxy.ProxyConfig;

export type WebAuthenticationChallengeDetails =
  chrome.webRequest.WebAuthenticationChallengeDetails;
export type BlockingResponse = chrome.webRequest.BlockingResponse;
export type WebResponseDetails = chrome.webRequest.WebResponseDetails;

export type ProxyErrorDetails = chrome.proxy.ErrorDetails;

export abstract class BaseAdapter {
  // local storage
  abstract set<T>(key: string, val: T): Promise<void>;
  abstract get<T>(key: string): Promise<T | null>;
  async getWithDefault<T>(key: string, defaultVal: T): Promise<T> {
    const ret = await this.get<T>(key);
    if (ret === null) {
      return defaultVal;
    }

    return ret;
  }

  // proxy
  abstract setProxy(cfg: ProxyConfig): Promise<void>;
  abstract clearProxy(): Promise<void>;
  abstract onProxyError(callback: (error: ProxyErrorDetails) => void): void;

  // indicator
  abstract setBadge(text: string, color: string): Promise<void>;

  // webRequest
  abstract onWebRequestAuthRequired(
    callback: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
  ): void;
  abstract onWebRequestCompleted(
    callback: (details: WebResponseDetails) => void
  ): void;
  abstract onWebRequestErrorOccurred(
    callback: (details: WebResponseDetails) => void
  ): void;

  // i18n
  abstract currentLocale(): string;
  abstract getMessage(key: string, substitutions?: string | string[]): string;
}
