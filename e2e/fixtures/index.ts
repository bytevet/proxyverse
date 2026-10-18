import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { startServers, type Servers } from "../servers";
import { ServiceWorker } from "./sw";
import { Popup } from "../pages/popup";
import { ProfileEditor } from "../pages/editor";

export const CHROME_BUILD = path.resolve(import.meta.dirname, "../../.e2e-build/chrome");

type WorkerFixtures = {
  servers: Servers;
  extContext: BrowserContext;
  workerSW: ServiceWorker;
};

type TestFixtures = {
  sw: ServiceWorker;
  /** Open the popup acting on a tab (the active one if omitted). */
  openPopup: (tabID?: number) => Promise<Popup>;
  /** Open the profile editor (a new profile if no ID is given). */
  openEditor: (profileID?: string) => Promise<ProfileEditor>;
  /** Open a config page route, e.g. "/preference". */
  openConfig: (route: string) => Promise<Page>;
  /** Activate a profile through the popup, and close it. */
  activate: (profileID: string) => Promise<void>;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  servers: [
    async ({}, use) => {
      const servers = await startServers();
      await use(servers);
      await servers.close();
    },
    { scope: "worker" },
  ],

  extContext: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        headless: !process.env.HEADED,
        args: [
          `--disable-extensions-except=${CHROME_BUILD}`,
          `--load-extension=${CHROME_BUILD}`,
          // fake sites; requests going through a proxy never resolve them
          "--host-resolver-rules=MAP *.test 127.0.0.1",
        ],
      });
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  workerSW: [
    async ({ extContext }, use) => {
      let [worker] = extContext.serviceWorkers();
      worker ??= await extContext.waitForEvent("serviceworker");
      await use(new ServiceWorker(extContext, new URL(worker.url()).host));
    },
    { scope: "worker" },
  ],

  // every test shares the worker's browser, starting from a clean state
  context: async ({ extContext, workerSW, servers }, use, testInfo) => {
    servers.reset();
    await workerSW.reset();
    await extContext.tracing.start({ screenshots: true, snapshots: true });

    await use(extContext);

    const failed = testInfo.status !== testInfo.expectedStatus;
    await extContext.tracing.stop(
      failed ? { path: testInfo.outputPath("trace.zip") } : undefined
    );
    for (const page of extContext.pages()) await page.close();
  },

  page: async ({ context }, use) => {
    await use(await context.newPage());
  },

  sw: async ({ context, workerSW }, use) => {
    void context; // make sure the state is reset first
    await use(workerSW);
  },

  openPopup: async ({ context, sw }, use) => {
    await use((tabID) => Popup.open(context, sw, tabID));
  },

  openEditor: async ({ context, sw }, use) => {
    await use((profileID) => ProfileEditor.open(context, sw, profileID));
  },

  openConfig: async ({ sw }, use) => {
    await use((route) => sw.openPage(route));
  },

  activate: async ({ context, sw }, use) => {
    await use(async (profileID) => {
      const popup = await Popup.open(context, sw);
      await popup.select(profileID);
      await popup.page.close();
    });
  },
});

export { expect };
