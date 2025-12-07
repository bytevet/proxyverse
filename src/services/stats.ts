import { MessageSender, WebRequestErrorOccurredDetails } from "@/adapters/base";
import { ProfileResult } from "./proxy/profile2config";
import { Host } from "@/adapters";
import { ProxyProfile } from "./profile";

/**
 * Simple LRU cache implementation
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing: remove and re-add to end
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

type Message = {
  type: "stats:get";
  tabID: number;
};

export type TabStatsResult = {
  failedRequests: WebRequestErrorOccurredDetails[];
  currentProfile:
    | { profile: ProxyProfile | undefined; isConfident: boolean }
    | undefined;
  tabID: number;
};

export async function queryStats(tabID: number): Promise<TabStatsResult> {
  try {
    const ret = await Host.sendMessage({
      type: "stats:get",
      tabID,
    });
    return ret as TabStatsResult;
  } catch (error) {
    console.error("Failed to query stats", error);
    return {
      failedRequests: [],
      currentProfile: undefined,
      tabID,
    };
  }
}

/**
 * Service to collect and manage web request stats
 * It can only be initalized in the background script
 */
export class WebRequestStatsService {
  private stats: LRUCache<number, TabStats>;
  private maxTabs: number = 100; // Maximum number of tabs to keep in memory

  constructor() {
    this.stats = new LRUCache<number, TabStats>(this.maxTabs);
    this.listen();
  }

  private listen() {
    Host.onMessage(
      (
        message: Message,
        sender: MessageSender,
        sendResponse: (response: any) => void
      ) => {
        console.debug("stats:get", message, sender, sendResponse);
        if (message.type === "stats:get") {
          const tabStats = this.getTabStats(message.tabID);
          sendResponse(tabStats.toJSON());
        }
      }
    );
  }

  addFailedRequest(details: WebRequestErrorOccurredDetails) {
    const tabID = details.tabId;
    const tabStats = this.getTabStats(tabID);
    tabStats.addFailedRequest(details);
  }

  setCurrentProfile(tabID: number, profile: ProfileResult) {
    const tabStats = this.getTabStats(tabID);
    tabStats.setCurrentProfile(profile);
  }

  getTabStats(tabID: number) {
    let tabStats = this.stats.get(tabID);
    if (!tabStats) {
      tabStats = new TabStats(tabID);
      this.stats.set(tabID, tabStats);
    }
    return tabStats;
  }

  closeTab(tabID: number) {
    this.stats.delete(tabID);
  }
}

class TabStats {
  private failedRequests: WebRequestErrorOccurredDetails[] = [];
  private maxRequests: number = 500; // max number of requests to keep in memory
  private _currentProfile:
    | { profile: ProxyProfile | undefined; isConfident: boolean }
    | undefined;

  constructor(public readonly tabID: number) {}

  toJSON(): TabStatsResult {
    return {
      failedRequests: this.failedRequests,
      currentProfile: this._currentProfile,
      tabID: this.tabID,
    };
  }

  get failedRequestsCount() {
    return this.failedRequests.length;
  }

  addFailedRequest(details: WebRequestErrorOccurredDetails) {
    this.failedRequests.push(details);
    if (this.failedRequests.length > this.maxRequests) {
      this.failedRequests.shift();
    }
  }

  setCurrentProfile({ profile, isConfident }: ProfileResult) {
    this._currentProfile = {
      profile: profile?.profile,
      isConfident: isConfident,
    };
  }

  get currentProfile() {
    return this._currentProfile;
  }
}
