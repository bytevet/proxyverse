import { test, expect } from "@playwright/test";
import { By } from "selenium-webdriver";
import { AUTH, startServers, type Servers } from "../servers";
import { autoProfile, proxyProfile, rule, server, standardProfiles } from "../data/profiles";
import { launchFirefox, type Firefox } from "./driver";

// hosts reached without a proxy resolve to the direct server
const DIRECT_HOSTS = ["a.test", "b.test", "direct.test", "auth.test"];

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

  test("proxy auth succeeds through the auth proxy", async () => {
    const authed = proxyProfile(
      { profileID: "authed" },
      { default: server(servers.ports.auth, "http", AUTH) }
    );
    await activate([authed], "authed");
    await expectRoute(servers.url("auth.test"), "auth");
    expect(servers.log.entries.some((e) => e.route === "auth" && e.auth === "ok")).toBe(true);
  });
});
