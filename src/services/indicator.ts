import { Host } from "@/adapters";
import { ProxyProfile, SystemProfile } from "./profile";

export async function setIndicator(
  profile: ProxyProfile | undefined,
  tabID?: number
) {
  if (profile) {
    await Host.setBadge(profile.profileName, profile.color, tabID);
  } else {
    // clear badge
    await Host.setBadge("", SystemProfile.SYSTEM.color, tabID);
  }
}
