import { ProfileSimple, saveProfile } from "@/services/profile";

export const initializePresetProfiles = async () => {
  const resp = await fetch("/presets/profiles.json");

  const presetProfiles = (await resp.json()) as unknown as Omit<
    ProfileSimple,
    "profileId"
  >[];

  const saveProfilePromises = presetProfiles.map((profile) =>
    saveProfile({
      ...profile,
      profileID: crypto.randomUUID(),
    })
  );
  await Promise.all(saveProfilePromises);
};
