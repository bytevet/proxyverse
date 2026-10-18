import { test, expect } from "../fixtures";
import { LAN_IP } from "../servers";
import { freshProxyHost } from "../data/hosts";
import { autoProfile, proxyProfile, rule, server } from "../data/profiles";

// The route Chrome reports is the IP of the first hop: fake sites resolve to
// the LAN IP, the test proxies listen on 127.0.0.1.
test.skip(!LAN_IP, "needs a LAN IP to tell direct requests from proxied ones");

test.describe("observed route", () => {
  test("a CIDR match confirmed by the browser loses its '?'", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const proxyA = proxyProfile(
      { profileID: "proxyA", profileName: "Proxy A" },
      { default: server(servers.ports.proxyA) }
    );
    // the rules can't check a hostname against a CIDR, the browser can
    const auto = autoProfile(
      { profileID: "auto", profileName: "Auto" },
      [rule("cidr", `${LAN_IP}/32`, "proxyA")],
      "direct"
    );
    await sw.setProfiles([proxyA, auto]);
    await activate("auto");

    await page.goto(servers.url("site.test"));
    await expect(page.locator("p")).toContainText("route:proxyA");
    const tabID = await sw.tabIdOf(page);

    const popup = await openPopup(tabID);
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toHaveCount(0);
    // the tab's badge shows the profile actually used
    await expect.poll(async () => (await sw.getBadge(tabID)).text).toBe("Pr");
  });

  test("same-IP proxies can't confirm which one was used", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    // local proxies: same IP, different ports
    const proxyA = proxyProfile(
      { profileID: "proxyA", profileName: "Proxy A" },
      { default: server(servers.ports.proxyA) }
    );
    const proxyB = proxyProfile(
      { profileID: "proxyB", profileName: "Proxy B" },
      { default: server(servers.ports.proxyB) }
    );
    const auto = autoProfile(
      { profileID: "auto", profileName: "Auto" },
      [rule("cidr", `${LAN_IP}/32`, "proxyA")],
      "proxyB"
    );
    await sw.setProfiles([proxyA, proxyB, auto]);
    await activate("auto");

    await page.goto(servers.url("site.test"));
    await expect(page.locator("p")).toContainText("route:proxyA");
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toBeVisible();
  });

  test("a proxy set by hostname can't confirm a CIDR match", async ({
    sw,
    servers,
    page,
    activate,
    openPopup,
  }) => {
    const named = proxyProfile(
      { profileID: "named", profileName: "Named" },
      {
        default: {
          scheme: "http",
          host: freshProxyHost(),
          port: servers.ports.proxyA,
        },
      }
    );
    const auto = autoProfile(
      { profileID: "auto", profileName: "Auto" },
      [rule("cidr", `${LAN_IP}/32`, "named")],
      "direct"
    );
    await sw.setProfiles([named, auto]);
    await activate("auto");

    // Chrome can't resolve the proxy's hostname: the rules decide
    await page.goto(servers.url("site.test"));
    await expect(page.locator("p")).toContainText("route:proxyA");
    const popup = await openPopup(await sw.tabIdOf(page));
    await expect(popup.chip).toContainText("Named");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toBeVisible();
  });
});
