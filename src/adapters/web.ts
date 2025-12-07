// this adapter is for local testing purpose

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
  WebRequestErrorOccurredDetails,
  WebRequestResponseStartedDetails,
} from "./base";

import i18nData from "@/../public/_locales/en/messages.json";

const _i18n: {
  [key: string]: {
    message: string;
  };
} = i18nData;

export class WebBrowser extends BaseAdapter {
  get flavor() {
    return BrowserFlavor.Web;
  }

  async set<T>(key: string, val: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(val));
  }
  async get<T>(key: string): Promise<T | undefined> {
    let s: any;
    s = localStorage.getItem(key);
    return s && JSON.parse(s);
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
  onMessage(
    _callback: (
      message: any,
      sender: MessageSender,
      sendResponse: (response: any) => void
    ) => void
  ): void {
    throw new Error("Method not implemented.");
  }
  sendMessage(_message: any): Promise<any> {
    throw new Error("Method not implemented.");
  }

  onWebRequestAuthRequired(
    _: (
      details: WebAuthenticationChallengeDetails,
      callback?: (response: BlockingResponse) => void
    ) => void
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
