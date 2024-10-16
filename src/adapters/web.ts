// this adapter is for local testing purpose

import {
  BaseAdapter,
  BlockingResponse,
  ProxyConfig,
  ProxyErrorDetails,
  WebAuthenticationChallengeDetails,
  WebResponseDetails,
} from "./base";

import i18nData from "@/../public/_locales/en/messages.json?raw";

const _i18n: {
  [key: string]: {
    message: string;
  };
} = JSON.parse(i18nData);

export class WebBrowser extends BaseAdapter {
  async set<T>(key: string, val: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(val));
  }
  async get<T>(key: string): Promise<T | null> {
    let s: any;
    s = localStorage.getItem(key);
    return s && JSON.parse(s);
  }

  setProxy(_: ProxyConfig): Promise<void> {
    throw new Error("Method not implemented.");
  }
  clearProxy(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  onProxyError(_: (error: ProxyErrorDetails) => void): void {
    throw new Error("Method not implemented.");
  }
  async setBadge(text: string, color: string): Promise<void> {
    return console.log(`Badge: ${text}, ${color}`);
  }
  onWebRequestAuthRequired(
    _: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestCompleted(_: (details: WebResponseDetails) => void): void {
    throw new Error("Method not implemented.");
  }
  onWebRequestErrorOccurred(_: (details: WebResponseDetails) => void): void {
    throw new Error("Method not implemented.");
  }
  currentLocale(): string {
    return "en-US";
  }
  getMessage(key: string, substitutions?: string | string[]): string {
    let ret = key;
    if (_i18n && _i18n[key]) {
      ret = _i18n[key]["message"] || key;
    }

    if (!substitutions) {
      return ret;
    }

    if (typeof substitutions === "string") {
      substitutions = [substitutions];
    }

    for (let i = 0; i < substitutions.length; i++) {
      ret = ret.replace(`$${i + 1}`, substitutions[i]);
    }
    return ret;
  }
}
