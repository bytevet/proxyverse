import { expect, type Locator, type Page } from "@playwright/test";

// Helpers for Arco Design widgets whose popups are rendered in <body>.

/** Pick `text` in an `a-select`. */
export async function chooseOption(page: Page, select: Locator, text: string) {
  await select.click();
  await page
    .locator(".arco-select-dropdown:visible .arco-select-option")
    .filter({ hasText: new RegExp(`^\\s*${escape(text)}\\s*$`) })
    .click();
}

/** An option of the open profile dropdown. */
export function profileOption(page: Page, profileID: string) {
  return page.locator(`[data-testid="profile-option-${profileID}"]:visible`);
}

/** Pick a profile in a profile dropdown (ProfileSelector / switch chip). */
export async function pickProfile(page: Page, trigger: Locator, profileID: string) {
  await trigger.click();
  await profileOption(page, profileID).click();
}

/** Wait until no dropdown is shown, e.g. one still fading out. */
export async function dropdownsClosed(page: Page) {
  await expect(page.locator(".arco-dropdown:visible")).toHaveCount(0);
}

/** Options shown by the profile dropdown opened from `trigger`. */
export async function profileOptions(page: Page, trigger: Locator) {
  await dropdownsClosed(page);
  await trigger.click();
  const options = page.locator(
    '.arco-dropdown:visible [data-testid^="profile-option-"]'
  );
  await expect(options.first()).toBeVisible();
  const ret = await options.evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-testid")!.replace("profile-option-", ""),
      disabled: el.classList.contains("arco-dropdown-option-disabled"),
    }))
  );
  await page.keyboard.press("Escape");
  await trigger.click(); // close
  return ret;
}

/**
 * A notification or message toast containing `text`. Matching by text keeps
 * it independent of the stacking order of toasts.
 */
export function toast(page: Page, text: string | RegExp) {
  return page
    .locator(".arco-notification, .arco-message")
    .filter({ hasText: text })
    .first();
}

/** Fill an Arco input (the testid sits on the wrapper). */
export async function fillInput(wrapper: Locator, value: string) {
  const input = wrapper.locator("input, textarea").first();
  await input.fill(value);
  await input.blur();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
