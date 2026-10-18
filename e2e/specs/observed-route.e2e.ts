import { test, expect } from "../fixtures";
import { LAN_IP } from "../servers";
import { freshProxyHost } from "../data/hosts";
import {
  autoProfile,
  proxyProfile,
  rule,
  standardProfiles,
} from "../data/profiles";
import type { ProxyProfile } from "@/services/profile";

// The route Chrome reports is the IP of the first hop: fake sites resolve to
// the LAN IP, the test proxies listen on 127.0.0.1.
test.skip(!LAN_IP, "needs a LAN IP to tell direct requests from proxied ones");

type Fixtures = Pick<
  Parameters<Parameters<typeof test>[2]>[0],
  "sw" | "servers" | "page" | "activate" | "openPopup"
>;

// a CIDR rule the rules can't check against a hostname, but the browser can
const cidrTo = (profileID: string, defaultProfileID: string) =>
  autoProfile(
    { profileID: "auto", profileName: "Auto" },
    [rule("cidr", `${LAN_IP}/32`, profileID)],
    defaultProfileID
  );

/**
 * Activate `profiles`' auto profile, load a page its CIDR rule sends through
 * proxyA's server, and open the popup for it.
 */
async function popupAfterLoad(
  { sw, servers, page, activate, openPopup }: Fixtures,
  profiles: ProxyProfile[]
) {
  await sw.setProfiles(profiles);
  await activate("auto");
  await page.goto(servers.url("site.test"));
  await expect(page.locator("p")).toContainText("route:proxyA");
  const tabID = await sw.tabIdOf(page);
  return { tabID, popup: await openPopup(tabID) };
}

test.describe("observed route", () => {
  test("a CIDR match confirmed by the browser loses its '?'", async ({ sw, servers, page, activate, openPopup }) => {
    const fixtures = { sw, servers, page, activate, openPopup };
    const { proxyA } = standardProfiles(servers);
    const { tabID, popup } = await popupAfterLoad(fixtures, [
      proxyA,
      cidrTo("proxyA", "direct"),
    ]);
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toHaveCount(0);
    // the tab's badge shows the profile actually used
    await expect
      .poll(async () => (await sw.getBadge(tabID)).text)
      .toBe("Pr");
  });

  test("same-IP proxies can't confirm which one was used", async ({ sw, servers, page, activate, openPopup }) => {
    const fixtures = { sw, servers, page, activate, openPopup };
    // local proxies: same IP, different ports
    const { proxyA, proxyB } = standardProfiles(servers);
    const { popup } = await popupAfterLoad(fixtures, [
      proxyA,
      proxyB,
      cidrTo("proxyA", "proxyB"),
    ]);
    await expect(popup.chip).toContainText("Proxy A");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toBeVisible();
  });

  test("a proxy set by hostname can't confirm a CIDR match", async ({ sw, servers, page, activate, openPopup }) => {
    const fixtures = { sw, servers, page, activate, openPopup };
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
    // Chrome can't resolve the proxy's hostname: the rules decide
    const { popup } = await popupAfterLoad(fixtures, [
      named,
      cidrTo("named", "direct"),
    ]);
    await expect(popup.chip).toContainText("Named");
    await expect(popup.chip.getByTestId("switch-chip-uncertain")).toBeVisible();
  });
});
