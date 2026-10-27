import { test, expect } from "@playwright/test";
import { By } from "selenium-webdriver";
import { AUTH, startServers, type Servers } from "../servers";
import {
  autoProfile,
  pacProfile,
  pacReturning,
  proxyProfile,
  rule,
  server,
  standardProfiles,
} from "../data/profiles";
import { launchFirefox, type Firefox } from "./driver";

// hosts reached without a proxy resolve to the direct server
const DIRECT_HOSTS = ["a.test", "b.test", "direct.test", "auth.test", "fallback.test"];

test.describe.configure({ mode: "serial" });

test.describe("firefox smoke", () => {
  let servers: Servers;
  let ff: Firefox;

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    servers = await startServers();
    ff = await launchFirefox(DIRECT_HOSTS);
  });

  test.afterAll(async () => {
    await ff?.quit();
    await servers?.close();
  });

  /** Seed profiles, then activate `profileID` through the popup. */
  async function activate(profiles: Parameters<Firefox["setProfiles"]>[0], profileID: string) {
    await ff.openExtensionPage("/popup");
    await ff.setProfiles(profiles);
    await ff.driver.navigate().refresh();
    const item = await ff.byTestId(`popup-profile-${profileID}`);
    await item.click();
    await ff.driver.wait(
      async () => ((await item.getAttribute("class")) ?? "").includes("arco-menu-selected"),
      10_000
    );
  }

  /** Assert that `url` is (eventually) served through `route`. */
  async function expectRoute(url: string, route: string) {
    await ff.newTab();
    await expect
      .poll(() => ff.bodyOf(url), { timeout: 10_000 })
      .toContain(`route:${route} `);
  }

  /** Load `url` in a new tab, then open the popup acting on that tab. */
  async function popupFor(url: string) {
    await ff.newTab();
    await ff.driver.get(url);
    await ff.openExtensionPage("/preference");
    await ff.openPopup(await ff.tabIdOf(url));
    return ff.byTestId("switch-chip");
  }

  test("popup renders without the private browsing error", async () => {
    await ff.openExtensionPage("/popup");
    await ff.byTestId("popup-profile-direct");
    expect(await ff.driver.findElements(By.css(".arco-modal"))).toHaveLength(0);
  });

  test("a proxy profile routes through its proxy", async () => {
    const { proxyA } = standardProfiles(servers);
    await activate([proxyA], "proxyA");
    await expectRoute(servers.url("a.test"), "proxyA");
  });

  test("auto switch routes by domain rule", async () => {
    const { socks } = standardProfiles(servers);
    const auto = autoProfile({ profileID: "auto" }, [rule("domain", "b.test", "socks")], "direct");
    await activate([socks, auto], "auto");
    await expectRoute(servers.url("b.test"), "socks");
    await expectRoute(servers.url("direct.test"), "direct");
  });

  test("a PAC sub-profile shows the profile of the proxy it used", async () => {
    const { proxyB } = standardProfiles(servers);
    const pac = pacProfile(
      { profileID: "pac", profileName: "PAC" },
      { data: pacReturning(`PROXY 127.0.0.1:${servers.ports.proxyB}`) }
    );
    const auto = autoProfile({ profileID: "auto" }, [rule("domain", "pac.test", "pac")], "direct");
    await activate([proxyB, pac, auto], "auto");
    await expectRoute(servers.url("pac.test"), "proxyB");

    const chip = await popupFor(servers.url("pac.test"));
    await ff.driver.wait(async () => (await chip.getText()).includes("Proxy B"), 10_000);
  });

  test("a PAC fallback to DIRECT shows Direct", async () => {
    const pac = pacProfile(
      { profileID: "pac", profileName: "PAC" },
      { data: pacReturning(`PROXY 127.0.0.1:${servers.ports.closed}; DIRECT`) }
    );
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "fallback.test", "pac")],
      "direct"
    );
    await activate([pac, auto], "auto");
    await expectRoute(servers.url("fallback.test"), "direct");

    const chip = await popupFor(servers.url("fallback.test"));
    await ff.driver.wait(async () => (await chip.getText()).includes("Direct"), 10_000);
  });

  test("proxy auth succeeds through the auth proxy", async () => {
    const authed = proxyProfile(
      { profileID: "authed" },
      { default: server(servers.ports.auth, "http", AUTH) }
    );
    await activate([authed], "authed");
    await expectRoute(servers.url("auth.test"), "auth");
    expect(servers.log.entries.some((e) => e.route === "auth" && e.auth === "ok")).toBe(true);
  });

  test("the toolbar icon can open the sidebar instead of the popup", async () => {
    await ff.openExtensionPage("/preference");
    const popupAfter = (behavior: string): Promise<string> =>
      ff.driver.executeAsyncScript(
        `const [behavior, done] = arguments;
        browser.storage.local.set({ "ui.actionBehavior": behavior })
          .then(() => new Promise((r) => setTimeout(r, 500)))
          .then(() => browser.action.getPopup({}))
          .then(done, (e) => done(String(e)));`,
        behavior
      );

    // no popup: a click toggles the sidebar instead
    expect(await popupAfter("sidebar")).toBe("");
    expect(await popupAfter("popup")).toMatch(/\/index\.html#\/popup$/);

    await ff.openExtensionPage("/sidebar");
    await ff.byTestId("popup-profile-direct");
  });

  test("the chosen UI language applies", async () => {
    const setLanguage = (language: string) =>
      ff.driver.executeAsyncScript(
        `const [language, done] = arguments;
        browser.storage.local.set({ "ui.language": language }).then(() => done());`,
        language
      );

    await ff.openExtensionPage("/popup");
    await setLanguage("zh_CN");
    await ff.driver.navigate().refresh();
    await expect
      .poll(async () => (await ff.byTestId("popup-profile-direct")).getText())
      .toBe("直接连接");

    await setLanguage("auto");
  });
  // last: it leaves the extension signed in to sync
  test("syncs profiles with the fake byte.vet", async () => {
    const { proxyA, proxyB } = standardProfiles(servers);
    const tokens = servers.sync.issueTokens(undefined, "proxyverse-extension-dev");
    const local = (items: Record<string, unknown>) =>
      ff.driver.executeAsyncScript(
        `const [items, done] = arguments;
        browser.storage.local.set(items).then(() => done(), (e) => done(String(e)));`,
        items
      );

    await ff.openExtensionPage("/preference");
    await ff.setProfiles([proxyA]);
    // a completed sign-in: the Firefox auth window can't be driven here
    await local({
      "sync.devOrigin": servers.syncOrigin,
      "sync.auth": {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        account: servers.sync.user,
      },
    });
    await expect
      .poll(() => servers.sync.get("profile:proxyA")?.data, { timeout: 15_000 })
      .toMatchObject({ profileID: "proxyA" });

    servers.sync.seed([{ id: "profile:proxyB", data: proxyB, deviceID: "other-device" }]);
    await ff.driver.navigate().refresh();
    await (await ff.byTestId("pref-sync-now")).click();
    await expect
      .poll(
        () =>
          ff.driver.executeAsyncScript(
            `const [done] = arguments;
            browser.storage.local.get("profiles").then((r) => done(Object.keys(r.profiles ?? {}).sort()));`
          ),
        { timeout: 15_000 }
      )
      .toEqual(["proxyA", "proxyB"]);
  });
});
