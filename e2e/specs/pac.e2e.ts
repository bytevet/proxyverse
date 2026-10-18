import { test, expect } from "../fixtures";
import { expectRoute } from "../fixtures/routing";
import { autoProfile, pacProfile, pacRouting, rule } from "../data/profiles";
import {
  fieldError,
  saveNew,
  saveRejected,
  stored,
} from "../pages/editorExtras";
import { toast } from "../pages/arco";
import type { Servers } from "../servers";

const PAC_TYPE = "application/x-ns-proxy-autoconfig";

/** Serve a PAC script routing `*.pac.test` through `port`, and return its URL. */
function servePac(servers: Servers, port: number, path = "/proxy.pac") {
  servers.store.set(path, {
    type: PAC_TYPE,
    body: pacRouting(".pac.test", port),
  });
  return servers.localURL(path);
}

/** A PAC profile backed by a URL, fetched just now. */
function urlPacProfile(servers: Servers, port: number, extra = {}) {
  return pacProfile(
    { profileID: "pac" },
    {
      data: pacRouting(".pac.test", port),
      sourceURL: servePac(servers, port),
      refreshIntervalMinutes: 60,
      lastFetched: Date.now(),
      ...extra,
    },
  );
}

test.describe("PAC profiles", () => {
  test("an inline PAC script routes by host", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const editor = await openEditor();
    await editor.setType("pac");
    const script = pacRouting(".pac.test", servers.ports.proxyA);
    await editor.setPacScript(script);
    const id = await saveNew(editor);
    expect((await sw.getProfiles())[id]).toMatchObject({
      proxyType: "pac",
      pacScript: { data: script },
    });

    await activate(id);
    await expectRoute(page, servers.url("www.pac.test"), "proxyA");
    await expectRoute(page, servers.url("site.test"), "direct");
  });

  test("a script or URL is required", async ({ sw, openEditor }) => {
    const editor = await openEditor();
    await editor.setType("pac");
    await editor.setPacScript("");
    await expect(fieldError(editor.byId("pac-script"))).toHaveText(
      "PAC Script is required",
    );

    await saveRejected(editor, "PAC Script is required");
    expect(await sw.getProfiles()).toEqual({});
  });

  test("rejects a malformed PAC URL", async ({ openEditor }) => {
    const editor = await openEditor();
    await editor.setType("pac");
    const message = "PAC Script URL must be a valid http:// or https:// URL";

    await editor.setPacURL("not a url");
    await expect(fieldError(editor.byId("pac-url"))).toHaveText(message);

    await editor.setPacURL("ftp://example.test/proxy.pac");
    await expect(fieldError(editor.byId("pac-url"))).toHaveText(message);

    await editor.setPacURL("http://example.test/proxy.pac");
    await expect(fieldError(editor.byId("pac-url"))).toBeHidden();
  });

  test("Fetch Now loads the script from the URL", async ({
    sw,
    servers,
    page,
    openEditor,
    activate,
  }) => {
    const url = servePac(servers, servers.ports.proxyB);
    const editor = await openEditor();
    await editor.setType("pac");
    await editor.setPacURL(url);
    await editor.byId("pac-fetch").click();

    await expect(
      toast(editor.page, "PAC script fetched successfully."),
    ).toBeVisible();
    await expect(editor.byId("pac-script").locator("textarea")).toHaveValue(
      pacRouting(".pac.test", servers.ports.proxyB),
    );
    await expect(editor.page.getByText(/^Last fetched: /)).toBeVisible();

    const id = await saveNew(editor);
    expect((await stored(sw, id, "pac")).pacScript).toMatchObject({
      sourceURL: url,
      lastFetched: expect.any(Number),
    });
    await activate(id);
    await expectRoute(page, servers.url("www.pac.test"), "proxyB");
  });

  test("a failed Fetch Now keeps the script", async ({
    servers,
    openEditor,
  }) => {
    servers.store.set("/missing.pac", {
      type: "text/plain",
      body: "not found",
      status: 404,
    });
    const editor = await openEditor();
    await editor.setType("pac");
    const script = editor.byId("pac-script").locator("textarea");
    const before = await script.inputValue();

    await editor.setPacURL(servers.localURL("/missing.pac"));
    await editor.byId("pac-fetch").click();

    await expect(
      toast(editor.page, "Failed to fetch PAC script: HTTP 404"),
    ).toBeVisible();
    await expect(
      editor.page.getByText(/^Last fetch error: HTTP 404/),
    ).toBeVisible();
    await expect(script).toHaveValue(before);
  });

  test.describe("refresh interval", () => {
    test("schedules a refresh alarm, removed when disabled", async ({
      sw,
      servers,
      openEditor,
    }) => {
      const editor = await openEditor();
      await editor.setType("pac");
      await expect(editor.byId("pac-interval")).toBeHidden();
      await editor.setPacURL(servePac(servers, servers.ports.proxyA));
      await editor.byId("pac-fetch").click();
      await expect(toast(editor.page, "fetched successfully")).toBeVisible();

      await editor.setPacInterval("Every 15 minutes");
      const id = await saveNew(editor);
      const alarm = `pac-refresh:${id}`;
      await expect
        .poll(
          async () =>
            (await sw.getAlarms()).find((a) => a.name === alarm)
              ?.periodInMinutes,
        )
        .toBe(15);

      await editor.setPacInterval("Disabled (manual only)");
      await editor.saveOK();
      expect(
        (await stored(sw, id, "pac")).pacScript.refreshIntervalMinutes,
      ).toBe(0);
      await expect
        .poll(async () => (await sw.getAlarms()).map((a) => a.name))
        .not.toContain(alarm);
    });

    test("defaults to hourly", async ({ sw, servers, openEditor }) => {
      const editor = await openEditor();
      await editor.setType("pac");
      await editor.setPacURL(servePac(servers, servers.ports.proxyA));
      await expect(editor.byId("pac-interval")).toContainText("Every hour");
      await editor.byId("pac-fetch").click();
      await expect(toast(editor.page, "fetched successfully")).toBeVisible();

      const id = await saveNew(editor);
      await expect
        .poll(
          async () =>
            (await sw.getAlarms()).find((a) => a.name === `pac-refresh:${id}`)
              ?.periodInMinutes,
        )
        .toBe(60);
    });
  });

  test("the refresh alarm re-fetches the script and re-routes", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    await sw.setProfiles([urlPacProfile(servers, servers.ports.proxyA)]);
    await activate("pac");
    const site = servers.url("www.pac.test");
    await expectRoute(page, site, "proxyA");

    servePac(servers, servers.ports.proxyB);
    await sw.fireAlarm("pac-refresh:pac");
    await expectRoute(page, site, "proxyB");
    expect((await stored(sw, "pac", "pac")).pacScript.data).toBe(
      pacRouting(".pac.test", servers.ports.proxyB),
    );
  });

  test("the refresh alarm re-routes a PAC sub-profile of the active auto profile", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    await sw.setProfiles([
      urlPacProfile(servers, servers.ports.proxyA),
      autoProfile({ profileID: "auto" }, [rule("domain", "*.pac.test", "pac")]),
    ]);
    await activate("auto");
    const site = servers.url("www.pac.test");
    await expectRoute(page, site, "proxyA");
    await expectRoute(page, servers.url("site.test"), "direct");

    servePac(servers, servers.ports.proxyB);
    await sw.fireAlarm("pac-refresh:pac");
    await expectRoute(page, site, "proxyB");
  });

  test("a stale active PAC script is re-fetched when the worker wakes", async ({
    sw,
    servers,
    page,
    activate,
  }) => {
    await sw.setProfiles([
      // fetched long ago, and the auto refresh can't kick in
      urlPacProfile(servers, servers.ports.proxyA, {
        lastFetched: Date.now() - 24 * 3600_000,
        refreshIntervalMinutes: 0,
      }),
    ]);
    await activate("pac");
    const site = servers.url("www.pac.test");
    await expectRoute(page, site, "proxyA");

    servePac(servers, servers.ports.proxyB);
    // the restarted worker refreshes the stale PAC on startup
    await sw.restart();
    await expectRoute(page, site, "proxyB");
    expect(
      (await stored(sw, "pac", "pac")).pacScript.lastFetched,
    ).toBeGreaterThan(Date.now() - 60_000);
  });
});
