import { expect, test } from "vitest";
import { relativeTime } from "@/components/sync/relativeTime";

const NOW = Date.UTC(2026, 9, 27, 12);
const ago = (seconds: number) =>
  relativeTime(NOW - seconds * 1000, NOW, "en", "a few seconds ago");

test("reads as how long ago, in the largest fitting unit", () => {
  expect(ago(5)).toBe("a few seconds ago");
  expect(ago(59)).toBe("a few seconds ago");
  expect(ago(60)).toBe("1 minute ago");
  expect(ago(90)).toBe("1 minute ago");
  expect(ago(59 * 60)).toBe("59 minutes ago");
  expect(ago(3 * 3600)).toBe("3 hours ago");
  expect(ago(26 * 3600)).toBe("yesterday");
  expect(ago(3 * 86400)).toBe("3 days ago");
  expect(ago(20 * 86400)).toBe("2 weeks ago");
});

test("follows the UI language", () => {
  expect(relativeTime(NOW - 5 * 60_000, NOW, "zh-CN", "")).toBe("5分钟前");
});
