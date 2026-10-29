import { readonly, ref } from "vue";
import { Host } from "@/adapters";

import { DarkMode, defaultDarkMode, keyDarkMode } from "./theme";

export { DarkMode };

function detectDeviceDarkMode() {
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return DarkMode.Dark;
  }

  return DarkMode.Light;
}

// This page's copy of the setting, kept in sync with the storage
const setting = ref<DarkMode>(DarkMode.Default);

/** The stored setting; `DarkMode.Default` (follow the system) if unset. */
async function getDarkModeSetting(): Promise<DarkMode> {
  return Host.getWithDefault<DarkMode>(keyDarkMode, defaultDarkMode);
}

/** Apply the stored setting to this page. */
export async function applyStoredDarkMode() {
  setting.value = await getDarkModeSetting();
  applyDarkMode(setting.value);
}

export async function changeDarkMode(newMode: DarkMode) {
  setting.value = newMode;
  applyDarkMode(newMode);
  await Host.set<DarkMode>(keyDarkMode, newMode);
}

/**
 * Keep this page's theme up to date: with the setting, when it's changed in
 * another page, and with the system theme, when following it. Call once per
 * page.
 */
export function followDarkMode() {
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (setting.value == DarkMode.Default) applyDarkMode(DarkMode.Default);
    });

  Host.onLocalStorageChanged((changes) => {
    if (!(keyDarkMode in changes)) return;
    setting.value =
      (changes[keyDarkMode].newValue as DarkMode | undefined) ??
      DarkMode.Default;
    applyDarkMode(setting.value);
  });
}

/** The theme setting of this page, and the theme it currently shows. */
export function useDarkMode() {
  return {
    setting: readonly(setting),
    // not reactive: the system theme isn't
    shown: () =>
      setting.value == DarkMode.Default ? detectDeviceDarkMode() : setting.value,
    change: changeDarkMode,
  };
}

function applyDarkMode(setting: DarkMode) {
  const mode =
    setting == DarkMode.Default ? detectDeviceDarkMode() : setting;
  document.documentElement.style.colorScheme =
    mode == DarkMode.Dark ? "dark" : "light";
  if (mode == DarkMode.Dark) {
    document.body.setAttribute("arco-theme", "dark");
  } else {
    document.body.removeAttribute("arco-theme");
  }
}
