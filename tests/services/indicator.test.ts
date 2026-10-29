import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import { SystemProfile, type ProxyProfile } from "@/services/profile";
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
  let current: ProxyProfile | undefined;
  let failureBadge: boolean;
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

  // what a switch of the active profile, or of the setting, does
  const refresh = async (
    ...[profile, enabled]: [ProxyProfile | undefined, boolean] | []
  ) => {
    if (enabled !== undefined) [current, failureBadge] = [profile, enabled];
    await indicator.refresh();
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    setBadge = vi.spyOn(Host, "setBadge").mockResolvedValue();
    vi.spyOn(Host, "listTabIDs").mockResolvedValue([1, 2]);
    current = active;
    failureBadge = true;
    indicator = new TabIndicator(
      async () => current,
      async () => failureBadge
    );
    // the worker starting
    await indicator.refresh({ repaintTabs: false });
    setBadge.mockClear();
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

  test("a switch of profile repaints every tab, failures or not", async () => {
    await indicator.setTabProfile(1, profile("Proxy A", "#e8a33d"));
    badges(1);

    await refresh(SystemProfile.SYSTEM, true);
    expect(badges(1)).toEqual([["", SystemProfile.SYSTEM.color]]);
    await refresh(active, true);
    expect(badges(2)).toEqual([["Ac", "#111111"]]);
  });

  test("repaints a tab with the profile predicted for its page", async () => {
    const sub = profile("Sub", "#222222");
    indicator = new TabIndicator(
      async () => current,
      async () => failureBadge,
      async (tabID, a) => (tabID === 1 ? sub : a)
    );
    await refresh();
    expect(badges(1)).toEqual([["Su", "#222222"]]);

    // and keeps it while alternating
    await indicator.setFailures(1, 1);
    await tick();
    await tick();
    expect(badges(1)).toEqual([
      ["1", FAILURE_BADGE_COLOR],
      ["Su", "#222222"],
    ]);
  });

  test("the worker starting only repaints the tabs with failures", async () => {
    await indicator.setFailures(1, 1);
    badges(1);
    await indicator.refresh({ repaintTabs: false });
    expect(badges(1)).toEqual([["Ac", "#111111"]]);
    expect(badges(2)).toEqual([]);
  });

  test.each([
    ["System is active", SystemProfile.SYSTEM, true],
    ["another extension controls the proxy", undefined, true],
    ["the setting is off", active, false],
  ])("no alternating while %s", async (_, profile, enabled) => {
    await refresh(profile, enabled);
    badges(1);
    await indicator.setFailures(1, 2);
    await tick();
    await tick();
    expect(badges(1)).toEqual([]);
  });

  test("turning the setting off stops alternating, on resumes it", async () => {
    await indicator.setFailures(1, 2);
    await tick();
    badges(1);

    await refresh(active, false);
    expect(badges(1)).toEqual([["Ac", "#111111"]]);
    await tick();
    expect(badges(1)).toEqual([]);

    await refresh(active, true);
    badges(1);
    await tick();
    expect(badges(1)).toEqual([["2", FAILURE_BADGE_COLOR]]);
  });
});
