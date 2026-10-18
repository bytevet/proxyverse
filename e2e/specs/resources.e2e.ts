import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { expectRoute } from "../fixtures/routing";
import { autoProfile, rule, standardProfiles } from "../data/profiles";
import { pickProfile, toast, profileOption } from "../pages/arco";
import {
  ResourcesView,
  refused,
  storePage,
  type SubResource,
} from "../pages/resources";
import type { ServiceWorker } from "../fixtures/sw";
import type { Servers } from "../servers";

/**
 * A page loading css/js/img/iframe/xhr from several hosts, two resources
 * from a host on a closed port, and one blocked "ad" script.
 * Returns its URL and the URLs it loads.
 */
function resourcePage(servers: Servers) {
  const resources: SubResource[] = [
    { kind: "css", url: servers.url("cdn.test", "/res/style.css") },
    { kind: "js", url: servers.url("cdn.test", "/res/app.js") },
    { kind: "img", url: servers.url("img.test", "/res/pic.svg") },
    { kind: "iframe", url: servers.url("frame.test", "/res/frame.html") },
    { kind: "xhr", url: servers.url("api.test", "/res/data.json") },
    { kind: "css", url: refused(servers, "/res/broken.css") },
    { kind: "img", url: refused(servers, "/res/broken.svg") },
    { kind: "js", url: servers.url("blocked.test", "/res/ad.js") },
  ];
  const url = storePage(servers, "site.test", "/res/page.html", resources);
  return { url, urls: [url, ...resources.map((r) => r.url)] };
}

/** Simulate an ad blocker: requests to blocked.test fail with ERR_BLOCKED_BY_CLIENT. */
async function blockAds(page: Page) {
  await page.route(
    (url) => url.hostname === "blocked.test",
    (route) => route.abort("blockedbyclient")
  );
}

/** Resources recorded for a tab, once the background has persisted them. */
async function storedResources(sw: ServiceWorker, tabID: number) {
  return (await sw.getTabStats(tabID))?.resources ?? [];
}

/** Wait until the background recorded `urls` as finished for a tab. */
async function waitForStats(sw: ServiceWorker, tabID: number, urls: string[]) {
  await expect
    .poll(async () => {
      const done = (await storedResources(sw, tabID))
        .filter((r) => r.status !== "pending")
        .map((r) => r.url);
      return urls.filter((u) => !done.includes(u));
    })
    .toEqual([]);
}

/** Load the resource page in `page`, returning its tab ID once recorded. */
async function loadResourcePage(sw: ServiceWorker, servers: Servers, page: Page) {
  const site = resourcePage(servers);
  await page.goto(site.url);
  const tabID = await sw.tabIdOf(page);
  await waitForStats(sw, tabID, site.urls);
  return tabID;
}

test.describe("resources", () => {
  test.beforeEach(async ({ sw, servers, activate }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    const auto = autoProfile({ profileID: "auto", profileName: "Auto" }, [], "direct");
    await sw.setProfiles([proxyA, proxyB, auto]);
    await activate("auto");
  });

  test("alert counts failures, excluding blocked requests; Details opens the view", async ({
    sw,
    servers,
    page,
    openPopup,
  }) => {
    await blockAds(page);
    const tabID = await loadResourcePage(sw, servers, page);

    const popup = await openPopup(tabID);
    await expect(popup.failedAlert).toContainText("2 resources failed to load");
    await popup.page.getByTestId("failed-alert-details").click();
    await expect(popup.page).toHaveURL(new RegExp(`#/popup/resources/${tabID}$`));

    const view = new ResourcesView(popup.page);
    await expect(view.group("refused.test")).toBeVisible();
    // the blocked request is listed, but not counted as a failure
    await expect(view.group("blocked.test")).toBeVisible();
    await expect(view.group("blocked.test")).not.toHaveClass(/failed/);
    await expect(view.filterFailed).toContainText("(2)");

    await view.back.click();
    await expect(popup.failedAlert).toBeVisible();
    await expect(popup.page).toHaveURL(new RegExp(`#/popup\\?tabID=${tabID}$`));
  });

  test("no alert when nothing failed", async ({ sw, servers, page, openPopup }) => {
    const site = servers.url("ok.test");
    await page.goto(site);
    const tabID = await sw.tabIdOf(page);
    await waitForStats(sw, tabID, [site]);

    const popup = await openPopup(tabID);
    await expect(popup.actionBar).toBeVisible();
    await expect(popup.failedAlert).toBeHidden();
  });

  test("groups by host, failed first and expanded, with type badges and filter", async ({
    context,
    sw,
    servers,
    page,
  }) => {
    await blockAds(page);
    const tabID = await loadResourcePage(sw, servers, page);

    const view = await ResourcesView.open(context, sw, tabID);
    await expect(view.groups()).toHaveCount(7);
    const hosts = await view.hosts();
    expect(hosts[0]).toBe("refused.test");
    expect(new Set(hosts)).toEqual(
      new Set([
        "refused.test",
        "cdn.test",
        "site.test",
        "img.test",
        "frame.test",
        "api.test",
        "blocked.test",
      ])
    );

    // failed groups are expanded, others collapsed
    await expect(view.group("refused.test")).toHaveClass(/failed/);
    await expect(view.rows("refused.test")).toHaveCount(2);
    await expect(view.rows("refused.test").first()).toBeVisible();
    await expect(view.rows("refused.test").first()).toHaveClass(/failed/);
    await expect(view.rows("cdn.test").first()).toBeHidden();

    // type badges
    await view.toggle("cdn.test");
    await expect(view.row("cdn.test", "/res/style.css")).toHaveAttribute("data-type", "stylesheet");
    await expect(view.row("cdn.test", "/res/style.css").locator(".badge")).toHaveText("css");
    await expect(view.row("cdn.test", "/res/app.js")).toHaveAttribute("data-type", "script");
    await expect(view.row("cdn.test", "/res/app.js").locator(".badge")).toHaveText("script");
    const badge = async (host: string) => {
      await view.toggle(host);
      return view.rows(host).first();
    };
    await expect(await badge("img.test")).toHaveAttribute("data-type", "image");
    await expect(view.rows("img.test").locator(".badge")).toHaveText("img");
    await expect(await badge("frame.test")).toHaveAttribute("data-type", "sub_frame");
    await expect(view.rows("frame.test").locator(".badge")).toHaveText("iframe");
    await expect(await badge("api.test")).toHaveAttribute("data-type", "xmlhttprequest");
    await expect(view.rows("api.test").locator(".badge")).toHaveText("xhr");
    await view.toggle("site.test");
    const main = view.row("site.test", "/res/page.html");
    await expect(main).toHaveAttribute("data-type", "main_frame");
    await expect(main.locator(".badge")).toHaveText("main");

    // failed filter: only real failures
    await view.filterFailed.click();
    await expect(view.groups()).toHaveCount(1);
    await expect(view.group("refused.test")).toBeVisible();
    await expect(view.rows()).toHaveCount(2);

    await view.filterAll.click();
    await expect(view.groups()).toHaveCount(7);
  });

  test("updates live while open, and a reload starts a fresh list", async ({
    context,
    sw,
    servers,
    page,
  }) => {
    await blockAds(page);
    const tabID = await loadResourcePage(sw, servers, page);

    const view = await ResourcesView.open(context, sw, tabID);
    await expect(view.groups()).toHaveCount(7);
    await expect(view.filterFailed).toContainText("(2)");

    const late = servers.url("late.test", "/res/late.json");
    const lateFail = refused(servers, "/res/late-fail");
    await page.evaluate(
      ([a, b]) => Promise.all([a, b].map((u) => fetch(u).catch(() => {}))),
      [late, lateFail]
    );
    await expect(view.group("late.test")).toBeVisible();
    await expect(view.filterFailed).toContainText("(3)");
    await expect(view.rows("refused.test")).toHaveCount(3);

    // the reload's main frame request truncates the list
    await page.reload();
    await expect(view.group("late.test")).toBeHidden();
    await expect(view.rows("refused.test")).toHaveCount(2);
    await expect(view.filterFailed).toContainText("(2)");
    await expect(view.groups()).toHaveCount(7);
  });

  test("switching a host through its chip updates routing", async ({
    context,
    sw,
    servers,
    page,
  }) => {
    const tabID = await loadResourcePage(sw, servers, page);

    const view = await ResourcesView.open(context, sw, tabID);
    await expect(view.chip("cdn.test")).toContainText("Direct");

    await pickProfile(view.page, view.chip("cdn.test"), "proxyA");
    await expect(toast(view.page, "Rule saved for cdn.test")).toBeVisible();
    await expect(view.chip("cdn.test")).toContainText("Proxy A");
    await expect(view.chip("img.test")).toContainText("Direct");

    const auto = (await sw.getProfiles()).auto;
    expect(auto.proxyType === "auto" && auto.rules[0]).toEqual(
      rule("domain", "cdn.test", "proxyA")
    );

    const probe = await context.newPage();
    await expectRoute(probe, servers.url("cdn.test", "/res/app.js"), "proxyA");
    await expectRoute(probe, servers.url("img.test"), "direct");
  });

  test("a host's chip can route its whole site", async ({
    context,
    sw,
    servers,
    page,
  }) => {
    const tabID = await loadResourcePage(sw, servers, page);
    const view = await ResourcesView.open(context, sw, tabID);

    await view.chip("cdn.test").click();
    await view.page.getByTestId("switch-scope-site").click();
    await profileOption(view.page, "proxyB")
      .click();
    await expect(toast(view.page, "Rule saved for *.cdn.test")).toBeVisible();

    const probe = await context.newPage();
    await expectRoute(probe, servers.url("static.cdn.test"), "proxyB");
  });

  test("marks a resource routed differently from its host", async ({
    context,
    sw,
    servers,
    page,
  }) => {
    await sw.setProfiles({
      ...(await sw.getProfiles()),
      auto: autoProfile(
        { profileID: "auto", profileName: "Auto" },
        [rule("url", "*/res/special*", "proxyB")],
        "direct"
      ),
    });
    const site = storePage(servers, "site.test", "/res/outlier.html", [
      { kind: "css", url: servers.url("cdn.test", "/res/style.css") },
      { kind: "js", url: servers.url("cdn.test", "/res/app.js") },
      { kind: "js", url: servers.url("cdn.test", "/res/special.js") },
    ]);
    await expectRoute(page, servers.url("cdn.test", "/res/special.js"), "proxyB");
    await page.goto(site);
    const tabID = await sw.tabIdOf(page);
    await waitForStats(sw, tabID, [
      site,
      servers.url("cdn.test", "/res/style.css"),
      servers.url("cdn.test", "/res/app.js"),
      servers.url("cdn.test", "/res/special.js"),
    ]);

    const view = await ResourcesView.open(context, sw, tabID);
    await expect(view.chip("cdn.test")).toContainText("Direct");
    await view.toggle("cdn.test");
    const dot = (path: string) =>
      view.row("cdn.test", path).locator(".color-indicator");
    await expect(dot("/res/special.js")).toBeVisible();
    await expect(
      view.row("cdn.test", "/res/special.js").locator("[title]").first()
    ).toHaveAttribute("title", "Proxy B");
    await expect(dot("/res/app.js")).toHaveCount(0);
    await expect(dot("/res/style.css")).toHaveCount(0);
  });

  test("data survives a service worker restart", async ({
    sw,
    servers,
    page,
    openPopup,
  }) => {
    const tabID = await loadResourcePage(sw, servers, page);

    await sw.restart();

    // a new request wakes the worker, which adds to the saved list
    const late = servers.url("late.test", "/res/late.json");
    await page.evaluate((u) => fetch(u).then(() => {}), late);
    await waitForStats(sw, tabID, [late, servers.url("cdn.test", "/res/app.js")]);

    const popup = await openPopup(tabID);
    await expect(popup.failedAlert).toContainText("2 resources failed to load");
    await popup.page.getByTestId("failed-alert-details").click();
    const view = new ResourcesView(popup.page);
    await expect(view.group("late.test")).toBeVisible();
    await expect(view.group("cdn.test")).toBeVisible();
    await expect(view.rows("refused.test")).toHaveCount(2);
  });

  test("closing the tab removes its stats", async ({ sw, servers, page }) => {
    await page.goto(servers.url("closing.test"));
    const tabID = await sw.tabIdOf(page);
    await expect.poll(() => sw.getTabStats(tabID)).toBeDefined();

    await page.close();
    await expect.poll(() => sw.getTabStats(tabID)).toBeUndefined();
  });
});
