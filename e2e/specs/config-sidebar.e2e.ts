import { test, expect } from "../fixtures";
import { standardProfiles } from "../data/profiles";
import { Preference } from "../pages/preference";

test.describe("config sidebar", () => {
  test("lists profiles and updates live when another tab saves", async ({
    sw,
    servers,
    openConfig,
    openEditor,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const page = await openConfig("/preference");
    await expect(page.getByTestId("sidebar-profile-proxyA")).toContainText("Proxy A");
    await expect(page.getByTestId("sidebar-profile-socks")).toHaveCount(0);

    // rename in another tab
    const editor = await openEditor("proxyA");
    await editor.setName("Renamed A");
    await editor.saveOK();
    await expect(page.getByTestId("sidebar-profile-proxyA")).toContainText("Renamed A");

    // a profile added from another context
    await sw.setProfiles({ ...(await sw.getProfiles()), socks });
    await expect(page.getByTestId("sidebar-profile-socks")).toContainText("Socks");

    // and deleted from another tab
    await editor.delete();
    await expect(page.getByTestId("sidebar-profile-proxyA")).toHaveCount(0);
  });

  test("a profile entry opens its editor", async ({ sw, servers, openConfig }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const page = await openConfig("/preference");
    await page.getByTestId("sidebar-profile-proxyA").click();
    await expect(page).toHaveURL(/#\/profiles\/proxyA$/);
    await expect(page.getByTestId("profile-name")).toContainText("Proxy A");
  });

  test("'Create New Profile' opens a new profile", async ({ openConfig }) => {
    const page = await openConfig("/preference");
    await page.getByTestId("sidebar-create").click();
    await expect(page).toHaveURL(/#\/profiles\/new$/);
    await expect(page.getByTestId("proxy-type-proxy")).toBeVisible();
    await expect(page.getByTestId("profile-delete")).toHaveCount(0);
  });

  test("the gear button opens Preference", async ({ openConfig }) => {
    const page = await openConfig("/profiles/new");
    await page.getByTestId("sidebar-preference").click();
    await expect(page).toHaveURL(/#\/preference$/);
    await new Preference(page).expectOpen();
  });

  test("unknown routes redirect home", async ({ openConfig }) => {
    const page = await openConfig("/no/such/page");
    await expect(page).toHaveURL(/#\/profiles\/new$/);
    await expect(page.getByTestId("proxy-type-proxy")).toBeVisible();
  });
});
