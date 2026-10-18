import { Host } from "@/adapters";

const keyDarkMode = "theme.darkmode";

export enum DarkMode {
  Default = 0,
  Dark = 1,
  Light = 2,
}

function detectDeviceDarkMode() {
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return DarkMode.Dark;
  }

  return DarkMode.Light;
}

/**
 * Get the current DarkMode setting. If not set, then returns `DarkMode.Default`
 */
export async function getDarkModeSetting(): Promise<DarkMode> {
  return Host.getWithDefault<DarkMode>(keyDarkMode, DarkMode.Default);
}

/**
 * Return the current real DarkMode, can only be either Light or Dark.
 * @returns {DarkMode.Dark | DarkMode.Light}
 */
export async function currentDarkMode(): Promise<
  DarkMode.Dark | DarkMode.Light
> {
  const ret = await Host.getWithDefault<DarkMode>(
    keyDarkMode,
    DarkMode.Default
  );
  if (ret != DarkMode.Default) {
    return ret;
  }

  return detectDeviceDarkMode();
}

export async function changeDarkMode(newMode: DarkMode) {
  await Host.set<DarkMode>(keyDarkMode, newMode);
  applyDarkMode(newMode);
}

/**
 * Re-apply the theme when the system theme changes, if following the system.
 * Call once per page.
 */
export function followSystemDarkMode() {
  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", async () => {
      if ((await getDarkModeSetting()) == DarkMode.Default) {
        applyDarkMode(DarkMode.Default);
      }
    });
}

function applyDarkMode(newMode: DarkMode) {
  if (newMode == DarkMode.Default) {
    newMode = detectDeviceDarkMode();
  }

  switch (newMode) {
    case DarkMode.Dark:
      document?.body?.setAttribute("arco-theme", "dark");
      break;
    case DarkMode.Light:
      document?.body?.removeAttribute("arco-theme");
      break;
  }
}
