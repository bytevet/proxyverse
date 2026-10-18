import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { ServiceWorker } from "../fixtures/sw";
import { chooseOption, fillInput, pickProfile, toast } from "./arco";

type ServerField =
  | "proxyRules.default"
  | "proxyRules.http"
  | "proxyRules.https"
  | "proxyRules.ftp";

/** The profile editor of the config page. */
export class ProfileEditor {
  constructor(readonly page: Page) {}

  /** Open the editor for `profileID`, or a new profile. */
  static async open(
    context: BrowserContext,
    sw: ServiceWorker,
    profileID?: string
  ) {
    const page = await context.newPage();
    await page.goto(
      `${sw.origin}/index.html#/profiles/${profileID ?? "new"}`
    );
    await expect(page.getByTestId("proxy-type-proxy")).toBeVisible();
    return new ProfileEditor(page);
  }

  byId(testid: string) {
    return this.page.getByTestId(testid);
  }

  // header
  async setName(name: string) {
    // while editing, Arco replaces the text with an input next to it
    const input = this.page.locator(".profile-name input.arco-input");
    if (!(await input.count())) {
      await this.byId("profile-name")
        .locator(".arco-typography-operation-edit")
        .click();
    }
    await input.fill(name);
    await input.press("Enter");
    await expect(this.byId("profile-name")).toHaveText(name);
  }

  async save() {
    await this.byId("profile-save").click();
  }

  /** Save and wait for the success notification. */
  async saveOK() {
    await this.save();
    await expect(toast(this.page, "The profile had been saved")).toBeVisible();
  }

  async discard() {
    await this.byId("profile-discard").click();
  }

  async delete() {
    await this.byId("profile-delete").click();
    await this.page.locator(".arco-popconfirm:visible .arco-btn-status-danger").click();
  }

  /** The profile ID of a saved profile, from the URL. */
  get profileID() {
    return new URL(this.page.url()).hash.replace("#/profiles/", "");
  }

  async setType(type: "proxy" | "pac" | "auto") {
    await this.byId(`proxy-type-${type}`).click();
  }

  // proxy servers
  async setServer(
    field: ServerField,
    server: { scheme: string; host?: string; port?: number }
  ) {
    await chooseOption(this.page, this.byId(`${field}-scheme`), server.scheme);
    if (server.host !== undefined) {
      await fillInput(this.byId(`${field}-host`), server.host);
    }
    if (server.port !== undefined) {
      await fillInput(this.byId(`${field}-port`), `${server.port}`);
    }
  }

  async setAuth(field: ServerField, auth?: { username: string; password: string }) {
    await this.byId(`${field}-auth`).click();
    if (auth) {
      await this.byId("auth-username").locator("input").fill(auth.username);
      await this.byId("auth-password").locator("input").fill(auth.password);
      await this.byId("auth-save").click();
    } else {
      await this.byId("auth-clear").click();
    }
  }

  async setAdvanced(on: boolean) {
    const box = this.byId("advanced-config");
    const checked = await box.locator("input").isChecked();
    if (checked !== on) await box.click();
  }

  async setBypassList(lines: string[]) {
    await fillInput(this.byId("bypass-list"), lines.join("\n"));
  }

  // pac
  async setPacURL(url: string) {
    await fillInput(this.byId("pac-url"), url);
  }

  async setPacScript(script: string) {
    await fillInput(this.byId("pac-script"), script);
  }

  async setPacInterval(label: string) {
    await chooseOption(this.page, this.byId("pac-interval"), label);
  }

  // auto switch rules
  rule(index: number) {
    return {
      type: this.byId(`rule-${index}-type`),
      condition: this.byId(`rule-${index}-condition`),
      route: this.byId(`rule-${index}-route`),
      delete: this.byId(`rule-${index}-delete`),
      duplicate: this.byId(`rule-${index}-duplicate`),
    };
  }

  rows() {
    return this.page.locator(".auto-switch-form tbody .arco-table-tr");
  }

  async setRule(
    index: number,
    rule: { type?: string; condition?: string; profileID?: string }
  ) {
    const r = this.rule(index);
    if (rule.type) await chooseOption(this.page, r.type, rule.type);
    if (rule.condition !== undefined) await fillInput(r.condition, rule.condition);
    if (rule.profileID) await pickProfile(this.page, r.route, rule.profileID);
  }

  async addRule() {
    await this.byId("rule-add").click();
  }

  /** Drag rule `from` onto the position of rule `to`. */
  async dragRule(from: number, to: number) {
    const handle = (i: number) =>
      this.rows().nth(i).locator(".arco-table-drag-handle");
    await handle(from).dragTo(this.rows().nth(to));
  }
}
