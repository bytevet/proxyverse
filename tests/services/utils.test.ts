import { expect, test, describe } from "vitest";
import { deepClone } from "@/services/utils";

describe("deepClone", () => {
  test("clones primitive values", () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone("hello")).toBe("hello");
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
  });

  test("clones nested objects", () => {
    const obj = { a: 1, b: { c: 2, d: [3, 4] } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
    expect(cloned.b).not.toBe(obj.b);
    expect(cloned.b.d).not.toBe(obj.b.d);
  });

  test("clones arrays", () => {
    const arr = [1, { a: 2 }, [3]];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[1]).not.toBe(arr[1]);
  });

  test("strips undefined values (JSON round-trip behavior)", () => {
    const obj = { a: 1, b: undefined };
    const cloned = deepClone(obj);
    expect(cloned).toEqual({ a: 1 });
    expect("b" in cloned).toBe(false);
  });

  test("strips functions (JSON round-trip behavior)", () => {
    const obj = { a: 1, fn: () => {} };
    const cloned = deepClone(obj);
    expect(cloned).toEqual({ a: 1 });
  });

  test("handles empty objects and arrays", () => {
    expect(deepClone({})).toEqual({});
    expect(deepClone([])).toEqual([]);
  });
});
