import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { ServiceWorker } from "../fixtures/sw";

export class Popup {
  constructor(readonly page: Page) {}

  /** Open the popup acting on `tabID` (or on the active tab). */
  static async open(context: BrowserContext, sw: ServiceWorker, tabID?: number) {
    const page = await context.newPage();
    const query = tabID === undefined ? "" : `?tabID=${tabID}`;
    await page.goto(`${sw.origin}/index.html#/popup${query}`);
    await expect(page.getByTestId("popup-profile-direct")).toBeVisible();
    // the app stores the theme setting once it has applied it
    await expect.poll(() => sw.getLocal("theme.darkmode")).not.toBeUndefined();
    return new Popup(page);
  }

  profile(profileID: string) {
    return this.page.getByTestId(`popup-profile-${profileID}`);
  }

  /** Activate a profile and wait until it's applied. */
  async select(profileID: string) {
    await this.profile(profileID).click();
    await expect(this.profile(profileID)).toHaveClass(/arco-menu-selected/);
  }

  get actionBar() {
    return this.page.getByTestId("auto-mode-action");
  }

  get chip() {
    return this.actionBar.getByTestId("switch-chip");
  }

  get failedAlert() {
    return this.page.getByTestId("failed-alert");
  }

  /** Click a button that opens a new tab, and return that tab. */
  async openNewTab(testid: "popup-create" | "popup-config") {
    const next = this.page.context().waitForEvent("page");
    await this.page.getByTestId(testid).click();
    const page = await next;
    await page.waitForLoadState();
    return page;
  }
}
