import { afterEach, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import {
  deleteProfile,
  listProfiles,
  saveProfile,
  type ProxyProfile,
} from "@/services/profile";

const proxy = (profileID: string): ProxyProfile => ({
  profileID,
  color: "#123456",
  profileName: profileID,
  proxyType: "proxy",
  proxyRules: { default: { host: "10.0.0.1", port: 8080 }, bypassList: [] },
});

afterEach(() => vi.restoreAllMocks());

test("concurrent profile writes don't lose each other's changes", async () => {
  let stored: unknown = { gone: proxy("gone") };
  // A slow storage widens the read-modify-write window.
  const tick = () => new Promise((r) => setTimeout(r, 5));
  vi.spyOn(Host, "get").mockImplementation(async () => {
    await tick();
    return structuredClone(stored);
  });
  vi.spyOn(Host, "set").mockImplementation(async (_, val) => {
    await tick();
    stored = val;
  });

  await Promise.all([
    saveProfile(proxy("a")),
    saveProfile(proxy("b")),
    deleteProfile("gone"),
    saveProfile(proxy("c")),
  ]);

  expect(Object.keys(await listProfiles()).sort()).toEqual(["a", "b", "c"]);
});
