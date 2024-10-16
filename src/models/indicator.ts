import { Host } from "@/adapters";
import { SystemProfile } from "./profile";
import { ProxySetting } from "./proxy";

export async function setIndicator(proxy: ProxySetting) {
  const curMode = proxy.setting.value?.mode;
  let profile =
    proxy.setting.levelOfControl == "controlled_by_this_extension"
      ? proxy.activeProfile
      : undefined;

  // override profile
  switch (curMode) {
    case "system":
      profile = SystemProfile.SYSTEM;
      break;
    case "direct":
      profile = SystemProfile.DIRECT;
      break;
  }

  if (profile) {
    await Host.setBadge(profile.profileName, profile.color);
  } else {
    // clear badge
    await Host.setBadge("", SystemProfile.SYSTEM.color);
  }
}
