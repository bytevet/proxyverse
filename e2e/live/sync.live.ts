import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { ProfilesStorage, ProxyProfile } from "@/services/profile";
import { ServiceWorker } from "../fixtures/sw";
import { SyncSection } from "../pages/sync";

// Two browsers with separate profiles act as two devices syncing through
// northernlight.byte.vet. Each opens the Preference page and clicks "Sign
// in"; you finish the sign-in (GitHub/Google, consent) in its window.

const BUILD = path.resolve(import.meta.dirname, "../../.e2e-build/live-chrome");
// the dev key's extension ID (build/README.md)
const EXTENSION_ID = "ohbdfegnjlfoohcaiedlpbmcacohacmg";
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const SIGN_IN_TIMEOUT = 5 * 60_000;

type Device = {
  name: string;
  context: BrowserContext;
  dir: string;
  page: Page;
  sw: ServiceWorker;
};

async function launch(name: string): Promise<Device> {
  const dir = mkdtempSync(path.join(os.tmpdir(), `proxyverse-live-${name}-`));
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${BUILD}`, `--load-extension=${BUILD}`],
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/index.html#/preference`);
  return { name, context, dir, page, sw: new ServiceWorker(context, EXTENSION_ID) };
}

const profilesOf = (device: Device) => device.sw.getProfiles();
const setProfiles = (device: Device, profiles: ProfilesStorage) =>
  device.sw.setProfiles(profiles);

async function signIn(device: Device) {
  const { page } = device;
  await page.getByTestId("pref-sync-signin").click();
  console.log(`[${device.name}] Finish signing in to northernlight in the window that opened.`);
  await expect(page.getByTestId("pref-sync-account")).toBeVisible({ timeout: SIGN_IN_TIMEOUT });

  // an account with data from an earlier run asks how to combine: merge
  const choice = page.getByTestId("pref-sync-choice-merge");
  await page.waitForTimeout(3000);
  if (await choice.isVisible()) await choice.click();
  await expect(page.getByTestId("pref-sync-status")).toContainText("Last synced", {
    timeout: 60_000,
  });
}

/** Sync `device` until `check` holds for its profiles. */
async function syncUntil(device: Device, check: (p: ProfilesStorage) => boolean) {
  await expect
    .poll(
      async () => {
        await device.page.getByTestId("pref-sync-now").click();
        await device.page.waitForTimeout(1500);
        return check(await profilesOf(device));
      },
      { timeout: 60_000, intervals: [1000, 3000, 5000] }
    )
    .toBe(true);
}

test("two devices sync through northernlight", async () => {
  const a = await launch("A");
  const b = await launch("B");
  try {
    await signIn(a);
    await signIn(b);

    const id = `live-${Date.now()}`;
    const profile: ProxyProfile = {
      profileID: id,
      profileName: "Live smoke",
      color: "#3370FF",
      proxyType: "proxy",
      proxyRules: {
        default: { scheme: "http", host: "10.0.0.1", port: 3128 },
        bypassList: [],
      },
    };

    // created on A, shows up on B
    await setProfiles(a, { ...(await profilesOf(a)), [id]: profile });
    await syncUntil(b, (p) => p[id]?.profileName === "Live smoke");

    // renamed on B, shows up on A
    const onB = await profilesOf(b);
    await setProfiles(b, { ...onB, [id]: { ...onB[id], profileName: "Live smoke, renamed" } });
    await syncUntil(a, (p) => p[id]?.profileName === "Live smoke, renamed");

    // deleted on A, gone from B
    const onA = await profilesOf(a);
    delete onA[id];
    await setProfiles(a, onA);
    await syncUntil(b, (p) => !(id in p));
  } finally {
    for (const d of [a, b]) {
      // sign out: revokes the tokens of this run
      await new SyncSection(d.page).confirm("pref-sync-signout").catch(() => undefined);
      await d.page.waitForTimeout(1000);
      await d.context.close();
      rmSync(d.dir, { recursive: true, force: true });
    }
  }
});
