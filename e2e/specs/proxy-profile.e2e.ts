import { test, expect } from "../fixtures";
import { expectConnectVia, expectRoute } from "../fixtures/routing";
import {
  autoProfile,
  pacProfile,
  pacRouting,
  proxyProfile,
  rule,
  server,
  standardProfiles,
} from "../data/profiles";
import { freshProxyHost } from "../data/hosts";
import { AUTH } from "../servers";
import {
  fieldError,
  hexToRGBA,
  pickPresetColor,
  saveNew,
  saveRejected,
  stored,
} from "../pages/editorExtras";
import { toast } from "../pages/arco";

test.describe("proxy profile editor", () => {
  test("creates an http profile that routes traffic", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const editor = await openEditor();
    await editor.setName("My HTTP");
    await expect(editor.byId("profile-name")).toHaveText("My HTTP");
    await editor.setServer("proxyRules.default", {
      scheme: "http",
      host: "127.0.0.1",
      port: servers.ports.proxyA,
    });
    const id = await saveNew(editor);

    const saved = (await sw.getProfiles())[id];
    expect(saved).toMatchObject({
      profileName: "My HTTP",
      proxyType: "proxy",
      proxyRules: {
        default: {
          scheme: "http",
          host: "127.0.0.1",
          port: servers.ports.proxyA,
        },
      },
    });

    await activate(id);
    await expectRoute(page, servers.url("site.test"), "proxyA");
  });

  test("creates a socks5 profile that routes traffic", async ({
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const editor = await openEditor();
    await editor.setServer("proxyRules.default", {
      scheme: "socks5",
      host: "127.0.0.1",
      port: servers.ports.socks,
    });
    const id = await saveNew(editor);

    await activate(id);
    await expectRoute(page, servers.url("site.test"), "socks");
  });

  test("advanced HTTP/HTTPS servers override the default one", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const editor = await openEditor("proxyA");
    await editor.setAdvanced(true);
    await editor.setServer("proxyRules.http", {
      scheme: "http",
      host: "127.0.0.1",
      port: servers.ports.proxyB,
    });
    await editor.saveOK();
    expect((await stored(sw, "proxyA", "proxy")).proxyRules).toMatchObject({
      http: { scheme: "http", port: servers.ports.proxyB },
    });

    await activate("proxyA");
    await expectRoute(page, servers.url("site.test"), "proxyB");
    // https isn't overridden: the tunnel goes through the default server
    await expectConnectVia(
      page,
      servers,
      `https://secure.test:${servers.ports.direct}/`,
      "proxyA",
    );
  });

  test("an advanced HTTPS server receives https tunnels", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const editor = await openEditor("proxyA");
    await editor.setAdvanced(true);
    await editor.setServer("proxyRules.https", {
      scheme: "http",
      host: "127.0.0.1",
      port: servers.ports.proxyB,
    });
    await editor.saveOK();

    await activate("proxyA");
    await expectRoute(page, servers.url("site.test"), "proxyA");
    await expectConnectVia(
      page,
      servers,
      `https://secure.test:${servers.ports.direct}/`,
      "proxyB",
    );
  });

  test("bypass list entries go direct", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const editor = await openEditor("proxyA");
    await editor.setBypassList(["<local>", "*.bypass.test"]);
    await editor.saveOK();
    expect((await stored(sw, "proxyA", "proxy")).proxyRules.bypassList).toEqual(
      ["<local>", "*.bypass.test"],
    );

    await activate("proxyA");
    await expectRoute(page, servers.url("www.bypass.test"), "direct");
    await expectRoute(page, servers.url("site.test"), "proxyA");
  });

  test("scheme 'direct' hides host and port", async ({ openEditor }) => {
    const editor = await openEditor();
    const field = "proxyRules.default";
    await expect(editor.byId(`${field}-host`)).toBeVisible();

    await editor.setServer(field, { scheme: "direct" });
    await expect(editor.byId(`${field}-host`)).toBeHidden();
    await expect(editor.byId(`${field}-port`)).toBeHidden();
    await expect(editor.byId(`${field}-auth`)).toBeHidden();

    await editor.setServer(field, { scheme: "http" });
    await expect(editor.byId(`${field}-host`)).toBeVisible();
  });

  test("an empty host is rejected", async ({ sw, openEditor }) => {
    const editor = await openEditor();
    await editor.setServer("proxyRules.default", { scheme: "http", host: "" });
    await expect(fieldError(editor.byId("proxyRules.default-host"))).toHaveText(
      "Default Server is required",
    );

    await saveRejected(editor, "Default Server is required");
    expect(await sw.getProfiles()).toEqual({});
  });

  test.describe("auth dialog", () => {
    test("is unavailable for socks5", async ({ openEditor }) => {
      const editor = await openEditor();
      await editor.setServer("proxyRules.default", { scheme: "socks5" });
      await expect(editor.byId("proxyRules.default-auth")).toBeDisabled();
    });

    test("saved credentials are used by the auth proxy", async ({
      sw,
      servers,
      page,
      openEditor,
      activate,
    }) => {
      const host = freshProxyHost();
      await sw.setProfiles([
        proxyProfile(
          { profileID: "authed" },
          { default: { ...server(servers.ports.auth), host } },
        ),
      ]);
      const editor = await openEditor("authed");
      const button = editor.byId("proxyRules.default-auth");
      await expect(button).not.toHaveClass(/arco-btn-primary/);

      await editor.setAuth("proxyRules.default", AUTH);
      await expect(button).toHaveClass(/arco-btn-primary/);
      await editor.saveOK();
      expect(
        (await stored(sw, "authed", "proxy")).proxyRules.default.auth,
      ).toEqual(AUTH);

      await activate("authed");
      await expectRoute(page, servers.url("site.test"), "auth");
    });

    test("Clear removes the credentials", async ({
      sw,
      servers,
      openEditor,
    }) => {
      await sw.setProfiles([
        proxyProfile(
          { profileID: "authed" },
          { default: server(servers.ports.auth, "http", AUTH) },
        ),
      ]);
      const editor = await openEditor("authed");
      const button = editor.byId("proxyRules.default-auth");
      await expect(button).toHaveClass(/arco-btn-primary/);

      // the dialog shows the current credentials
      await button.click();
      await expect(editor.byId("auth-username").locator("input")).toHaveValue(
        AUTH.username,
      );
      await editor.byId("auth-clear").click();
      await expect(button).not.toHaveClass(/arco-btn-primary/);

      await editor.saveOK();
      expect(
        (await stored(sw, "authed", "proxy")).proxyRules.default.auth,
      ).toBeUndefined();
    });
  });

  test("Discard reverts unsaved edits", async ({ sw, servers, openEditor }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const editor = await openEditor("proxyA");

    await editor.setServer("proxyRules.default", {
      scheme: "http",
      port: 1234,
    });
    await editor.setName("Edited");
    await expect(editor.byId("profile-name")).toHaveText("Edited");
    await expect(editor.byId("profile-discard")).toBeVisible();

    await editor.discard();
    await expect(editor.byId("profile-name")).toHaveText("Proxy A");
    await expect(
      editor.byId("proxyRules.default-port").locator("input"),
    ).toHaveValue(`${servers.ports.proxyA}`);
    expect((await sw.getProfiles()).proxyA).toEqual(proxyA);
  });

  test("an unchanged profile shows no Discard/Save", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const editor = await openEditor("proxyA");
    await expect(editor.byId("profile-name")).toHaveText("Proxy A");
    await expect(editor.byId("profile-discard")).toBeHidden();
    await expect(editor.byId("profile-save")).toBeHidden();
  });

  for (const type of ["pac", "auto"] as const) {
    test(`an unchanged ${type} profile shows no Discard/Save`, async ({
      sw,
      servers,
      openEditor,
    }) => {
      const profile =
        type === "pac"
          ? pacProfile(
              { profileID: "p", profileName: "Unchanged" },
              { data: pacRouting(".pac.test", servers.ports.proxyA) },
            )
          : autoProfile({ profileID: "p", profileName: "Unchanged" }, [
              rule("domain", "*.a.test", "direct"),
            ]);
      await sw.setProfiles([profile]);
      const editor = await openEditor("p");
      await expect(editor.byId("profile-name")).toHaveText("Unchanged");
      await expect(editor.byId("profile-discard")).toBeHidden();
      await expect(editor.byId("profile-save")).toBeHidden();
    });
  }

  test("Discard hides Discard/Save again", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const editor = await openEditor("proxyA");

    await editor.setServer("proxyRules.default", { scheme: "http", port: 1234 });
    await expect(editor.byId("profile-discard")).toBeVisible();
    await editor.discard();
    await expect(editor.byId("proxyRules.default-port").locator("input")).toHaveValue(
      `${servers.ports.proxyA}`,
    );
    await expect(editor.byId("profile-discard")).toBeHidden();
    await expect(editor.byId("profile-save")).toBeHidden();
  });

  test("Delete removes the profile and opens Preference", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await sw.setProfiles([proxyA, proxyB]);
    const editor = await openEditor("proxyA");

    await editor.delete();
    await expect(
      toast(editor.page, "The profile had been deleted"),
    ).toBeVisible();
    await expect(editor.page).toHaveURL(/#\/preference$/);
    expect(Object.keys(await sw.getProfiles())).toEqual(["proxyB"]);
  });

  test("renames a profile", async ({ sw, servers, openEditor }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    const editor = await openEditor("proxyA");

    await editor.setName("Renamed");
    await expect(editor.byId("profile-name")).toHaveText("Renamed");
    await editor.saveOK();
    expect((await sw.getProfiles()).proxyA.profileName).toBe("Renamed");
  });

  test("a preset color is stored and shown on the badge", async ({
    sw,
    servers,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);

    const editor = await openEditor("proxyA");
    // the `profile-color` testid isn't rendered by a-color-picker
    const picker = editor.page.locator(".profile-name .arco-color-picker");
    const color = await pickPresetColor(editor.page, picker, 2);
    expect(color).not.toBe(proxyA.color);
    await editor.saveOK();
    await expect
      .poll(async () => (await sw.getProfiles()).proxyA.color.toLowerCase())
      .toBe(color);

    await activate("proxyA");
    await expect
      .poll(async () => (await sw.getBadge()).color)
      .toEqual(hexToRGBA(color));
  });

  test("recoloring the active profile updates the badge", async ({
    sw,
    servers,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await activate("proxyA");
    await expect
      .poll(async () => (await sw.getBadge()).color)
      .toEqual(hexToRGBA(proxyA.color));

    const editor = await openEditor("proxyA");
    const picker = editor.page.locator(".profile-name .arco-color-picker");
    const color = await pickPresetColor(editor.page, picker, 2);
    await editor.saveOK();
    await expect
      .poll(async () => (await sw.getBadge()).color)
      .toEqual(hexToRGBA(color));
  });

  test("editing the active profile re-routes without re-selecting", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await activate("proxyA");
    const site = servers.url("site.test");
    await expectRoute(page, site, "proxyA");

    const editor = await openEditor("proxyA");
    await editor.setServer("proxyRules.default", {
      scheme: "http",
      port: servers.ports.proxyB,
    });
    await editor.saveOK();
    await expectRoute(page, site, "proxyB");
  });
});
