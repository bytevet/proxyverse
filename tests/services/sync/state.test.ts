import { afterEach, describe, expect, test, vi } from "vitest";
import { reactive } from "vue";
import { Host } from "@/adapters";
import {
  clearSyncAuth,
  getSyncAuth,
  getSyncSettings,
  initialSyncState,
  onSyncStorageChanged,
  updateSyncSettings,
  setSyncState,
} from "@/services/sync/state";

describe("sync state", () => {
  afterEach(() => vi.restoreAllMocks());

  test("a new device starts from scratch with a random ID", () => {
    const a = initialSyncState();
    expect(a).toEqual({
      deviceID: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cursor: 0,
      base: {},
      local: {},
      held: {},
    });
    expect(initialSyncState().deviceID).not.toBe(a.deviceID);
  });

  test("settings default to syncing prefs, nothing local-only", async () => {
    vi.spyOn(Host, "get").mockResolvedValue(undefined);
    expect(await getSyncSettings()).toEqual({ syncPrefs: true, localOnly: [] });
    vi.spyOn(Host, "get").mockResolvedValue({ localOnly: ["p1"] });
    expect(await getSyncSettings()).toEqual({ syncPrefs: true, localOnly: ["p1"] });
  });

  test("writes plain copies", async () => {
    vi.spyOn(Host, "get").mockResolvedValue(undefined);
    const set = vi.spyOn(Host, "set").mockResolvedValue();
    const localOnly = reactive(["p1"]);
    await updateSyncSettings((s) => (s.localOnly = localOnly));
    const [key, value] = set.mock.calls[0];
    expect(key).toBe("sync.settings");
    expect(value).toEqual({ syncPrefs: true, localOnly: ["p1"] });
    expect((value as { localOnly: unknown }).localOnly).not.toBe(localOnly);

    const state = initialSyncState();
    await setSyncState(state);
    expect(set).toHaveBeenLastCalledWith("sync.state", state);
  });

  test("clearing removes the key", async () => {
    const remove = vi.spyOn(Host, "remove").mockResolvedValue();
    await clearSyncAuth();
    expect(remove).toHaveBeenCalledWith("sync.auth");
    vi.spyOn(Host, "get").mockResolvedValue(undefined);
    expect(await getSyncAuth()).toBeUndefined();
  });

  test("reports changes of the sync keys only", () => {
    let listener: (changes: Record<string, { newValue?: unknown }>) => void = () => {};
    const unsubscribe = vi.fn();
    vi.spyOn(Host, "onLocalStorageChanged").mockImplementation((l) => {
      listener = l;
      return unsubscribe;
    });

    const callback = vi.fn();
    expect(onSyncStorageChanged(callback)).toBe(unsubscribe);

    listener({ profiles: { newValue: {} } });
    expect(callback).not.toHaveBeenCalled();
    listener({ profiles: { newValue: {} }, "sync.state": { newValue: 1 }, "sync.auth": {} });
    expect(callback).toHaveBeenCalledWith({ "sync.state": { newValue: 1 }, "sync.auth": {} });
  });
});
