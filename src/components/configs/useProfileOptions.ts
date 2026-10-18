import { computed, ref } from "vue";
import {
  listProfiles,
  lookupProfile,
  onProfileUpdate,
  ProfilesStorage,
} from "@/services/profile";

// user profiles shared by all pickers, loaded once and kept in sync
const profilesStore = ref<ProfilesStorage>({});
let storeInitialized = false;

function initStore() {
  if (storeInitialized) return;
  storeInitialized = true;
  listProfiles().then((p) => (profilesStore.value = p));
  onProfileUpdate((p) => (profilesStore.value = p));
}

/**
 * Profiles that can be picked as a routing target.
 * `excludeProfileID` is left out to avoid recursive selection.
 */
export function useProfileOptions(excludeProfileID?: () => string | undefined) {
  initStore();

  const userProfiles = computed(() =>
    Object.values(profilesStore.value).filter(
      (profile) => profile.profileID !== excludeProfileID?.()
    )
  );

  const findProfileByID = (profileID: string) =>
    profileID === excludeProfileID?.()
      ? undefined
      : lookupProfile(profilesStore.value, profileID);

  return { userProfiles, findProfileByID };
}
