import { test, expect } from "../fixtures";
import { hexToRGBA } from "../pages/editorExtras";
import { expectRoute } from "../fixtures/routing";
import { autoProfile, rule, standardProfiles } from "../data/profiles";

test.describe("popup", () => {
  test("lists presets and custom profiles, tagging auto ones", async ({
    sw,
    servers,
    openPopup,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    const auto = autoProfile({ profileID: "auto" }, []);
    await sw.setProfiles([proxyA, socks, auto]);

    const popup = await openPopup();
    await expect(popup.profile("direct")).toBeVisible();
    await expect(popup.profile("system")).toBeVisible();
    await expect(popup.profile("proxyA")).toContainText("Proxy A");
    await expect(popup.profile("socks")).toContainText("Socks");
    await expect(popup.profile("auto").locator(".arco-tag")).toHaveText("auto");
    await expect(popup.profile("proxyA").locator(".arco-tag")).toHaveCount(0);
  });

  test("selecting a profile applies it to real traffic", async ({
    sw,
    servers,
    page,
    openPopup,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    await sw.setProfiles([proxyA, socks]);
    const popup = await openPopup();
    const site = servers.url("site.test");

    await popup.select("proxyA");
    await expectRoute(page, site, "proxyA");
    expect((await sw.getProxySettings()).levelOfControl).toBe(
      "controlled_by_this_extension"
    );

    await popup.select("socks");
    await expectRoute(page, site, "socks");

    await popup.select("direct");
    await expectRoute(page, site, "direct");
    expect((await sw.getProxySettings()).value.mode).toBe("direct");

    await popup.select("system");
    expect((await sw.getProxySettings()).levelOfControl).not.toBe(
      "controlled_by_this_extension"
    );
  });

  test("badge shows the active profile", async ({ sw, servers, openPopup }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const popup = await openPopup();

    await popup.select("proxyA");
    await expect.poll(async () => (await sw.getBadge()).text).toBe("Pr");
    expect((await sw.getBadge()).color).toEqual(hexToRGBA(proxyA.color));

    await popup.select("direct");
    await expect.poll(async () => (await sw.getBadge()).text).toBe("Di");

    await popup.select("system");
    await expect.poll(async () => (await sw.getBadge()).text).toBe("");
  });

  test("'+' opens the new profile page", async ({ openPopup }) => {
    const popup = await openPopup();
    const tab = await popup.openNewTab("popup-create");
    expect(new URL(tab.url()).hash).toBe("#/profiles/new");
  });

  test("Config opens the active custom profile, or the config home", async ({
    sw,
    servers,
    openPopup,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const popup = await openPopup();

    const preference = await popup.openNewTab("popup-config");
    await expect(preference).toHaveURL(/#\/preference$/);
    await preference.close();

    await popup.select("proxyA");
    const editor = await popup.openNewTab("popup-config");
    expect(new URL(editor.url()).hash).toBe("#/profiles/proxyA");
  });

  test("theme switcher toggles and persists dark mode", async ({
    sw,
    openPopup,
  }) => {
    const popup = await openPopup();
    const body = popup.page.locator("body");
    const toggle = popup.page.getByTestId("theme-switch");

    await popup.page.emulateMedia({ colorScheme: "light" });
    await toggle.click();
    await expect(body).toHaveAttribute("arco-theme", "dark");
    await expect.poll(() => sw.getLocal("theme.darkmode")).toBe(1);

    await toggle.click();
    await expect(body).not.toHaveAttribute("arco-theme", "dark");
    await expect.poll(() => sw.getLocal("theme.darkmode")).toBe(2);

    // follow system: applies the system theme when chosen
    await popup.page.emulateMedia({ colorScheme: "dark" });
    await toggle.hover();
    await popup.page.getByTestId("theme-option-auto").click();
    await expect.poll(() => sw.getLocal("theme.darkmode")).toBe(0);
    await expect(body).toHaveAttribute("arco-theme", "dark");
  });

  test("'Follow system' tracks system theme changes live", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    const body = popup.page.locator("body");
    await popup.page.emulateMedia({ colorScheme: "light" });
    await popup.page.getByTestId("theme-switch").hover();
    await popup.page.getByTestId("theme-option-auto").click();
    await expect(body).not.toHaveAttribute("arco-theme", "dark");

    await popup.page.emulateMedia({ colorScheme: "dark" });
    await expect(body).toHaveAttribute("arco-theme", "dark");
  });

  test("the app first renders in the right theme, without a flash", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    const page = popup.page;
    // the theme when the app first renders into #app
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (!document.getElementById("app")?.firstElementChild) return;
        observer.disconnect();
        (window as any).firstRenderTheme =
          document.body.getAttribute("arco-theme") ?? "light";
      }).observe(document, { childList: true, subtree: true });
    });
    const firstRenderTheme = () =>
      page.evaluate(() => (window as any).firstRenderTheme);

    // following a dark system
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect.poll(firstRenderTheme).toBe("dark");

    // light chosen explicitly wins over the dark system
    await page.getByTestId("theme-switch").click();
    await expect(page.locator("body")).not.toHaveAttribute("arco-theme", "dark");
    await page.reload();
    await expect.poll(firstRenderTheme).toBe("light");
  });

  test("auto profiles route by rules", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "*.a.test", "proxyA"), rule("domain", "s.test", "socks")],
      "direct"
    );
    await sw.setProfiles([proxyA, socks, auto]);
    await activate("auto");

    await expectRoute(page, servers.url("x.a.test"), "proxyA");
    await expectRoute(page, servers.url("s.test"), "socks");
    await expectRoute(page, servers.url("other.test"), "direct");
  });
});
