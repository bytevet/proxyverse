import {
  WebRequestBeforeRequestDetails,
  WebRequestCompletedDetails,
  WebRequestErrorOccurredDetails,
} from "@/adapters/base";
import { Host } from "@/adapters";

/**
 * Simple LRU cache implementation
 */
export class LRUCache<K, V> {
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

export type TabResource = {
  requestId: string;
  url: string;
  // webRequest resource type, e.g. main_frame, sub_frame, stylesheet, script
  type: string;
  status: "pending" | "ok" | "failed";
  error?: string;
  ts: number;
};

export type TabStatsResult = {
  tabID: number;
  resources: TabResource[];
  // the user has seen the failures (opened the popup) since the page loaded
  acknowledged?: boolean;
};

// Errors that are not caused by the network or the proxy: cancelled loads,
// ad blockers, CORP/COEP rejections, etc.
const BENIGN_ERRORS = [
  "net::ERR_ABORTED",
  "net::ERR_BLOCKED_BY_CLIENT",
  "net::ERR_BLOCKED_BY_RESPONSE",
  "NS_BINDING_ABORTED", // Firefox equivalent of ERR_ABORTED
];

export function isFailure(r: TabResource): boolean {
  return r.status === "failed" && !BENIGN_ERRORS.includes(r.error ?? "");
}

export function countFailures(resources: TabResource[]): number {
  return resources.filter(isFailure).length;
}

const TAB_STATS_PREFIX = "tabstats:";
const tabStatsKey = (tabID: number) => `${TAB_STATS_PREFIX}${tabID}`;

function emptyStats(tabID: number): TabStatsResult {
  return { tabID, resources: [] };
}

/**
 * Tell the background the user has seen the failures of a tab, which stops
 * them being signaled on the badge until the page reloads.
 */
export async function acknowledgeTabStats(tabID: number) {
  try {
    await Host.sendMessage({ type: "stats:ack", tabID } satisfies Message);
  } catch (error) {
    console.warn("Failed to acknowledge stats", error);
  }
}

type Message = { type: "stats:ack"; tabID: number };

export async function queryStats(tabID: number): Promise<TabStatsResult> {
  try {
    return (
      (await Host.getSession<TabStatsResult>(tabStatsKey(tabID))) ??
      emptyStats(tabID)
    );
  } catch (error) {
    console.error("Failed to query stats", error);
    return emptyStats(tabID);
  }
}

/**
 * Watch the stats of a tab. The callback fires once with the current value,
 * then on every update written by the background script.
 * Returns an unsubscribe function.
 */
export function subscribeTabStats(
  tabID: number,
  callback: (stats: TabStatsResult) => void
): () => void {
  const key = tabStatsKey(tabID);
  let latestSeen = false;
  const unsubscribe = Host.onSessionStorageChanged((changes) => {
    if (!(key in changes)) return;
    latestSeen = true;
    callback(
      (changes[key].newValue as TabStatsResult | undefined) ??
        emptyStats(tabID)
    );
  });

  queryStats(tabID).then((stats) => {
    // don't overwrite a newer value delivered by the change listener
    if (!latestSeen) callback(stats);
  });

  return unsubscribe;
}

/**
 * Service to collect and manage web request stats
 * It can only be initalized in the background script
 *
 * Stats are mirrored to session storage, so they survive service worker
 * restarts and can be read directly by the popup.
 */
export class WebRequestStatsService {
  // loading promises keep event handling in order while a tab is hydrated
  private stats: LRUCache<number, Promise<TabStats>>;
  private maxTabs: number = 100; // Maximum number of tabs to keep in memory
  private persistTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private persistDelay = 300;

  /**
   * @param onChange called after the stats of a tab changed
   */
  constructor(private onChange?: (stats: TabStats) => void) {
    this.stats = new LRUCache<number, Promise<TabStats>>(this.maxTabs);
    Host.onMessage((message: Message, _sender, sendResponse) => {
      if (message?.type === "stats:ack") {
        this.acknowledge(message.tabID);
        sendResponse(undefined);
      }
    });
  }

  acknowledge(tabID: number) {
    return this.update(tabID, (s) => s.acknowledge());
  }

  /**
   * Report every tab saved in session storage to `onChange`, e.g. to restore
   * the badges after the service worker restarted.
   */
  async restore() {
    const saved = await Host.getAllSession();
    for (const [key, value] of Object.entries(saved)) {
      if (!key.startsWith(TAB_STATS_PREFIX)) continue;
      const tabID = Number(key.slice(TAB_STATS_PREFIX.length));
      // a tab already loaded by an event meanwhile is more recent
      let tabStats = this.stats.get(tabID);
      if (!tabStats) {
        tabStats = Promise.resolve(
          TabStats.fromJSON(tabID, value as TabStatsResult)
        );
        this.stats.set(tabID, tabStats);
      }
      this.onChange?.(await tabStats);
    }
  }

  addRequest(details: WebRequestBeforeRequestDetails) {
    return this.update(details.tabId, (s) => s.addRequest(details));
  }

  completeRequest(details: WebRequestCompletedDetails) {
    return this.update(details.tabId, (s) => s.completeRequest(details));
  }

  addFailedRequest(details: WebRequestErrorOccurredDetails) {
    return this.update(details.tabId, (s) => s.failRequest(details));
  }

  getTabStats(tabID: number): Promise<TabStats> {
    let tabStats = this.stats.get(tabID);
    if (!tabStats) {
      tabStats = Host.getSession<TabStatsResult>(tabStatsKey(tabID))
        .catch(() => undefined)
        .then((saved) => TabStats.fromJSON(tabID, saved));
      this.stats.set(tabID, tabStats);
    }
    return tabStats;
  }

  async closeTab(tabID: number) {
    this.stats.delete(tabID);
    clearTimeout(this.persistTimers.get(tabID));
    this.persistTimers.delete(tabID);
    await Host.removeSession(tabStatsKey(tabID)).catch(console.warn);
  }

  // apply `fn` to the stats of a tab, and persist them if `fn` changed them
  private async update(tabID: number, fn: (s: TabStats) => boolean) {
    if (tabID < 0) {
      // not related to a tab, e.g. requests from service workers
      return;
    }
    try {
      const tabStats = await this.getTabStats(tabID);
      if (fn(tabStats)) {
        this.schedulePersist(tabID, tabStats);
        this.onChange?.(tabStats);
      }
    } catch (e) {
      console.warn("Failed to update stats", e);
    }
  }

  private schedulePersist(tabID: number, tabStats: TabStats) {
    if (this.persistTimers.has(tabID)) {
      return;
    }
    this.persistTimers.set(
      tabID,
      setTimeout(() => {
        this.persistTimers.delete(tabID);
        Host.setSession(tabStatsKey(tabID), tabStats.toJSON()).catch(
          console.warn
        );
      }, this.persistDelay)
    );
  }
}

export class TabStats {
  private resources: TabResource[] = [];
  private byRequestId = new Map<string, TabResource>();
  private acknowledged = false;
  static maxResources: number = 300; // max number of requests to keep per tab
  static maxUrlLength: number = 1024;

  constructor(public readonly tabID: number) {}

  static fromJSON(tabID: number, saved?: TabStatsResult): TabStats {
    const ret = new TabStats(tabID);
    if (saved) {
      ret.resources = saved.resources ?? [];
      ret.resources.forEach((r) => ret.byRequestId.set(r.requestId, r));
      ret.acknowledged = saved.acknowledged ?? false;
    }
    return ret;
  }

  toJSON(): TabStatsResult {
    return {
      tabID: this.tabID,
      resources: this.resources,
      acknowledged: this.acknowledged,
    };
  }

  /** Failures to signal: those the user hasn't seen yet. */
  get unseenFailures(): number {
    return this.acknowledged ? 0 : countFailures(this.resources);
  }

  /** Mark the current failures as seen, until the next page load. */
  acknowledge(): boolean {
    // nothing to acknowledge yet: failures happening later still get signaled
    if (this.acknowledged || countFailures(this.resources) === 0) {
      return false;
    }
    this.acknowledged = true;
    return true;
  }

  addRequest(details: WebRequestBeforeRequestDetails): boolean {
    const url = details.url.substring(0, TabStats.maxUrlLength);

    // a new top-level navigation (including refresh) starts a fresh list
    if (details.type === "main_frame" && details.frameId === 0) {
      this.resources = [];
      this.byRequestId.clear();
      this.acknowledged = false;
    }

    // redirects reuse the same requestId
    const existing = this.byRequestId.get(details.requestId);
    if (existing) {
      existing.url = url;
      return true;
    }

    const resource: TabResource = {
      requestId: details.requestId,
      url,
      type: details.type,
      status: "pending",
      ts: details.timeStamp,
    };
    this.resources.push(resource);
    this.byRequestId.set(resource.requestId, resource);

    if (this.resources.length > TabStats.maxResources) {
      const evicted = this.resources.shift();
      evicted && this.byRequestId.delete(evicted.requestId);
    }
    return true;
  }

  completeRequest(details: WebRequestCompletedDetails): boolean {
    const resource = this.byRequestId.get(details.requestId);
    if (!resource) {
      return false;
    }
    resource.status = "ok";
    return true;
  }

  failRequest(details: WebRequestErrorOccurredDetails): boolean {
    const resource = this.byRequestId.get(details.requestId);
    if (!resource) {
      return false;
    }
    resource.status = "failed";
    resource.error = details.error;
    return true;
  }
}
