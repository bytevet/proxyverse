import { describe, expect, test } from "vitest";
import {
  compareHLC,
  formatHLC,
  isHLC,
  observeHLC,
  parseHLC,
  tickHLC,
} from "@/services/sync/hlc";

const DEV = "7b1e0000-0000-4000-8000-000000000001";

describe("HLC format", () => {
  test("formats with fixed widths and parses back", () => {
    const hlc = formatHLC({ time: 1730023456789, counter: 3, deviceID: DEV });
    expect(hlc).toBe(`001730023456789:0003:${DEV}`);
    expect(isHLC(hlc)).toBe(true);
    expect(parseHLC(hlc)).toEqual({
      time: 1730023456789,
      counter: 3,
      deviceID: DEV,
    });
  });

  test("rejects malformed clocks", () => {
    expect(isHLC("1730023456789:0003:dev")).toBe(false);
    expect(isHLC(`001730023456789:3:${DEV}`)).toBe(false);
    expect(isHLC("001730023456789:0003:dev_1")).toBe(false);
    expect(isHLC(`001730023456789:0003:${"a".repeat(65)}`)).toBe(false);
    expect(isHLC(42)).toBe(false);
    expect(parseHLC("nope")).toBeUndefined();
    expect(() => formatHLC({ time: 1, counter: 1, deviceID: "a b" })).toThrow();
    expect(() => formatHLC({ time: 1, counter: 10000, deviceID: "a" })).toThrow();
    expect(() => formatHLC({ time: -1, counter: 0, deviceID: "a" })).toThrow();
  });

  test("string order is clock order", () => {
    const hlcs = [
      formatHLC({ time: 1000, counter: 0, deviceID: "b" }),
      formatHLC({ time: 999, counter: 9999, deviceID: "z" }),
      formatHLC({ time: 1000, counter: 0, deviceID: "a" }),
      formatHLC({ time: 1000, counter: 1, deviceID: "a" }),
      formatHLC({ time: 10000, counter: 0, deviceID: "a" }),
    ];
    const sorted = [...hlcs].sort(compareHLC).map((h) => parseHLC(h));
    expect(sorted).toEqual([
      { time: 999, counter: 9999, deviceID: "z" },
      { time: 1000, counter: 0, deviceID: "a" },
      { time: 1000, counter: 0, deviceID: "b" },
      { time: 1000, counter: 1, deviceID: "a" },
      { time: 10000, counter: 0, deviceID: "a" },
    ]);
    expect(compareHLC(hlcs[0], hlcs[0])).toBe(0);
  });
});

describe("tickHLC", () => {
  test("starts at the wall clock", () => {
    expect(tickHLC(undefined, DEV, 5000)).toBe(
      formatHLC({ time: 5000, counter: 0, deviceID: DEV })
    );
    expect(tickHLC("garbage", DEV, 5000)).toBe(
      formatHLC({ time: 5000, counter: 0, deviceID: DEV })
    );
  });

  test("counts edits within one millisecond", () => {
    const a = tickHLC(undefined, DEV, 5000);
    const b = tickHLC(a, DEV, 5000);
    expect(parseHLC(b)).toMatchObject({ time: 5000, counter: 1 });
    expect(compareHLC(b, a)).toBe(1);
  });

  test("stays monotonic when the clock goes backwards", () => {
    let last = tickHLC(undefined, DEV, 10_000);
    for (const now of [9_000, 5_000, 10_000, 9_999]) {
      const next = tickHLC(last, DEV, now);
      expect(compareHLC(next, last)).toBe(1);
      expect(parseHLC(next)?.time).toBe(10_000);
      last = next;
    }
    // the wall clock catching up resets the counter
    expect(parseHLC(tickHLC(last, DEV, 10_001))).toMatchObject({
      time: 10_001,
      counter: 0,
    });
  });

  test("moves to the next millisecond when the counter overflows", () => {
    const full = formatHLC({ time: 5000, counter: 9999, deviceID: "x" });
    const next = tickHLC(full, DEV, 5000);
    expect(parseHLC(next)).toEqual({ time: 5001, counter: 0, deviceID: DEV });
    expect(compareHLC(next, full)).toBe(1);
  });

  test("issues clocks after one seen from another device", () => {
    const seen = formatHLC({ time: 9000, counter: 7, deviceID: "other" });
    expect(parseHLC(tickHLC(seen, DEV, 1000))).toEqual({
      time: 9000,
      counter: 8,
      deviceID: DEV,
    });
  });
});

describe("observeHLC", () => {
  const older = formatHLC({ time: 1000, counter: 0, deviceID: "a" });
  const newer = formatHLC({ time: 2000, counter: 0, deviceID: "b" });

  test("keeps the later clock", () => {
    expect(observeHLC(older, newer)).toBe(newer);
    expect(observeHLC(newer, older)).toBe(newer);
    expect(observeHLC(undefined, older)).toBe(older);
  });

  test("ignores an invalid received clock", () => {
    expect(observeHLC(older, "bogus")).toBe(older);
    expect(observeHLC(undefined, "bogus")).toBeUndefined();
  });

  test("the next tick follows the observed clock", () => {
    const clock = observeHLC(older, newer);
    expect(compareHLC(tickHLC(clock, DEV, 0), newer)).toBe(1);
  });
});
