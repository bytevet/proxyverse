import { expect, type Page } from "@playwright/test";
import type { FilePayload } from "../data/configFiles";

/** The Preference page (import / export) of the config page. */
export class Preference {
  constructor(readonly page: Page) {}

  /** Export the profiles, returning the downloaded file name and content. */
  async export() {
    const download = this.page.waitForEvent("download");
    await this.page.getByTestId("export-profiles").click();
    const file = await download;
    const stream = await file.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk;
    return { name: file.suggestedFilename(), json: JSON.parse(text) };
  }

  /** Confirm the overwrite warning and pick `file` for the import. */
  async import(file: FilePayload) {
    await this.page.getByTestId("import-profiles").click();
    const chooser = this.page.waitForEvent("filechooser");
    await this.page.locator(".arco-popconfirm:visible .arco-btn-primary").click();
    await (await chooser).setFiles(file);
  }

  async expectOpen() {
    await expect(this.page.getByTestId("export-profiles")).toBeVisible();
  }
}
