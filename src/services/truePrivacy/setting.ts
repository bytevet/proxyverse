import { Host } from "@/adapters";

// Whether True Privacy Proxy is turned on for the account. It syncs through
// byte.vet (`pref:proxy.truePrivacy`) even with "Sync preferences" off, as
// it belongs to the account rather than the device. Unset means off.

export const keyTruePrivacy = "proxy.truePrivacy";
export const defaultTruePrivacy = false;

export async function getTruePrivacyEnabled(): Promise<boolean> {
  return Host.getWithDefault<boolean>(keyTruePrivacy, defaultTruePrivacy);
}

export async function setTruePrivacyEnabled(enabled: boolean) {
  await Host.set<boolean>(keyTruePrivacy, enabled);
}

/** Subscribe to changes of the setting, made here, elsewhere or by sync. */
export function onTruePrivacyEnabledChanged(
  callback: (enabled: boolean) => void
): () => void {
  return Host.onLocalStorageChanged((changes) => {
    if (keyTruePrivacy in changes) {
      callback(
        (changes[keyTruePrivacy].newValue as boolean) ?? defaultTruePrivacy
      );
    }
  });
}
