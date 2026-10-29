import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { ServiceWorker } from "../fixtures/sw";
import type { Servers } from "../servers";
import { refused, storePage } from "../pages/resources";

/**
 * Serve a page with `failing` images that can't be loaded, and open it.
 * Pages need distinct paths, as tabs are found by URL.
 */
async function openPage(
  servers: Servers,
  page: Page,
  sw: ServiceWorker,
  failing: number,
  path = "/badge.html"
) {
  const images = Array.from({ length: failing }, (_, i) => ({
    kind: "img" as const,
    url: refused(servers, `${path}-${i}.svg`),
  }));
  await page.goto(storePage(servers, "site.test", path, images));
  return sw.tabIdOf(page);
}

/**
 * The badge texts a tab shows over `ms`, in order, without repeats. Stops
 * early once every text of `until` was seen.
 */
async function badgeTexts(
  sw: ServiceWorker,
  tabID: number,
  { ms = 5_000, until = [] as string[] } = {}
) {
  const seen: string[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { text } = await sw.getBadge(tabID);
    if (seen.at(-1) !== text) seen.push(text);
    if (until.length && until.every((t) => seen.includes(t))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return seen;
}

test.describe("failure badge", () => {
  test.beforeEach(async ({ activate }) => {
    await activate("direct");
  });

  test("alternates between the profile and the failure count", async ({
    sw,
    servers,
    page,
  }) => {
    const tabID = await openPage(servers, page, sw, 2);
    const seen = await badgeTexts(sw, tabID);
    expect(seen).toEqual(expect.arrayContaining(["Di", "2"]));
    expect(seen.length).toBeGreaterThanOrEqual(3); // it keeps switching
  });

  test("keeps alternating past the worker's idle timeout", async ({
    sw,
    servers,
    page,
  }) => {
    // badge updates are extension API calls, which keep the worker alive
    test.setTimeout(90_000);
    const tabID = await openPage(servers, page, sw, 1);
    await page.waitForTimeout(40_000);
    expect(await badgeTexts(sw, tabID, { until: ["Di", "1"] })).toEqual(
      expect.arrayContaining(["Di", "1"])
    );
  });

  test("stays on the profile without failures", async ({
    sw,
    servers,
    page,
  }) => {
    const tabID = await openPage(servers, page, sw, 0);
    expect(await badgeTexts(sw, tabID)).toEqual(["Di"]);
  });

  test("opening the popup stops it until the tab reloads", async ({
    sw,
    servers,
    page,
    openPopup,
  }) => {
    const tabID = await openPage(servers, page, sw, 1);
    await expect
      .poll(() => badgeTexts(sw, tabID, { ms: 2_500, until: ["1"] }))
      .toContain("1");

    const popup = await openPopup(tabID);
    await expect(popup.failedAlert).toContainText("1 resources failed to load");
    await expect.poll(async () => (await sw.getBadge(tabID)).text).toBe("Di");
    expect(await badgeTexts(sw, tabID)).toEqual(["Di"]);
    await popup.page.close();

    // a new page load signals its failures again
    await page.reload();
    expect(await badgeTexts(sw, tabID, { until: ["Di", "1"] })).toEqual(
      expect.arrayContaining(["Di", "1"])
    );
  });

  test("keeps alternating, or stays acknowledged, across worker restarts", async ({
    sw,
    servers,
    page,
    context,
    openPopup,
  }) => {
    const tabID = await openPage(servers, page, sw, 1);
    const other = await context.newPage();
    const otherID = await openPage(servers, other, sw, 1, "/other.html");

    const popup = await openPopup(otherID);
    await expect.poll(async () => (await sw.getBadge(otherID)).text).toBe("Di");
    await popup.page.close();
    await expect
      .poll(async () => (await sw.getTabStats(otherID))?.acknowledged)
      .toBe(true);

    await sw.restart();
    expect(await badgeTexts(sw, tabID, { until: ["Di", "1"] })).toEqual(
      expect.arrayContaining(["Di", "1"])
    );
    expect(await badgeTexts(sw, otherID, { ms: 2_500 })).toEqual(["Di"]);
  });

  test("System shows no badge, and no failures", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const tabID = await openPage(servers, page, sw, 1);
    const clean = await page.context().newPage();
    const cleanID = await openPage(servers, clean, sw, 0, "/clean.html");
    await expect.poll(async () => (await sw.getBadge(cleanID)).text).toBe("Di");

    // the tabs' own badges go too, not just the global one
    await activate("system");
    await expect.poll(async () => (await sw.getBadge(cleanID)).text).toBe("");
    expect(await badgeTexts(sw, tabID)).toEqual([""]);

    // back on a profile, the unseen failures show again
    await activate("direct");
    expect(await badgeTexts(sw, tabID, { until: ["Di", "1"] })).toEqual(
      expect.arrayContaining(["Di", "1"])
    );
  });

  test("can be turned off in Preference", async ({
    sw,
    servers,
    page,
    openConfig,
  }) => {
    const tabID = await openPage(servers, page, sw, 1);
    await expect
      .poll(() => badgeTexts(sw, tabID, { ms: 2_500, until: ["1"] }))
      .toContain("1");

    const pref = await openConfig("/preference");
    const toggle = pref.getByTestId("pref-failure-badge");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await pref.close();

    await expect.poll(async () => (await sw.getBadge(tabID)).text).toBe("Di");
    expect(await badgeTexts(sw, tabID)).toEqual(["Di"]);
  });
});
