import { ProfileSimple, saveProfile } from "@/services/profile";

export const initializePresetProfiles = async () => {
  const resp = await fetch("/presets/profiles.json");

  const presetProfiles = (await resp.json()) as unknown as Omit<
    ProfileSimple,
    "profileId"
  >[];

  // Save preset profiles
  for (const profile of presetProfiles) {
    await saveProfile({
      ...profile,
      profileID: crypto.randomUUID(),
    });
  }
};
