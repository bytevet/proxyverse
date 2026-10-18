import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import type { ProxyProfile } from "@/services/profile";
import {
  FAILURE_BADGE_COLOR,
  FAILURE_BADGE_INTERVAL_MS,
  TabIndicator,
} from "@/services/indicator";

const profile = (profileName: string, color: string): ProxyProfile => ({
  profileID: profileName,
  profileName,
  color,
  proxyType: "direct",
});

describe("TabIndicator", () => {
  const active = profile("Active", "#111111");
  let setBadge: ReturnType<typeof vi.spyOn>;
  let indicator: TabIndicator;

  // badge calls for a tab since the last check
  const badges = (tabID: number) => {
    const ret = setBadge.mock.calls
      .filter((c: unknown[]) => c[2] === tabID)
      .map((c: unknown[]) => [c[0], c[1]]);
    setBadge.mockClear();
    return ret;
  };
  const tick = () => vi.advanceTimersByTimeAsync(FAILURE_BADGE_INTERVAL_MS);

  beforeEach(() => {
    vi.useFakeTimers();
    setBadge = vi.spyOn(Host, "setBadge").mockResolvedValue();
    indicator = new TabIndicator(async () => active);
  });

  afterEach(() => {
    indicator.removeTab(1);
    indicator.removeTab(2);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("alternates between the profile and the failure count", async () => {
    await indicator.setTabProfile(1, profile("Proxy A", "#e8a33d"));
    expect(badges(1)).toEqual([["Pr", "#e8a33d"]]);

    await indicator.setFailures(1, 3);
    await tick();
    expect(badges(1)).toEqual([["3", FAILURE_BADGE_COLOR]]);
    await tick();
    expect(badges(1)).toEqual([["Pr", "#e8a33d"]]);
    await tick();
    expect(badges(1)).toEqual([["3", FAILURE_BADGE_COLOR]]);
  });

  test("stops on the profile once failures are cleared", async () => {
    await indicator.setFailures(1, 2);
    await tick();
    badges(1);

    await indicator.setFailures(1, 0);
    expect(badges(1)).toEqual([["Ac", "#111111"]]); // the active profile
    await tick();
    await tick();
    expect(badges(1)).toEqual([]);
  });

  test("updates a shown count right away, and caps it", async () => {
    await indicator.setFailures(1, 1);
    await tick();
    badges(1);
    await indicator.setFailures(1, 1); // unchanged: no update
    expect(badges(1)).toEqual([]);
    await indicator.setFailures(1, 150);
    expect(badges(1)).toEqual([["99+", FAILURE_BADGE_COLOR]]);
  });

  test("keeps other tabs untouched", async () => {
    await indicator.setFailures(1, 1);
    await tick();
    await tick();
    expect(badges(2)).toEqual([]);
  });

  test("a closed tab stops alternating", async () => {
    await indicator.setFailures(1, 1);
    indicator.removeTab(1);
    await tick();
    expect(badges(1)).toEqual([]);
  });
});
