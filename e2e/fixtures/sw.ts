import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import type { ProfilesStorage, ProxyProfile } from "@/services/profile";
import type { TabStatsResult } from "@/services/stats";

/**
 * Access to the extension's service worker. The worker may be stopped and
 * restarted by the browser (or by `restart()`), so it's looked up on demand.
 */
export class ServiceWorker {
  constructor(
    private context: BrowserContext,
    readonly extensionId: string
  ) {}

  get origin() {
    return `chrome-extension://${this.extensionId}`;
  }

  /** The live worker, waking it up if it was stopped. */
  async worker(): Promise<Worker> {
    const live = this.context
      .serviceWorkers()
      .filter((w) => w.url().startsWith(this.origin));
    if (live.length) return live[live.length - 1];

    const next = this.context.waitForEvent("serviceworker", {
      predicate: (w) => w.url().startsWith(this.origin),
    });
    // opening an extension page starts the worker
    const page = await this.openPage("/preference");
    const worker = await next;
    await page.close();
    return worker;
  }

  /** Open an extension page route, e.g. "/preference", in a new tab. */
  async openPage(route: string) {
    const page = await this.context.newPage();
    await page.goto(`${this.origin}/index.html#${route}`);
    return page;
  }

  async eval<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A) {
    const worker = await this.worker();
    return worker.evaluate(fn as any, arg) as Promise<R>;
  }

  /**
   * Stop the worker, like the browser does when it's idle, and wait until a
   * fresh one runs. (Playwright keeps listing the stopped worker, so a marker
   * global tells the two apart.)
   */
  async restart() {
    await this.eval(() => ((globalThis as any).e2eStale = true));

    const page = this.context.pages()[0] ?? (await this.context.newPage());
    const cdp = await this.context.newCDPSession(page);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.startsWith(this.origin)
    );
    if (target) await cdp.send("Target.closeTarget", { targetId: target.targetId });
    await cdp.detach();

    await expect
      .poll(async () => {
        // opening an extension page starts the worker again
        await (await this.openPage("/preference")).close();
        return this.eval(() => (globalThis as any).e2eStale);
      })
      .toBeUndefined();
  }

  // storage
  async setProfiles(profiles: ProxyProfile[] | ProfilesStorage) {
    const data = Array.isArray(profiles)
      ? Object.fromEntries(profiles.map((p) => [p.profileID, p]))
      : profiles;
    await this.eval((d) => chrome.storage.local.set({ profiles: d }), data);
  }

  async getProfiles(): Promise<ProfilesStorage> {
    return this.eval(
      async () =>
        ((await chrome.storage.local.get("profiles")).profiles ??
          {}) as ProfilesStorage
    );
  }

  async getLocal(key: string) {
    return this.eval(async (k) => (await chrome.storage.local.get(k))[k], key);
  }

  async getSession(): Promise<Record<string, any>> {
    return this.eval(() => chrome.storage.session.get(null));
  }

  /** The request stats saved for a tab, if any. */
  async getTabStats(tabID: number): Promise<TabStatsResult | undefined> {
    return (await this.getSession())[`tabstats:${tabID}`];
  }

  // proxy
  async getProxySettings(): Promise<chrome.types.ChromeSettingGetResult<chrome.proxy.ProxyConfig>> {
    return this.eval(() => chrome.proxy.settings.get({}));
  }

  // badge
  async getBadge(tabId?: number) {
    return this.eval(
      async (id) => ({
        text: await chrome.action.getBadgeText({ tabId: id }),
        color: await chrome.action.getBadgeBackgroundColor({ tabId: id }),
      }),
      tabId
    );
  }

  // alarms
  async getAlarms(): Promise<chrome.alarms.Alarm[]> {
    return this.eval(() => chrome.alarms.getAll());
  }

  /** Fire the extension's alarm handler for `name` right away. */
  async fireAlarm(name: string) {
    await this.eval(
      (n) => chrome.alarms.create(n, { when: Date.now() + 50 }),
      name
    );
  }

  // tabs
  async tabIdOf(page: Page): Promise<number> {
    const url = page.url();
    const id = await this.eval(
      async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id,
      url
    );
    if (id === undefined) throw new Error(`no tab found for ${url}`);
    return id;
  }

  /** Reset all extension state between tests. */
  async reset() {
    await this.eval(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      await chrome.alarms.clearAll();
      await chrome.proxy.settings.clear({ scope: "regular" });
      await chrome.action.setBadgeText({ text: "" });
    });
  }
}
