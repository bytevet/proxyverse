// Fixtures shared by unit tests.
import { vi } from "vitest";
import { Host } from "@/adapters";
import type { ProxyProfile } from "@/services/profile";

/** A valid proxy profile (it passes the export schema). */
export const proxyProfile = (profileID: string, host = "10.0.0.1"): ProxyProfile => ({
  profileID,
  color: "#AABBCC",
  profileName: profileID,
  proxyType: "proxy",
  proxyRules: { default: { scheme: "http", host, port: 8080 }, bypassList: [] },
});

/** A JSON `Response`. */
export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Back `Host`'s session storage with a plain object, returned for
 * inspection; values are copied in and out. Restore with
 * `vi.restoreAllMocks()`.
 */
export function fakeSessionStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  vi.spyOn(Host, "getSession").mockImplementation(async (key: string) =>
    structuredClone(store[key]) as never
  );
  vi.spyOn(Host, "setSession").mockImplementation(async (key, value) => {
    store[key] = structuredClone(value);
  });
  vi.spyOn(Host, "removeSession").mockImplementation(async (key) => {
    delete store[key];
  });
  return store;
}

/**
 * Back `Host`'s local storage with a plain object, returned for inspection.
 * Values are copied in and out, as browser storage does. Restore with
 * `vi.restoreAllMocks()`.
 */
export function fakeLocalStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  vi.spyOn(Host, "get").mockImplementation(async (key: string) =>
    structuredClone(store[key]) as never
  );
  vi.spyOn(Host, "set").mockImplementation(async (key, value) => {
    store[key] = structuredClone(value);
  });
  vi.spyOn(Host, "remove").mockImplementation(async (key) => {
    delete store[key];
  });
  return store;
}
