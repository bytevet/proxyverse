import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import type { ProxyProfile } from "@/services/profile";

export const XPI = path.resolve(import.meta.dirname, "../../.e2e-build/proxyverse.xpi");
export const ADDON_ID = "proxyverse@byte.vet";
const UUID = "6f1e0c52-3d0a-4b8e-9a51-2f7c6b1d9e40";
export const ORIGIN = `moz-extension://${UUID}`;

/** geckodriver: $GECKODRIVER, then PATH (CI), then Selenium Manager's cache. */
function geckodriverPath(options: firefox.Options): string {
  if (process.env.GECKODRIVER) return process.env.GECKODRIVER;
  try {
    const found = execFileSync("which", ["geckodriver"], { encoding: "utf8" }).trim();
    if (found && existsSync(found)) return found;
  } catch {
    // not on PATH
  }
  const require = createRequire(import.meta.url);
  const { getBinaryPaths } = require("selenium-webdriver/common/driverFinder");
  return getBinaryPaths(options).driverPath;
}

/**
 * Start a headless Firefox with the extension installed as a temporary
 * add-on, allowed in private windows (required for proxy.settings).
 * `directHosts` resolve to 127.0.0.1 for requests that don't use a proxy.
 */
export async function launchFirefox(directHosts: string[]): Promise<Firefox> {
  const options = new firefox.Options()
    .addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [ADDON_ID]: UUID }))
    .setPreference("network.dns.localDomains", directHosts.join(","));

  const service = new firefox.ServiceBuilder(geckodriverPath(options)).addArguments(
    "--allow-system-access"
  );
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();

  const ff = new Firefox(driver);
  await (driver as firefox.Driver).installAddon(XPI, true);
  await ff.allowPrivateBrowsing();
  return ff;
}

export class Firefox {
  constructor(readonly driver: WebDriver) {}

  private async inChrome<T>(fn: () => Promise<T>): Promise<T> {
    const d = this.driver as firefox.Driver;
    await d.setContext(firefox.Context.CHROME);
    try {
      return await fn();
    } finally {
      await d.setContext(firefox.Context.CONTENT);
    }
  }

  /** Grant private browsing access and reload the add-on to apply it. */
  async allowPrivateBrowsing() {
    await this.inChrome(() =>
      this.driver.executeAsyncScript(
        `const [id, done] = arguments;
        const { ExtensionPermissions } = ChromeUtils.importESModule(
          "resource://gre/modules/ExtensionPermissions.sys.mjs");
        const { AddonManager } = ChromeUtils.importESModule(
          "resource://gre/modules/AddonManager.sys.mjs");
        ExtensionPermissions.add(id, {
          permissions: ["internal:privateBrowsingAllowed"], origins: [],
        })
          .then(() => AddonManager.getAddonByID(id))
          .then((addon) => addon.reload())
          .then(() => done(null), (e) => done(String(e)));`,
        ADDON_ID
      )
    ).then((err) => {
      if (err) throw new Error(`granting private browsing failed: ${err}`);
    });
  }

  /**
   * Open an extension page (`#route` of index.html) in a new tab and switch
   * to it. WebDriver can't navigate to moz-extension:// URLs itself.
   */
  async openExtensionPage(route: string) {
    const before = await this.driver.getAllWindowHandles();
    await this.inChrome(() =>
      this.driver.executeScript(
        `const win = Services.wm.getMostRecentWindow("navigator:browser");
        win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });`,
        `${ORIGIN}/index.html#${route}`
      )
    );
    await this.driver.wait(
      async () => (await this.driver.getAllWindowHandles()).length > before.length,
      10_000
    );
    const handles = await this.driver.getAllWindowHandles();
    const handle = handles.find((h) => !before.includes(h)) ?? handles[handles.length - 1];
    await this.driver.switchTo().window(handle);
    await this.driver.wait(
      async () => (await this.driver.getCurrentUrl()).startsWith(ORIGIN),
      10_000
    );
  }

  /** Open a regular tab and switch to it. */
  async newTab() {
    await this.driver.switchTo().newWindow("tab");
  }

  /** Replace the stored profiles (call from an extension page). */
  async setProfiles(profiles: ProxyProfile[]) {
    const data = Object.fromEntries(profiles.map((p) => [p.profileID, p]));
    await this.driver.executeAsyncScript(
      `const [profiles, done] = arguments;
      browser.storage.local.set({ profiles }).then(() => done(), (e) => done(String(e)));`,
      data
    );
  }

  byTestId(id: string) {
    return this.driver.wait(until.elementLocated(By.css(`[data-testid="${id}"]`)), 10_000);
  }

  /** Load `url` in the current tab and return the body text (or the error). */
  async bodyOf(url: string): Promise<string> {
    const u = new URL(url);
    u.searchParams.set("e2e", `${Date.now()}`);
    try {
      await this.driver.get(u.href);
      return await this.driver.findElement(By.css("body")).getText();
    } catch (e: any) {
      return `error:${String(e.message).split("\n")[0]}`;
    }
  }

  async quit() {
    await this.driver.quit();
  }
}
