import { expect, type Locator, type Page } from "@playwright/test";
import type { ProxyProfile } from "@/services/profile";
import type { ServiceWorker } from "../fixtures/sw";
import type { ProfileEditor } from "./editor";
import { toast } from "./arco";

// Editor helpers used by the editor-focused specs (proxy, pac, auto switch).

/** The validation message of the form item holding `field`. */
export function fieldError(field: Locator) {
  return field
    .locator(
      "xpath=ancestor::div[contains(concat(' ', @class, ' '), ' arco-form-item ')][1]",
    )
    .locator(".arco-form-item-message");
}

/** Save, expecting a validation error notification instead of success. */
export async function saveRejected(editor: ProfileEditor, message: string) {
  await editor.save();
  await expect(toast(editor.page, message)).toBeVisible();
}

/** Save a new profile and return its ID once the editor navigated to it. */
export async function saveNew(editor: ProfileEditor): Promise<string> {
  await editor.saveOK();
  await expect(editor.page).toHaveURL(/#\/profiles\/[0-9a-f-]{36}$/);
  return editor.profileID;
}

/** Pick a preset color in the color picker, and return it (#rrggbb). */
export async function pickPresetColor(
  page: Page,
  trigger: Locator,
  index: number,
) {
  await trigger.click();
  const block = page
    .locator(".arco-color-picker-panel:visible .arco-color-picker-color-block")
    .nth(index);
  const rgb = await block
    .locator(".arco-color-picker-block")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await block.click();
  await page.keyboard.press("Escape");
  return rgbToHex(rgb);
}

function rgbToHex(rgb: string) {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function hexToRGBA(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/**
 * Capture what the page copies, as the extension origin can't be granted
 * clipboard permissions. Covers `navigator.clipboard` and the
 * `execCommand("copy")` fallback. Returns a getter for the copied text.
 */
export async function stubClipboard(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__copied = undefined;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__copied = text;
        },
        write: async (items: ClipboardItem[]) => {
          w.__copied = await (await items[0].getType("text/plain")).text();
        },
      },
    });
    const execCommand = document.execCommand.bind(document);
    document.execCommand = (command: string, ...args: any[]) => {
      if (command !== "copy") return execCommand(command, ...args);
      const el = document.activeElement as HTMLTextAreaElement | null;
      w.__copied = el?.value ?? document.getSelection()?.toString();
      return true;
    };
  });
  return () =>
    page.evaluate(() => (window as any).__copied as string | undefined);
}

type Stored = {
  proxy: ProxyProfile & { proxyType: "proxy" };
  pac: ProxyProfile & { proxyType: "pac" };
  auto: ProxyProfile & { proxyType: "auto" };
};

/** A stored profile, expected to be of type `type`. */
export async function stored<T extends keyof Stored>(
  sw: ServiceWorker,
  profileID: string,
  type: T,
): Promise<Stored[T]> {
  const profile = (await sw.getProfiles())[profileID];
  expect(profile?.proxyType).toBe(type);
  return profile as Stored[T];
}
