import { expect, test, describe, vi } from "vitest";
import {
  LRUCache,
  TabStats,
  WebRequestStatsService,
  countFailures,
  queryStats,
  type TabResource,
} from "@/services/stats";
import { Host } from "@/adapters";

describe("LRUCache", () => {
  test("get and set basic operations", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBeUndefined();
  });

  test("evicts least recently used when full", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  test("get refreshes entry so it is not evicted", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // refresh "a", so "b" is now LRU
    cache.set("c", 3); // evicts "b"
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  test("set updates existing key without growing size", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // update, not insert
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(10);
  });

  test("delete removes entry", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.delete("nonexistent")).toBe(false);
  });

  test("has checks existence", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  test("clear removes all entries", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  test("size tracks entry count", () => {
    const cache = new LRUCache<number, string>(10);
    expect(cache.size).toBe(0);
    cache.set(1, "a");
    expect(cache.size).toBe(1);
    cache.set(2, "b");
    expect(cache.size).toBe(2);
    cache.delete(1);
    expect(cache.size).toBe(1);
  });

  test("eviction order with many entries", () => {
    const cache = new LRUCache<number, number>(3);
    cache.set(1, 1);
    cache.set(2, 2);
    cache.set(3, 3);
    // Access order: 1, 2, 3. LRU is 1.
    cache.get(1); // refresh 1. LRU is now 2.
    cache.set(4, 4); // evicts 2
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBe(1);
    expect(cache.get(3)).toBe(3);
    expect(cache.get(4)).toBe(4);
  });

  test("maxSize of 1 only keeps latest entry", () => {
    const cache = new LRUCache<string, number>(1);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(1);
  });
});

const req = (
  requestId: string,
  url: string,
  type: string = "script",
  extra: Record<string, unknown> = {}
): any => ({
  requestId,
  url,
  type,
  tabId: 1,
  frameId: type === "main_frame" ? 0 : 1,
  timeStamp: 0,
  ...extra,
});

describe("TabStats", () => {
  test("tracks request status transitions", () => {
    const s = new TabStats(1);
    s.addRequest(req("1", "https://a.com/", "main_frame"));
    s.addRequest(req("2", "https://a.com/a.js"));
    s.addRequest(req("3", "https://b.com/b.css", "stylesheet"));
    s.completeRequest(req("2", "https://a.com/a.js"));
    s.failRequest(req("3", "", "stylesheet", { error: "net::ERR_TIMED_OUT" }));

    const { resources } = s.toJSON();
    expect(resources.map((r) => r.status)).toEqual(["pending", "ok", "failed"]);
    expect(resources[2].error).toBe("net::ERR_TIMED_OUT");
  });

  test("main frame navigation resets the list", () => {
    const s = new TabStats(1);
    s.addRequest(req("1", "https://a.com/", "main_frame"));
    s.addRequest(req("2", "https://a.com/a.js"));
    s.addRequest(req("3", "https://a.com/", "main_frame"));

    expect(s.toJSON().resources.map((r) => r.requestId)).toEqual(["3"]);
  });

  test("redirects update the existing entry", () => {
    const s = new TabStats(1);
    s.addRequest(req("1", "http://a.com/a.js"));
    s.addRequest(req("1", "https://a.com/a.js"));
    const { resources } = s.toJSON();
    expect(resources).toHaveLength(1);
    expect(resources[0].url).toBe("https://a.com/a.js");
  });

  test("evicts the oldest resources over the cap", () => {
    const s = new TabStats(1);
    for (let i = 0; i < TabStats.maxResources + 5; i++) {
      s.addRequest(req(`${i}`, `https://a.com/${i}`));
    }
    const { resources } = s.toJSON();
    expect(resources).toHaveLength(TabStats.maxResources);
    expect(resources[0].requestId).toBe("5");
    // evicted requests are ignored
    expect(s.completeRequest(req("0", ""))).toBe(false);
  });

  test("ignores updates for unknown requests", () => {
    const s = new TabStats(1);
    expect(s.failRequest(req("x", "", "script", { error: "e" }))).toBe(false);
    expect(s.toJSON().resources).toHaveLength(0);
  });
});

describe("TabStats acknowledgement", () => {
  const failed = (s: TabStats, id: string) => {
    s.addRequest(req(id, `https://a.com/${id}`));
    s.failRequest(req(id, "", "script", { error: "net::ERR_TIMED_OUT" }));
  };

  test("acknowledging hides failures until the next page load", () => {
    const s = new TabStats(1);
    s.addRequest(req("1", "https://a.com/", "main_frame"));
    failed(s, "2");
    expect(s.unseenFailures).toBe(1);

    expect(s.acknowledge()).toBe(true);
    expect(s.unseenFailures).toBe(0);
    failed(s, "3"); // later failures of the same page stay acknowledged
    expect(s.unseenFailures).toBe(0);
    expect(s.acknowledge()).toBe(false);

    s.addRequest(req("4", "https://a.com/", "main_frame"));
    failed(s, "5");
    expect(s.unseenFailures).toBe(1);
  });

  test("there's nothing to acknowledge without failures", () => {
    const s = new TabStats(1);
    s.addRequest(req("1", "https://a.com/", "main_frame"));
    expect(s.acknowledge()).toBe(false);
    failed(s, "2");
    expect(s.unseenFailures).toBe(1);
  });

  test("the acknowledgement is saved", () => {
    const s = new TabStats(1);
    failed(s, "1");
    s.acknowledge();
    expect(TabStats.fromJSON(1, s.toJSON()).unseenFailures).toBe(0);
  });
});

describe("countFailures", () => {
  test("excludes benign errors", () => {
    const r = (status: TabResource["status"], error?: string): TabResource => ({
      requestId: "",
      url: "",
      type: "script",
      status,
      error,
      ts: 0,
    });
    expect(
      countFailures([
        r("ok"),
        r("pending"),
        r("failed", "net::ERR_ABORTED"),
        r("failed", "net::ERR_BLOCKED_BY_CLIENT"),
        r("failed", "net::ERR_PROXY_CONNECTION_FAILED"),
        r("failed", "net::ERR_NAME_NOT_RESOLVED"),
      ])
    ).toBe(2);
  });
});

describe("WebRequestStatsService", () => {
  test("persists to session storage and hydrates after restart", async () => {
    vi.useFakeTimers();
    try {
      const svc = new WebRequestStatsService();
      await svc.addRequest(req("1", "https://a.com/", "main_frame", { tabId: 7 }));
      await svc.addRequest(req("2", "https://a.com/a.js", "script", { tabId: 7 }));
      await vi.runAllTimersAsync();

      expect((await queryStats(7)).resources).toHaveLength(2);

      // a new service instance simulates a restarted service worker
      const restarted = new WebRequestStatsService();
      await restarted.completeRequest(req("2", "", "script", { tabId: 7 }));
      await vi.runAllTimersAsync();
      const stats = await queryStats(7);
      expect(stats.resources.map((r) => r.status)).toEqual(["pending", "ok"]);

      await restarted.closeTab(7);
      expect((await queryStats(7)).resources).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("ignores requests not bound to a tab", async () => {
    const spy = vi.spyOn(Host, "getSession");
    const svc = new WebRequestStatsService();
    await svc.addRequest(req("1", "https://a.com/", "script", { tabId: -1 }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
