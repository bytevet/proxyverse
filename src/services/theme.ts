// The theme setting's storage key and values, without Vue, so the background
// (which syncs the setting) doesn't bundle Vue. `preference.ts` applies it.

export const keyDarkMode = "theme.darkmode";

export enum DarkMode {
  Default = 0,
  Dark = 1,
  Light = 2,
}
