import { test, expect } from "../fixtures";
import { expectRoute } from "../fixtures/routing";
import { toast } from "../pages/arco";
import { Preference } from "../pages/preference";
import {
  autoProfile,
  proxyProfile,
  rule,
  server,
  standardProfiles,
} from "../data/profiles";
import {
  configFile,
  fixtureFile,
  switchyOmegaFile,
} from "../data/configFiles";
import type { ProxyProfile } from "@/services/profile";

test.describe("preference", () => {
  test("the toolbar icon opens the popup or the sidebar", async ({
    sw,
    openConfig,
  }) => {
    const page = await openConfig("/preference");
    const toolbar = () =>
      sw.eval(async () => ({
        popup: await chrome.action.getPopup({}),
        panel: (await chrome.sidePanel.getOptions({})).enabled,
        onClick: (await chrome.sidePanel.getPanelBehavior())
          .openPanelOnActionClick,
      }));

    await expect(page.getByTestId("pref-action-popup")).toHaveClass(/checked/);

    await page.getByTestId("pref-action-sidebar").click();
    await expect.poll(() => sw.getLocal("ui.actionBehavior")).toBe("sidebar");
    await expect
      .poll(toolbar)
      .toEqual({ popup: "", panel: true, onClick: true });

    await page.getByTestId("pref-action-popup").click();
    await expect
      .poll(toolbar)
      .toEqual({
        popup: `${sw.origin}/index.html#/popup`,
        panel: false,
        onClick: false,
      });
  });

  test("the theme control stays in sync with the header and other pages", async ({
    openConfig,
    openPopup,
  }) => {
    const popup = await openPopup();
    const page = await openConfig("/preference");
    await page.emulateMedia({ colorScheme: "light" });
    const header = page.getByTestId("theme-switch");

    await page.getByTestId("pref-theme-dark").click();
    await expect(page.locator("body")).toHaveAttribute("arco-theme", "dark");
    await expect(header.locator(".arco-icon-moon-fill")).toBeVisible();
    // another open page follows
    await expect(popup.page.locator("body")).toHaveAttribute("arco-theme", "dark");

    // the header switcher updates the control
    await header.click();
    await expect(page.locator("body")).not.toHaveAttribute("arco-theme", "dark");
    await expect(page.getByTestId("pref-theme-light")).toHaveClass(/checked/);
    await expect(popup.page.locator("body")).not.toHaveAttribute(
      "arco-theme",
      "dark"
    );
  });

  test("export downloads all valid profiles", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA, socks } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "*.a.test", "proxyA")],
      "socks"
    );
    // not a valid color, so it can't be exported
    const invalid = { ...proxyA, profileID: "invalid", color: "red" };
    await sw.setProfiles([proxyA, socks, auto, invalid]);

    const pref = new Preference(await openConfig("/preference"));
    const { name, json } = await pref.export();

    expect(name).toBe("proxyverse.json");
    expect(json.version).toBe("2025-01");
    const ids = json.profiles.map((p: ProxyProfile) => p.profileID);
    expect(ids.sort()).toEqual(["auto", "proxyA", "socks"]);
    expect(json.profiles.find((p: ProxyProfile) => p.profileID === "auto")).toEqual(auto);
  });

  test("export with no valid profile shows a warning", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([{ ...proxyA, color: "red" }]);

    const page = await openConfig("/preference");
    await page.getByTestId("export-profiles").click();
    await expect(toast(page, "No valid profile to be exported")).toBeVisible({
      timeout: 2_000,
    });
  });

  test("import overwrites profiles and updates the sidebar", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA, proxyB, socks } = standardProfiles(servers);
    await sw.setProfiles([proxyA, socks]);

    const pref = new Preference(await openConfig("/preference"));
    const page = pref.page;
    await expect(page.getByTestId("sidebar-profile-proxyA")).toContainText("Proxy A");

    const renamed = { ...proxyA, profileName: "Imported A" };
    await pref.import(configFile([renamed, proxyB]));

    await expect(toast(page, "2 profiles have been imported")).toBeVisible();
    await expect(page.getByTestId("sidebar-profile-proxyA")).toContainText("Imported A");
    await expect(page.getByTestId("sidebar-profile-proxyB")).toContainText("Proxy B");
    // profiles missing from the file are kept
    await expect(page.getByTestId("sidebar-profile-socks")).toBeVisible();

    const stored = await sw.getProfiles();
    expect(Object.keys(stored).sort()).toEqual(["proxyA", "proxyB", "socks"]);
    expect(stored.proxyA).toEqual(renamed);
  });

  test("import overwriting the active profile re-routes traffic", async ({
    sw,
    servers,
    page,
    openConfig,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await activate("proxyA");
    const site = servers.url("site.test");
    await expectRoute(page, site, "proxyA");

    const pref = new Preference(await openConfig("/preference"));
    await pref.import(
      configFile([{ ...proxyA, proxyRules: { default: server(servers.ports.proxyB), bypassList: [] } }])
    );
    await expect(toast(pref.page, "1 profiles have been imported")).toBeVisible();

    await expectRoute(page, site, "proxyB");
  });

  test("malformed import file shows an error", async ({ sw, openConfig }) => {
    const pref = new Preference(await openConfig("/preference"));
    await pref.import(fixtureFile("malformed.json"));

    await expect(toast(pref.page, "Error occurred")).toBeVisible({
      timeout: 2_000,
    });
    expect(await sw.getProfiles()).toEqual({});
  });

  test("import a SwitchyOmega backup and route with it", async ({
    sw,
    servers,
    page,
    openConfig,
    activate,
  }) => {
    const backup = switchyOmegaFile([
      {
        name: "Omega A",
        profileType: "FixedProfile",
        color: "#99ccee",
        fallbackProxy: { scheme: "http", host: "127.0.0.1", port: servers.ports.proxyA },
        bypassList: [],
      },
      {
        name: "Omega Switch",
        profileType: "SwitchProfile",
        color: "#99dd99",
        defaultProfileName: "direct",
        rules: [
          {
            condition: { conditionType: "HostWildcardCondition", pattern: "*.a.test" },
            profileName: "Omega A",
          },
        ],
      },
    ]);

    const pref = new Preference(await openConfig("/preference"));
    await pref.import(backup);
    await expect(toast(pref.page, "2 profiles have been imported")).toBeVisible();
    await expect(pref.page.getByTestId("import-warnings")).toBeHidden();

    const stored = Object.values(await sw.getProfiles());
    const id = (name: string) => stored.find((p) => p.profileName === name)!.profileID;
    await expect(pref.page.getByTestId(`sidebar-profile-${id("Omega Switch")}`)).toContainText(
      "Omega Switch"
    );

    await activate(id("Omega Switch"));
    // `*.a.test` covers a.test itself in SwitchyOmega
    await expectRoute(page, servers.url("x.a.test"), "proxyA");
    await expectRoute(page, servers.url("a.test"), "proxyA");
    await expectRoute(page, servers.url("site.test"), "direct");

    // importing again overwrites the same profiles instead of adding new ones
    const renamed = stored.map((p) => ({ ...p, profileName: "Renamed" }));
    await sw.setProfiles(renamed);
    await pref.import(backup);
    await expect
      .poll(async () => Object.values(await sw.getProfiles()).map((p) => p.profileName).sort())
      .toEqual(["Omega A", "Omega Switch"]);
    expect(Object.keys(await sw.getProfiles()).sort()).toEqual(
      stored.map((p) => p.profileID).sort()
    );
  });

  test("SwitchyOmega import lists what it couldn't convert", async ({ openConfig }) => {
    const pref = new Preference(await openConfig("/preference"));
    await pref.import(
      switchyOmegaFile([
        {
          name: "Office hours",
          profileType: "SwitchProfile",
          defaultProfileName: "direct",
          rules: [
            {
              condition: { conditionType: "TimeCondition", startHour: 9, endHour: 17 },
              profileName: "direct",
            },
          ],
        },
      ])
    );

    const warnings = pref.page.getByTestId("import-warnings");
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText("Office hours");
    await expect(warnings).toContainText(
      'Rule "Time: 9~17" can\'t be converted and was imported as disabled'
    );
  });

  test("deleting a sub-profile of the active auto profile re-applies the proxy", async ({
    sw,
    servers,
    page,
    activate,
    openEditor,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    const auto = autoProfile(
      { profileID: "auto" },
      [rule("domain", "*.a.test", "proxyA")],
      "proxyB"
    );
    await sw.setProfiles([proxyA, proxyB, auto]);
    await activate("auto");
    const site = servers.url("x.a.test");
    await expectRoute(page, site, "proxyA");

    const editor = await openEditor("proxyA");
    await editor.delete();
    await expect(editor.page).toHaveURL(/#\/preference$/);
    expect(Object.keys(await sw.getProfiles()).sort()).toEqual(["auto", "proxyB"]);

    // the rule for the missing profile is skipped: the default applies
    await expectRoute(page, site, "proxyB");
  });

  test("clearing the bypass list saves an empty list", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const proxy = proxyProfile(
      { profileID: "proxyA" },
      { default: server(servers.ports.proxyA), bypassList: ["*.bypass.test"] }
    );
    await sw.setProfiles([proxy]);

    const editor = await openEditor("proxyA");
    await expect(editor.byId("bypass-list").locator("textarea")).toHaveValue(
      "*.bypass.test"
    );
    await editor.setBypassList([]);
    await editor.saveOK();

    await expect
      .poll(async () => {
        const p = (await sw.getProfiles()).proxyA;
        return p.proxyType === "proxy" ? p.proxyRules.bypassList : undefined;
      }, { timeout: 2_000 })
      .toEqual([]);
  });
});
