import { onMounted, onUnmounted, shallowRef } from "vue";
import {
  getSyncAuth,
  getSyncSettings,
  getSyncState,
  keySyncAuth,
  keySyncSettings,
  keySyncState,
  onSyncStorageChanged,
  withSyncDefaults,
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
  const settings = shallowRef<SyncSettings>(withSyncDefaults(undefined));

  let unsubscribe: (() => void) | undefined;
  onMounted(async () => {
    // a change carries the new value: no need to read it back
    unsubscribe = onSyncStorageChanged((changes) => {
      if (keySyncAuth in changes) {
        auth.value = changes[keySyncAuth]?.newValue as SyncAuth | undefined;
      }
      if (keySyncState in changes) {
        state.value = changes[keySyncState]?.newValue as SyncState | undefined;
      }
      if (keySyncSettings in changes) {
        settings.value = withSyncDefaults(
          changes[keySyncSettings]?.newValue as Partial<SyncSettings> | undefined
        );
      }
    });
    [auth.value, state.value, settings.value] = await Promise.all([
      getSyncAuth(),
      getSyncState(),
      getSyncSettings(),
    ]);
  });
  onUnmounted(() => unsubscribe?.());

  return { auth, state, settings };
}
