import { test, expect } from "../fixtures";
import { hexToRGBA } from "../pages/editorExtras";
import { expectRoute } from "../fixtures/routing";
import { autoProfile, rule, standardProfiles } from "../data/profiles";
import { pickProfile, profileOptions, toast, profileOption } from "../pages/arco";

test.describe("auto mode action bar", () => {
  test.describe("scope", () => {
    test.beforeEach(async ({ sw, servers, activate }) => {
      const { proxyA, proxyB } = standardProfiles(servers);
      const auto = autoProfile(
        { profileID: "auto" },
        [rule("domain", "keep.site.test", "proxyA")],
        "proxyA"
      );
      await sw.setProfiles([proxyA, proxyB, auto]);
      await activate("auto");
    });

    test("'*.domain' routes the whole site, apex included", async ({
      sw,
      servers,
      page,
      openPopup,
    }) => {
      await page.goto(servers.url("www.site.test"));
      const popup = await openPopup(await sw.tabIdOf(page));

      await popup.chip.click();
      await expect(popup.page.getByTestId("switch-scope-site")).toHaveText(
        "*.site.test"
      );
      await popup.page.getByTestId("switch-scope-site").click();
      await profileOption(popup.page, "proxyB")
        .click();
      await expect(toast(popup.page, "Rule saved for *.site.test")).toBeVisible();

      const saved = (await sw.getProfiles()).auto;
      expect(saved.proxyType === "auto" && saved.rules).toEqual([
        rule("domain", "site.test", "proxyB"),
        rule("domain", "*.site.test", "proxyB"),
        rule("domain", "keep.site.test", "proxyA"), // exact rules are kept
      ]);

      await expectRoute(page, servers.url("site.test"), "proxyB");
      await expectRoute(page, servers.url("deep.www.site.test"), "proxyB");
      await expectRoute(page, servers.url("other.test"), "proxyA");
    });

    test("starts on 'This site' each time the dropdown opens", async ({
      sw,
      servers,
      page,
      openPopup,
    }) => {
      await page.goto(servers.url("www.site.test"));
      const popup = await openPopup(await sw.tabIdOf(page));
      const site = popup.page.getByTestId("switch-scope-site");
      const host = popup.page.getByTestId("switch-scope-host");

      await popup.chip.click();
      await expect(host).toHaveClass(/arco-radio-checked/);
      await site.click();
      await expect(site).toHaveClass(/arco-radio-checked/);
      // clicking the switch keeps the dropdown open
      await expect(
        profileOption(popup.page, "proxyB")
      ).toBeVisible();

      await popup.chip.click(); // close
      await expect(site).toBeHidden();
      await popup.chip.click();
      await expect(host).toHaveClass(/arco-radio-checked/);

      // "This site" writes the exact host only
      await profileOption(popup.page, "proxyB")
        .click();
      await expect(toast(popup.page, "Rule saved for www.site.test")).toBeVisible();
    });

    test("is hidden for hosts without a site domain", async ({
      sw,
      servers,
      page,
      openPopup,
    }) => {
      // an IP literal, answered by the default proxy
      await page.goto(`http://10.9.8.7:${servers.ports.direct}/`);
      const popup = await openPopup(await sw.tabIdOf(page));
      await popup.chip.click();
      await expect(
        profileOption(popup.page, "proxyB")
      ).toBeVisible();
      await expect(popup.page.getByTestId("switch-scope-site")).toHaveCount(0);
    });
  });

  test("shows the profile used for the tab's host", async ({
    sw,
    servers,
    page,
    context,
    activate,
    openPopup,
  }) => {
    const { proxyA } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "a.test", "proxyA")],
      "direct"
    );
    await sw.setProfiles([proxyA, auto]);
    await activate("auto");

    await page.goto(servers.url("a.test"));
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.actionBar).toContainText("This site via");
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toHaveCount(0);

    const other = await context.newPage();
    await other.goto(servers.url("other.test"));
    const popup2 = await openPopup(await sw.tabIdOf(other));
    await expect(popup2.chip).toContainText("Direct");
  });

  test("marks an uncertain match", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const { proxyA } = standardProfiles(servers);
    // a CIDR rule can't be checked against a hostname without DNS
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("cidr", "10.0.0.0/8", "proxyA")],
      "direct"
    );
    await sw.setProfiles([proxyA, auto]);
    await activate("auto");

    await page.goto(servers.url("site.test"));
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toBeVisible();
  });

  test("switching through the chip saves a host rule and re-routes the tab", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "*.test", "proxyA")],
      "direct"
    );
    await sw.setProfiles([proxyA, proxyB, auto]);
    await activate("auto");

    await page.goto(servers.url("site.test"));
    await expect(page.locator("p")).toContainText("route:proxyA");
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.chip).toContainText("Proxy A");

    // System can't be picked, nor the auto profile itself
    const options = await profileOptions(popup.page, popup.chip);
    expect(options.find((o) => o.id === "system")?.disabled).toBe(true);
    expect(options.map((o) => o.id)).not.toContain("auto");

    await pickProfile(popup.page, popup.chip, "proxyB");
    await expect(toast(popup.page, "Rule saved for site.test")).toBeVisible();
    await expect(popup.chip).toContainText("Proxy B");

    const saved = (await sw.getProfiles()).auto;
    expect(saved.proxyType === "auto" && saved.rules).toEqual([
      rule("domain", "site.test", "proxyB"),
      rule("domain", "*.test", "proxyA"),
    ]);

    // "Reload tab" reloads the page, now through the new proxy
    const reloaded = page.waitForEvent("load");
    await toast(popup.page, "Rule saved").getByText("Reload tab").click();
    await reloaded;
    await expect(page.locator("p")).toContainText("route:proxyB");
    await expect(toast(popup.page, "Rule saved")).toBeHidden();

    // other hosts still follow the old rule
    await expectRoute(popup.page, servers.url("x.test"), "proxyA");
  });

  test("switching again updates the existing host rule", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "*.test", "proxyA"), rule("domain", "site.test", "proxyB")],
      "direct"
    );
    await sw.setProfiles([proxyA, proxyB, auto]);
    await activate("auto");

    await page.goto(servers.url("site.test"));
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.chip).toContainText("Proxy A");

    await pickProfile(popup.page, popup.chip, "direct");
    await expect(popup.chip).toContainText("Direct");
    const saved = (await sw.getProfiles()).auto;
    expect(saved.proxyType === "auto" && saved.rules).toEqual([
      rule("domain", "site.test", "direct"),
      rule("domain", "*.test", "proxyA"),
    ]);
    await expectRoute(page, servers.url("site.test"), "direct");
  });

  test("hidden for non-auto profiles", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const { proxyA } = standardProfiles(servers);
    const auto = autoProfile({ profileID: "auto" }, [], "proxyA");
    await sw.setProfiles([proxyA, auto]);
    await activate("proxyA");

    await page.goto(servers.url("site.test"));
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.actionBar).toBeHidden();

    // shows up once an auto profile is selected
    await popup.select("auto");
    await expect(popup.chip).toContainText("Proxy A");

    await popup.select("direct");
    await expect(popup.actionBar).toBeHidden();
  });

  test("hidden for non-web tabs", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
    openConfig,
  }) => {
    const { proxyA } = standardProfiles(servers);
    const auto = autoProfile({ profileID: "auto" }, [], "proxyA");
    await sw.setProfiles([proxyA, auto]);
    await activate("auto");

    // the tab's URL is only visible to the extension on web pages
    await page.goto(servers.url("site.test"));
    const tabID = await sw.tabIdOf(page);
    await page.goto("data:text/plain,hello");
    const data = await openPopup(tabID);
    await expect(data.profile("auto")).toHaveClass(/arco-menu-selected/);
    await expect(data.actionBar).toBeHidden();

    const config = await openConfig("/preference");
    const ext = await openPopup(await sw.tabIdOf(config));
    await expect(ext.profile("auto")).toHaveClass(/arco-menu-selected/);
    await expect(ext.actionBar).toBeHidden();
  });

  test("per-tab badge shows the matched profile", async ({
    sw,
    servers,
    page,
    context,
    activate,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto", profileName: "Auto Mode", color: "#123456" },
      [
        rule("domain", "a.test", "proxyA"),
        rule("domain", "s.test", "socks"),
      ],
      "direct"
    );
    await sw.setProfiles([proxyA, socks, auto]);
    await activate("auto");
    await expect.poll(async () => (await sw.getBadge()).text).toBe("Au");

    const expectTabBadge = async (host: string, text: string) => {
      const tab = await context.newPage();
      await tab.goto(servers.url(host));
      const tabId = await sw.tabIdOf(tab);
      await expect.poll(async () => (await sw.getBadge(tabId)).text).toBe(text);
    };

    await page.goto(servers.url("a.test"));
    const tabA = await sw.tabIdOf(page);
    await expect.poll(async () => (await sw.getBadge(tabA)).text).toBe("Pr");
    expect((await sw.getBadge(tabA)).color).toEqual(hexToRGBA(proxyA.color));

    await expectTabBadge("s.test", "So");
    await expectTabBadge("other.test", "Di");

    // the global badge still shows the auto profile
    expect((await sw.getBadge()).text).toBe("Au");
  });

  test("per-tab badge falls back to the auto profile when uncertain", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const { socks } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto", profileName: "Auto Mode", color: "#123456" },
      [rule("domain", "a.test", "socks"), rule("cidr", "10.0.0.0/8", "socks")],
      "direct"
    );
    await sw.setProfiles([socks, auto]);
    await activate("auto");

    // a confident match first, so the tab badge is known to be set per tab
    await page.goto(servers.url("a.test"));
    const tabId = await sw.tabIdOf(page);
    await expect.poll(async () => (await sw.getBadge(tabId)).text).toBe("So");

    await page.goto(servers.url("site.test"));
    await expect.poll(async () => (await sw.getBadge(tabId)).text).toBe("Au");
    expect((await sw.getBadge(tabId)).color).toEqual([18, 52, 86, 255]);
  });
});
