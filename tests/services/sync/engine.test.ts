/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProfilesStorage, ProxyProfile } from "@/services/profile";
import { SyncApi } from "@/services/sync/api";
import { SyncEngine, type SyncDevice } from "@/services/sync/engine";
import type { SyncedPref } from "@/services/sync/records";
import {
  DEFAULT_SYNC_SETTINGS,
  type SyncSettings,
  type SyncState,
} from "@/services/sync/state";
import { SyncStore } from "../../../e2e/servers/syncStore";

// Two devices sync through the mock server's store, with the real API
// client. Time is a shared counter, so edit order is explicit.

let store: SyncStore;
let clock: number;
let lockID = 0;

const T0 = Date.UTC(2026, 9, 27);

const proxy = (profileID: string, host = "10.0.0.1"): ProxyProfile => ({
  profileID,
  color: "#AABBCC",
  profileName: profileID,
  proxyType: "proxy",
  proxyRules: { default: { scheme: "http", host, port: 8080 }, bypassList: [] },
});

class FakeDevice implements SyncDevice {
  data: { profiles: ProfilesStorage; prefs: Partial<Record<SyncedPref, unknown>> } = {
    profiles: {},
    prefs: {},
  };
  syncState?: SyncState;
  syncSettings: SyncSettings = structuredClone(DEFAULT_SYNC_SETTINGS);
  isSignedIn = true;
  authRejected = 0;
  revoked = 0;
  engine: SyncEngine;

  constructor() {
    this.engine = this.newEngine();
  }

  /** A fresh engine on the same storage, like a restarted service worker. */
  newEngine() {
    const { access_token } = store.issueTokens();
    return new SyncEngine({
      device: this,
      api: (deviceID) =>
        new SyncApi({
          origin: "https://byte.vet",
          deviceID,
          version: "2.0.0",
          getAccessToken: async () => access_token,
          refreshAccessToken: async () => access_token,
          fetch: store.fetch,
        }),
      info: { version: "2.0.0", browser: "chrome", os: "mac" },
      onAuthRejected: async () => void this.authRejected++,
      onDeviceRevoked: async () => void this.revoked++,
      now: () => clock,
      lockName: `device-${lockID++}`,
    });
  }

  sync(trigger: "manual" | "local" | "alarm" = "manual") {
    return this.engine.run({ trigger });
  }

  async profiles() {
    return structuredClone(this.data.profiles);
  }
  async updateProfiles(mutate: (p: ProfilesStorage) => void | Promise<void>) {
    const next = structuredClone(this.data.profiles);
    await mutate(next);
    this.data.profiles = next;
  }
  async prefs() {
    return structuredClone(this.data.prefs);
  }
  async setPref(key: SyncedPref, value: unknown) {
    this.data.prefs[key] = value;
  }
  async state() {
    return this.syncState && structuredClone(this.syncState);
  }
  async setState(s: SyncState) {
    this.syncState = structuredClone(s);
  }
  async settings() {
    return structuredClone(this.syncSettings);
  }
  async signedIn() {
    return this.isSignedIn;
  }

  /**
   * Edit while offline: the run that notices the edit (2 s later in the
   * extension) dates it, but can't push it.
   */
  async editOffline(p: ProxyProfile) {
    this.edit(p);
    store.failNext({ status: 503, code: "unavailable", path: "/records" });
    await this.sync("manual");
  }

  edit(p: ProxyProfile) {
    clock += 1000;
    this.data.profiles[p.profileID] = structuredClone(p);
  }
  remove(id: string) {
    clock += 1000;
    delete this.data.profiles[id];
  }
}

const pushes = () => store.requests("/records", "POST").length;

beforeEach(() => {
  store = new SyncStore();
  clock = T0;
  store.setNow(T0 + 10 * 60_000); // server time is ahead: no clock_skew
});

afterEach(() => vi.restoreAllMocks());

describe("two devices", () => {
  test("an edit on one device reaches the other", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    await b.sync();
    expect(b.data.profiles.p1).toEqual(proxy("p1"));

    a.edit(proxy("p1", "10.9.9.9"));
    await a.sync();
    await b.sync("alarm");
    expect(b.data.profiles.p1).toEqual(proxy("p1", "10.9.9.9"));
  });

  test("a deletion reaches the other device", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    await b.sync();

    b.remove("p1");
    await b.sync();
    await a.sync();
    expect(a.data.profiles).toEqual({});
    expect(store.get("profile:p1")).toMatchObject({ deleted: true, data: null });
  });

  test("the later edit wins, whichever device pushes first", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    await b.sync();

    await b.editOffline(proxy("p1", "10.0.0.2")); // earlier edit...
    await a.editOffline(proxy("p1", "10.0.0.3")); // ...later edit
    await a.sync(); // pushes the later one first
    await b.sync(); // b's push is stale: it takes a's version
    await a.sync();
    expect(b.data.profiles.p1).toEqual(proxy("p1", "10.0.0.3"));
    expect(a.data.profiles.p1).toEqual(proxy("p1", "10.0.0.3"));

    await a.editOffline(proxy("p1", "10.0.0.4")); // earlier edit, pushed last
    await b.editOffline(proxy("p1", "10.0.0.5"));
    await b.sync();
    await a.sync();
    await b.sync();
    expect(a.data.profiles.p1).toEqual(proxy("p1", "10.0.0.5"));
    expect(b.data.profiles.p1).toEqual(proxy("p1", "10.0.0.5"));
  });

  test("a later edit beats an earlier deletion", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    await b.sync();

    a.remove("p1");
    store.failNext({ status: 503, code: "unavailable", path: "/records" });
    await a.sync();
    await b.editOffline(proxy("p1", "10.0.0.7"));
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.data.profiles.p1).toEqual(proxy("p1", "10.0.0.7"));
  });

  test("preferences sync, unless a device turns them off", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.data.prefs["ui.actionBehavior"] = "sidebar";
    await a.sync();
    await b.sync();
    expect(b.data.prefs["ui.actionBehavior"]).toBe("sidebar");

    b.syncSettings.syncPrefs = false;
    clock += 1000;
    a.data.prefs["theme.darkmode"] = 1;
    await a.sync();
    await b.sync();
    expect(b.data.prefs["theme.darkmode"]).toBeUndefined();
  });
});

describe("first sync", () => {
  async function accountWith(p: ProxyProfile) {
    const a = new FakeDevice();
    a.edit(p);
    await a.sync();
    return a;
  }

  test("a device with nothing of its own takes the account's data", async () => {
    await accountWith(proxy("cloud"));
    const b = new FakeDevice();
    b.data.prefs["ui.language"] = "auto";
    await b.sync();
    expect(b.syncState?.phase).toBe("idle");
    expect(b.data.profiles.cloud).toEqual(proxy("cloud"));
  });

  test("asks when both sides have data, then merges", async () => {
    const a = await accountWith(proxy("cloud"));
    const b = new FakeDevice();
    b.edit(proxy("mine"));
    await b.sync();
    expect(b.syncState?.phase).toBe("needs-first-choice");
    expect(pushes()).toBe(1); // only a's

    await b.engine.run({ trigger: "manual", firstChoice: "merge" });
    await a.sync();
    expect(Object.keys(b.data.profiles).sort()).toEqual(["cloud", "mine"]);
    expect(Object.keys(a.data.profiles).sort()).toEqual(["cloud", "mine"]);
  });

  test("merge: this device's version wins a same-ID conflict", async () => {
    await accountWith(proxy("p1", "10.0.0.1"));
    const b = new FakeDevice();
    b.edit(proxy("p1", "10.0.0.2"));
    await b.sync();
    await b.engine.run({ trigger: "manual", firstChoice: "merge" });
    expect(store.get("profile:p1")?.data).toMatchObject(proxy("p1", "10.0.0.2"));
  });

  test("use cloud data: replaces this device's profiles", async () => {
    await accountWith(proxy("cloud"));
    const b = new FakeDevice();
    b.edit(proxy("mine"));
    await b.sync();
    await b.engine.run({ trigger: "manual", firstChoice: "cloud" });
    expect(Object.keys(b.data.profiles)).toEqual(["cloud"]);
    expect(store.get("profile:mine")).toBeUndefined();
  });

  test("upload this device: replaces the account's data, after a snapshot", async () => {
    const a = await accountWith(proxy("cloud"));
    const b = new FakeDevice();
    b.edit(proxy("mine"));
    await b.sync();
    await b.engine.run({ trigger: "manual", firstChoice: "upload" });
    await a.sync();

    expect(store.listSnapshots()[0]).toMatchObject({ reason: "before-overwrite" });
    expect(store.get("profile:cloud")).toMatchObject({ deleted: true });
    expect(Object.keys(a.data.profiles)).toEqual(["mine"]);
  });
});

describe("bookkeeping", () => {
  test("applying remote changes doesn't push them back", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    await b.sync();

    const before = pushes();
    await b.sync("local"); // the storage event of its own write
    await b.sync();
    expect(pushes()).toBe(before);
  });

  test("a pending change survives a failed run and a restart", async () => {
    const a = new FakeDevice();
    await a.sync();
    a.edit(proxy("p1"));
    store.failNext({ status: 503, code: "unavailable", retryAfter: 60, path: "/records" });
    await a.sync();
    expect(a.syncState?.lastSync?.error?.code).toBe("unavailable");
    expect(a.syncState?.backoff?.until).toBe(clock + 60_000);

    a.engine = a.newEngine();
    await a.sync("alarm"); // still backing off
    expect(store.get("profile:p1")).toBeUndefined();
    await a.sync("manual"); // the user asked: try now
    expect(store.get("profile:p1")?.data).toMatchObject(proxy("p1"));
    expect(a.syncState?.backoff).toBeUndefined();
  });

  test("a local-only profile never leaves the device", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.syncSettings.localOnly = ["secret"];
    a.edit(proxy("secret"));
    a.edit(proxy("shared"));
    await a.sync();
    expect(store.get("profile:secret")).toBeUndefined();

    // another device's profile with the same ID doesn't overwrite it
    b.edit(proxy("secret", "10.6.6.6"));
    await b.sync();
    await a.sync();
    expect(a.data.profiles.secret).toEqual(proxy("secret"));
  });

  test("marking a synced profile local-only leaves the cloud copy", async () => {
    const a = new FakeDevice();
    a.edit(proxy("p1"));
    await a.sync();
    a.syncSettings.localOnly = ["p1"];
    a.remove("p1");
    await a.sync();
    expect(store.get("profile:p1")).toMatchObject({ deleted: false });
  });

  test("records of a newer schema are held, not applied or overwritten", async () => {
    const a = new FakeDevice();
    await a.sync();
    store.seed([
      { id: "profile:future", schema: "2099-01", data: { profileID: "future", proxyType: "warp" } },
    ]);
    await a.sync();
    expect(a.data.profiles.future).toBeUndefined();
    expect(a.syncState?.held["profile:future"]).toBeDefined();
    expect(store.get("profile:future")?.schema).toBe("2099-01");
  });

  test("a record the server refuses isn't pushed again until it changes", async () => {
    store.configure({ maxRecords: 1 });
    const a = new FakeDevice();
    a.edit(proxy("p1"));
    a.edit(proxy("p2"));
    await a.sync();
    expect(Object.values(a.syncState?.failed ?? {})).toEqual([
      expect.objectContaining({ reason: "quota_exceeded" }),
    ]);

    const before = pushes();
    await a.sync();
    expect(pushes()).toBe(before);
  });

  test("a device clock far ahead is reported", async () => {
    const a = new FakeDevice();
    await a.sync();
    clock = T0 + 60 * 60_000; // an hour past the server
    a.edit(proxy("p1"));
    await a.sync();
    expect(a.syncState?.lastSync?.error?.code).toBe("clock_skew");
    expect(store.get("profile:p1")).toBeUndefined();
  });

  test("a resync after purged tombstones removes what was deleted elsewhere", async () => {
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(proxy("p1"));
    a.edit(proxy("p2"));
    await a.sync();
    await b.sync();

    b.remove("p1");
    await b.sync();
    store.purgeTombstones();
    a.edit(proxy("p3")); // a pending change survives the resync
    await a.sync();

    expect(Object.keys(a.data.profiles).sort()).toEqual(["p2", "p3"]);
    expect(store.get("profile:p3")).toBeDefined();
  });

  test("a PAC URL profile syncs its URL; each device keeps its own script", async () => {
    const pac = (data?: string): ProxyProfile => ({
      profileID: "pac",
      color: "#000000",
      profileName: "pac",
      proxyType: "pac",
      pacScript: { sourceURL: "https://example.test/proxy.pac", data, lastFetched: 1 },
    });
    const a = new FakeDevice();
    const b = new FakeDevice();
    a.edit(pac("script on a"));
    await a.sync();
    expect(store.get("profile:pac")?.data).not.toHaveProperty("pacScript.data");

    await b.sync();
    expect(b.data.profiles.pac).toMatchObject({ pacScript: { sourceURL: "https://example.test/proxy.pac" } });
    b.data.profiles.pac = pac("script on b"); // its fetcher ran

    a.edit({ ...pac("script on a"), profileName: "renamed" });
    await a.sync();
    await b.sync();
    expect(b.data.profiles.pac).toMatchObject({
      profileName: "renamed",
      pacScript: { data: "script on b" },
    });
  });

  test("a revoked device and a refused token are reported", async () => {
    const a = new FakeDevice();
    await a.sync();
    store.failNext({ status: 403, code: "invalid_token" });
    await a.sync();
    expect(a.authRejected).toBe(1);

    store.revokeDevice(a.syncState!.deviceID);
    await a.sync();
    expect(a.revoked).toBe(1);
  });

  test("does nothing when signed out", async () => {
    const a = new FakeDevice();
    a.isSignedIn = false;
    await a.sync();
    expect(store.log).toHaveLength(0);
  });
});
