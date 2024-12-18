import { saveProfile } from "@/services/profile";
import { PRESET_PROFILES } from "./profiles";

export const initializePresetProfiles = async () => {
  // Save preset profiles
  for (const profile of PRESET_PROFILES) {
    await saveProfile(profile);
  }
};
