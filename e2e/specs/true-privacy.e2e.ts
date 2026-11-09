import { test, expect } from "../fixtures";
import { expectRoute, routeOf } from "../fixtures/routing";
import { autoProfile, rule } from "../data/profiles";
import { freshHost, freshProxyHost } from "../data/hosts";
import { expectSynced, signInDirectly } from "../pages/sync";
import { pickProfile, popconfirmOK, profileOption } from "../pages/arco";
import type { Servers } from "../servers";
import type { ServiceWorker } from "../fixtures/sw";

const GiB = 1024 ** 3;

/**
 * Signed in to the fake byte.vet, with True Privacy Proxy turned on and the
 * extension knowing the node (it learns it with its first token).
 */
async function enableTruePrivacy(sw: ServiceWorker, servers: Servers) {
  const node = freshProxyHost();
  servers.useTruePrivacyNode(node);
  await signInDirectly(sw, servers);
  await expectSynced(sw);
  await sw.eval(() => chrome.storage.local.set({ "proxy.truePrivacy": true }));
  await expect
    .poll(() => sw.getLocal("trueprivacy.endpoints"))
    .toEqual([{ host: node, port: servers.ports.trueprivacy }]);
  return node;
}

/** A route that never reached a test server, e.g. a refused 407. */
const failed = (route: string) => !/^(direct|proxy|auth|socks|trueprivacy)/.test(route);

test.describe("True Privacy Proxy", () => {
  test("shows once signed in and turned on in Preference", async ({
    sw,
    servers,
    openPopup,
    openConfig,
  }) => {
    let popup = await openPopup();
    await expect(popup.profile("trueprivacy")).toHaveCount(0);
    await popup.page.close();

    const pref = await openConfig("/preference");
    await expect(pref.getByTestId("pref-true-privacy")).toHaveCount(0);
    await signInDirectly(sw, servers);
    await expectSynced(sw);
    const toggle = pref.getByTestId("pref-true-privacy");
    await expect(toggle).not.toHaveClass(/arco-switch-checked/); // off by default
    await toggle.click();
    await expect(toggle).toHaveClass(/arco-switch-checked/);
    // synced as an account pref
    await expect.poll(() => servers.sync.get("pref:proxy.truePrivacy")?.data).toEqual({
      value: true,
    });

    popup = await openPopup();
    await expect(popup.profile("trueprivacy")).toBeVisible();
    await expect(pref.getByTestId("sidebar-trueprivacy")).toBeVisible();
  });

  test("routes traffic through the node with a token", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    await enableTruePrivacy(sw, servers);
    await activate("trueprivacy");

    await expectRoute(page, servers.url(freshHost()), "trueprivacy");
    expect(servers.sync.proxyTokens().length).toBeGreaterThan(0);
    expect((await sw.getBadge()).text).toBe("TP");
  });

  test("a refused token is replaced once", async ({ sw, servers, page, activate }) => {
    await enableTruePrivacy(sw, servers);
    await activate("trueprivacy");
    await expectRoute(page, servers.url(freshHost()), "trueprivacy");

    servers.sync.revokeProxyTokens(); // e.g. the user revoked the grant
    const before = servers.sync.proxyTokens().length;
    await expectRoute(page, servers.url(freshHost()), "trueprivacy");
    expect(servers.sync.proxyTokens().length).toBe(before + 1);
  });

  test("Auto rules route to it, and fail closed once signed out", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    await enableTruePrivacy(sw, servers);
    const site = freshHost("private");
    await sw.setProfiles([
      autoProfile({ profileID: "auto" }, [rule("domain", "private-*.test", "trueprivacy")]),
    ]);
    await activate("auto");
    await expectRoute(page, servers.url(site), "trueprivacy");
    await expectRoute(page, servers.url(freshHost()), "direct");

    // signed out: no token for the node, and never Direct instead
    await sw.eval(() => chrome.storage.local.remove("sync.auth"));
    servers.sync.revokeProxyTokens();
    const tokens = servers.sync.proxyTokens().length;
    await expect.poll(async () => failed(await routeOf(page, servers.url(site)))).toBe(true);
    expect(servers.sync.proxyTokens().length).toBe(tokens);
    expect((await sw.getProxySettings()).value.mode).toBe("pac_script");
  });

  test("signing out while it's active switches to Direct", async ({
    sw,
    servers,
    activate,
  }) => {
    await enableTruePrivacy(sw, servers);
    await activate("trueprivacy");
    await sw.eval(() => chrome.storage.local.remove("sync.auth"));
    await expect.poll(async () => (await sw.getProxySettings()).value.mode).toBe("direct");
  });

  test("its screen shows the usage and turns it off", async ({
    sw,
    servers,
    openConfig,
  }) => {
    await enableTruePrivacy(sw, servers);
    servers.sync.configureProxy({ used: 1 * GiB, quota: 5 * GiB });
    const page = await openConfig("/trueprivacy");

    await expect(page.getByTestId("tp-percent")).toContainText("20");
    await expect(page.getByTestId("tp-facts")).toContainText("4.0 GB");
    // WebRTC protection needs the optional privacy permission, not granted here
    await expect(page.getByTestId("tp-webrtc")).toBeVisible();

    await page.getByTestId("tp-toggle").click();
    await popconfirmOK(page).click();
    await expect(page.getByTestId("tp-unavailable")).toBeVisible();
    expect(await sw.getLocal("proxy.truePrivacy")).toBe(false);
    await expect(page.getByTestId("sidebar-trueprivacy")).toHaveCount(0);
  });

  test("warns about the allowance in the popup", async ({ sw, servers, openPopup }) => {
    await enableTruePrivacy(sw, servers);
    servers.sync.configureProxy({ used: 6 * GiB, quota: 5 * GiB });
    const popup = await openPopup();
    await expect(popup.page.getByTestId("popup-true-privacy-over")).toHaveText("Slowed");
    await expect(popup.page.getByTestId("popup-webrtc")).toBeVisible();
  });

  test("is a rule target in Auto profiles", async ({ sw, servers, openEditor }) => {
    await enableTruePrivacy(sw, servers);
    await sw.setProfiles([autoProfile({ profileID: "auto" }, [rule("domain", "x.test", "direct")])]);
    const editor = await openEditor("auto");
    await pickProfile(editor.page, editor.page.getByTestId("rule-0-route"), "trueprivacy");
    await expect(editor.page.getByTestId("rule-0-route")).toContainText("True Privacy Proxy");

    // turned off: the rule is kept, with a warning
    await sw.eval(() => chrome.storage.local.set({ "proxy.truePrivacy": false }));
    await expect(editor.page.getByTestId("rule-0-route-item")).toContainText("won't load");
    await editor.page.getByTestId("rule-0-route").click();
    await expect(profileOption(editor.page, "trueprivacy")).toHaveCount(0);
  });
});
