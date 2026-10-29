import { afterEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import type { ProfilesStorage, ProxyProfile } from "@/services/profile";
import { refreshProxyOnProfileUpdate } from "@/services/proxy";
import { fakeLocalStorage, proxyProfile as proxy } from "../../helpers";

// A fake browser where this extension controls the proxy and `active` is the
// stored active-profile snapshot.
function mockBrowser(active: ProxyProfile, profiles: ProfilesStorage) {
  const store = fakeLocalStorage({ "active-profile": active, profiles });
  vi.spyOn(Host, "getProxySettings").mockResolvedValue({
    levelOfControl: "controlled_by_this_extension",
    value: { mode: "fixed_servers" },
  } as any);
  const setProxy = vi.spyOn(Host, "setProxy").mockResolvedValue();
  vi.spyOn(Host, "clearProxy").mockResolvedValue();
  return { store, setProxy };
}

describe("refreshProxyOnProfileUpdate", () => {
  afterEach(() => vi.restoreAllMocks());

  test("falls back to direct when the active profile is deleted", async () => {
    const old = { a: proxy("a") };
    const { store, setProxy } = mockBrowser(proxy("a"), {});

    await refreshProxyOnProfileUpdate({}, old);

    expect((store["active-profile"] as ProxyProfile).profileID).toBe("direct");
    expect(setProxy).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "direct" })
    );
  });

  test("re-applies the active profile when it changes", async () => {
    const changed = { ...proxy("a"), profileName: "renamed" };
    const { store } = mockBrowser(proxy("a"), { a: changed });

    await refreshProxyOnProfileUpdate({ a: changed }, { a: proxy("a") });

    expect(store["active-profile"]).toEqual(changed);
  });

  test("ignores changes to profiles the active one doesn't use", async () => {
    const { setProxy } = mockBrowser(proxy("a"), { a: proxy("a") });

    await refreshProxyOnProfileUpdate(
      { a: proxy("a"), b: proxy("b") },
      { a: proxy("a") }
    );

    expect(setProxy).not.toHaveBeenCalled();
  });
});
