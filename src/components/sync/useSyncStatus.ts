import { onMounted, onUnmounted, shallowRef } from "vue";
import {
  getSyncAuth,
  getSyncSettings,
  getSyncState,
  onSyncStorageChanged,
  type SyncAuth,
  type SyncSettings,
  type SyncState,
} from "@/services/sync/state";

/**
 * The sync sign-in, state and settings, kept up to date with storage: the
 * background writes them as it syncs, other pages as the user acts.
 */
export function useSyncStatus() {
  const auth = shallowRef<SyncAuth>();
  const state = shallowRef<SyncState>();
  const settings = shallowRef<SyncSettings>();

  const load = async () => {
    [auth.value, state.value, settings.value] = await Promise.all([
      getSyncAuth(),
      getSyncState(),
      getSyncSettings(),
    ]);
  };

  let unsubscribe: (() => void) | undefined;
  onMounted(() => {
    unsubscribe = onSyncStorageChanged(() => void load());
    void load();
  });
  onUnmounted(() => unsubscribe?.());

  return { auth, state, settings, reload: load };
}
