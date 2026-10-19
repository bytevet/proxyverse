import { test, expect } from "../fixtures";
import { autoProfile, rule, standardProfiles } from "../data/profiles";

// The side panel itself can't be driven by Playwright; its page is opened
// as a tab of the same window instead, which follows the active tab alike.
test.describe("sidebar", () => {
  test("follows the active tab and profile changes", async ({
    sw,
    servers,
    page,
    context,
    activate,
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
    const other = await context.newPage();
    await other.goto(servers.url("other.test"));

    const sidebar = await sw.openPage("/sidebar");
    await expect(sidebar.getByTestId("popup-profile-direct")).toBeVisible();
    const chip = sidebar.getByTestId("switch-chip");

    await page.bringToFront();
    await expect(chip).toContainText("Proxy A");

    await other.bringToFront();
    await expect(chip).toContainText("Direct");

    // navigating the active tab
    await other.goto(servers.url("a.test", "/next"));
    await expect(chip).toContainText("Proxy A");

    // profiles changed elsewhere
    await sw.setProfiles([{ ...proxyA, profileName: "Renamed A" }, auto]);
    await expect(sidebar.getByTestId("popup-profile-proxyA")).toContainText(
      "Renamed A"
    );
    await expect(chip).toContainText("Renamed A");
  });
});
