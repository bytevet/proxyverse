import { describe, expect, test, vi } from "vitest";
import {
  PacFetchError,
  fetchPacScript,
  refreshPacProfile,
} from "@/services/proxy/pacFetcher";
import {
  DEFAULT_PAC_REFRESH_MINUTES,
  resolvePacRefreshMinutes,
  type ProfileSimple,
} from "@/services/profile";

function makePacProfile(overrides?: Partial<ProfileSimple>): ProfileSimple {
  return {
    profileID: "test-pac",
    color: "#123456",
    profileName: "Test PAC",
    proxyType: "pac",
    pacScript: {
      data: "function FindProxyForURL(url, host) { return 'DIRECT'; }",
      sourceURL: "https://example.com/proxy.pac",
    },
    ...overrides,
  } as ProfileSimple;
}

function mockFetchOk(body: string) {
  return vi.fn(
    async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response(body, { status: 200, statusText: "OK" }),
  );
}

describe("fetchPacScript", () => {
  test("returns response body on 2xx", async () => {
    const fetchFn = mockFetchOk("return 'DIRECT';");
    const result = await fetchPacScript("https://example.com/proxy.pac", {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toBe("return 'DIRECT';");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0][0]).toBe("https://example.com/proxy.pac");
    expect(fetchFn.mock.calls[0][1]?.cache).toBe("no-store");
  });

  test("throws PacFetchError on non-2xx", async () => {
    const fetchFn = vi.fn(async () =>
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    await expect(
      fetchPacScript("https://example.com/proxy.pac", {
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(PacFetchError);
  });

  test("throws PacFetchError on network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("network unreachable");
    });
    await expect(
      fetchPacScript("https://example.com/proxy.pac", {
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/network unreachable/);
  });

  test("aborts on timeout", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err: any = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    await expect(
      fetchPacScript("https://example.com/slow.pac", {
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("refreshPacProfile", () => {
  test("returns unchanged when no sourceURL set", async () => {
    const profile = makePacProfile({
      pacScript: { data: "xxx" },
    } as Partial<ProfileSimple>);

    const fetchFn = vi.fn();
    const result = await refreshPacProfile(profile, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.changed).toBe(false);
    expect(result.profile).toBe(profile);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("marks changed=true when body differs", async () => {
    const profile = makePacProfile();
    const fetchFn = mockFetchOk("return 'PROXY 1.2.3.4:8080';");
    const now = vi.fn(() => 1234);

    const result = await refreshPacProfile(profile, {
      fetchFn: fetchFn as unknown as typeof fetch,
      now,
    });

    expect(result.changed).toBe(true);
    expect(result.profile.proxyType).toBe("pac");
    if (result.profile.proxyType === "pac") {
      expect(result.profile.pacScript.data).toBe("return 'PROXY 1.2.3.4:8080';");
      expect(result.profile.pacScript.lastFetched).toBe(1234);
      expect(result.profile.pacScript.lastError).toBeUndefined();
    }
  });

  test("marks changed=false when body matches cached data", async () => {
    const profile = makePacProfile();
    if (profile.proxyType !== "pac") throw new Error("test setup error");
    const fetchFn = mockFetchOk(profile.pacScript.data || "");
    const now = vi.fn(() => 5678);

    const result = await refreshPacProfile(profile, {
      fetchFn: fetchFn as unknown as typeof fetch,
      now,
    });

    expect(result.changed).toBe(false);
    if (result.profile.proxyType === "pac") {
      expect(result.profile.pacScript.lastFetched).toBe(5678);
      expect(result.profile.pacScript.lastError).toBeUndefined();
    }
  });

  test("preserves cached data and records lastError on fetch failure", async () => {
    const profile = makePacProfile();
    if (profile.proxyType !== "pac") throw new Error("test setup error");
    const originalData = profile.pacScript.data;
    const fetchFn = vi.fn(async () =>
      new Response("oops", { status: 500, statusText: "Server Error" }),
    );

    const result = await refreshPacProfile(profile, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.changed).toBe(false);
    if (result.profile.proxyType === "pac") {
      expect(result.profile.pacScript.data).toBe(originalData);
      expect(result.profile.pacScript.lastError).toMatch(/500/);
    }
  });

  test("interval helpers", () => {
    expect(resolvePacRefreshMinutes({})).toBe(DEFAULT_PAC_REFRESH_MINUTES);
    expect(resolvePacRefreshMinutes({ refreshIntervalMinutes: 5 })).toBe(5);
    expect(resolvePacRefreshMinutes({ refreshIntervalMinutes: 0 })).toBe(0);
    expect(resolvePacRefreshMinutes({ refreshIntervalMinutes: -7 })).toBe(0);
  });

  test("ignores non-pac profiles", async () => {
    const profile = {
      profileID: "simple",
      color: "",
      profileName: "",
      proxyType: "proxy",
      proxyRules: {
        default: { scheme: "http", host: "127.0.0.1", port: 8080 },
        bypassList: [],
      },
    } as ProfileSimple;

    const fetchFn = vi.fn();
    const result = await refreshPacProfile(profile, {
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.changed).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
