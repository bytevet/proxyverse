import { expect, test, describe } from "vitest";
import { LRUCache } from "@/services/stats";

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
