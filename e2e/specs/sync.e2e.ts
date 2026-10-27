import type { SyncSettings } from "@/services/sync/state";
import { test, expect } from "../fixtures";
import { expectRoute } from "../fixtures/routing";
import { proxyProfile, server, standardProfiles } from "../data/profiles";
import {
  expectSynced,
  remoteProfile,
  signInDirectly,
  SyncSection,
  useFakeByteVet,
} from "../pages/sync";

// Cloud sync against the fake byte.vet (e2e/servers/syncApi.ts). It runs on
// loopback, so sync traffic never goes through the profile under test.

test.describe("sync", () => {
  test("signs in through the browser's auth window and uploads the profiles", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await useFakeByteVet(sw, servers);

    const page = await openConfig("/preference");
    const sync = new SyncSection(page);
    await sync.byId("pref-sync-signin").click();

    await expect(sync.byId("pref-sync-account")).toHaveText(
      servers.sync.user.email
    );
    await expect
      .poll(() => servers.sync.get("profile:proxyA")?.data)
      .toMatchObject({ profileID: "proxyA", profileName: "Proxy A" });
    await expect(sync.byId("pref-sync-status")).toContainText(/Last synced/);

    // the PKCE exchange really happened, as the dev client
    const token = servers.sync.requests("/oauth2/token", "POST")[0];
    expect(token.body).toMatchObject({
      grant_type: "authorization_code",
      client_id: "proxyverse-extension-dev",
    });
  });

  test("pushes a local edit a moment after it's saved", async ({
    sw,
    servers,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await signInDirectly(sw, servers);
    await expect.poll(() => servers.sync.get("profile:proxyA")).toBeDefined();

    await sw.setProfiles([{ ...proxyA, profileName: "Renamed" }]);
    await expect
      .poll(() => servers.sync.get("profile:proxyA")?.data)
      .toMatchObject({ profileName: "Renamed" });
  });

  test("applies remote changes on Sync now and on the poll alarm", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await signInDirectly(sw, servers);
    await expectSynced(sw);
    expect((await sw.getAlarms()).map((a) => a.name)).toContain("sync:poll");

    const page = await openConfig("/preference");
    servers.sync.seed([remoteProfile(proxyA)]);
    await new SyncSection(page).syncNow();
    await expect.poll(async () => Object.keys(await sw.getProfiles())).toEqual(["proxyA"]);

    servers.sync.seed([remoteProfile(proxyB)]);
    await sw.fireAlarm("sync:poll");
    await expect
      .poll(async () => Object.keys(await sw.getProfiles()).sort())
      .toEqual(["proxyA", "proxyB"]);
  });

  test("a remote deletion of the active profile switches to direct", async ({
    sw,
    servers,
    page,
    openConfig,
    activate,
  }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await signInDirectly(sw, servers);
    await expect.poll(() => servers.sync.get("profile:proxyA")).toBeDefined();

    await activate("proxyA");
    const site = servers.url("sync-delete.test");
    await expectRoute(page, site, "proxyA");

    servers.sync.seed([remoteProfile(proxyA, true)]);
    await new SyncSection(await openConfig("/preference")).syncNow();
    await expect.poll(() => sw.getProfiles()).toEqual({});
    await expectRoute(page, site, "direct");
  });

  test("a local-only profile stays on this device", async ({
    sw,
    servers,
    openEditor,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    await useFakeByteVet(sw, servers);
    await sw.eval(
      () => chrome.storage.local.set({ "sync.settings": { syncPrefs: true, localOnly: ["proxyA"] } })
    );
    await sw.setProfiles([proxyA, proxyB]);
    await signInDirectly(sw, servers);
    await expect.poll(() => servers.sync.get("profile:proxyB")).toBeDefined();
    expect(servers.sync.get("profile:proxyA")).toBeUndefined();

    // marking a synced profile local-only in the editor detaches it
    const editor = await openEditor("proxyB");
    await editor.page.getByTestId("profile-local-only").click();
    await editor.page.getByTestId("profile-save").click();
    await expect
      .poll(async () => ((await sw.getLocal("sync.settings")) as SyncSettings | undefined)?.localOnly)
      .toEqual(["proxyA", "proxyB"]);

    await sw.setProfiles([proxyA, { ...proxyB, profileName: "Private now" }]);
    // nothing to push, so the run after the change records nothing: sync
    // explicitly to be sure the edit had its chance to leave
    const since = Date.now();
    await editor.page.goto(`${sw.origin}/index.html#/preference`);
    await new SyncSection(editor.page).syncNow();
    await expectSynced(sw, since);
    expect(servers.sync.get("profile:proxyB")?.data).toMatchObject({
      profileName: "Proxy B",
    });
  });

  test("a change made just before the service worker stops still syncs", async ({
    sw,
    servers,
  }) => {
    await signInDirectly(sw, servers);
    await expectSynced(sw);

    const p = proxyProfile({ profileID: "late" }, { default: server(servers.ports.proxyA) });
    await sw.setProfiles([p]);
    await sw.restart(); // before the 2 s debounce fires
    await expect.poll(() => servers.sync.get("profile:late")).toBeDefined();
  });

  test("asks how to combine data on the first sign-in, then merges", async ({
    sw,
    servers,
    openConfig,
  }) => {
    const { proxyA, proxyB } = standardProfiles(servers);
    servers.sync.seed([remoteProfile(proxyB)]);
    await sw.setProfiles([proxyA]);
    await signInDirectly(sw, servers);

    const page = await openConfig("/preference");
    const sync = new SyncSection(page);
    await expect(sync.byId("pref-sync-first-choice")).toBeVisible();
    expect(servers.sync.get("profile:proxyA")).toBeUndefined();

    await sync.byId("pref-sync-choice-merge").click();
    await expect(sync.byId("pref-sync-first-choice")).toBeHidden();
    await expect
      .poll(async () => Object.keys(await sw.getProfiles()).sort())
      .toEqual(["proxyA", "proxyB"]);
    expect(servers.sync.get("profile:proxyA")).toBeDefined();
  });

  test("restores a snapshot", async ({ sw, servers, openConfig }) => {
    const { proxyA } = standardProfiles(servers);
    await sw.setProfiles([proxyA]);
    await signInDirectly(sw, servers);
    await expect.poll(() => servers.sync.get("profile:proxyA")).toBeDefined();
    const snapshot = servers.sync.createSnapshot("e2e");

    await sw.setProfiles([]);
    await expect
      .poll(() => servers.sync.get("profile:proxyA")?.deleted)
      .toBe(true);

    const page = await openConfig("/preference");
    const sync = new SyncSection(page);
    await sync.byId("pref-sync-snapshots").click();
    await sync.confirm(`pref-sync-restore-${snapshot.id}`);
    await expect.poll(async () => Object.keys(await sw.getProfiles())).toEqual(["proxyA"]);
  });
});
