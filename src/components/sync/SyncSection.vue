<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from "vue";
import { Host } from "@/adapters";
import { Notification } from "@arco-design/web-vue";
import {
  IconCloud,
  IconSync,
  IconHistory,
} from "@arco-design/web-vue/es/icon";
import { signIn, signOut, SyncAuthError } from "@/services/sync/auth";
import type { SnapshotMeta } from "@/services/sync/api";
import type { FirstChoice } from "@/services/sync/engine";
import {
  chooseFirstSync,
  listSnapshots,
  requestSync,
  restoreSnapshot,
} from "@/services/sync";
import {
  isSignedIn,
  updateSyncSettings,
} from "@/services/sync/state";
import { useSyncStatus } from "./useSyncStatus";
import { relativeTime } from "./relativeTime";

const emit = defineEmits<{
  /** Download the profiles, before replacing them with the cloud's. */
  (e: "backup"): void;
}>();

const { auth, state, settings } = useSyncStatus();

const signedIn = computed(() => isSignedIn(auth.value));
const account = computed(
  () => auth.value?.account?.email ?? Host.getMessage("sync_account_unknown")
);

const busy = ref<"signin" | "sync" | "choice" | "restore">();
const errorText = (e: unknown) => String((e as Error)?.message ?? e);

const notifyError = (e: unknown) =>
  Notification.error({
    content: Host.getMessage("config_feedback_error_occurred", errorText(e)),
  });

/** Run an action with its button busy, reporting a failure as a toast. */
async function withBusy(kind: NonNullable<typeof busy.value>, action: () => Promise<void>) {
  busy.value = kind;
  try {
    await action();
  } catch (e) {
    // closing the sign-in window isn't an error
    if (!(e instanceof SyncAuthError && e.code === "cancelled")) notifyError(e);
  } finally {
    busy.value = undefined;
  }
}

// the background starts syncing when it sees the sign-in
const startSignIn = () => withBusy("signin", async () => void (await signIn()));
const syncNow = () => withBusy("sync", requestSync);
const choose = (choice: FirstChoice) => withBusy("choice", () => chooseFirstSync(choice));

const toggleSyncPrefs = (on: boolean) =>
  updateSyncSettings((s) => (s.syncPrefs = on));

// --- status ---

const ERROR_KEYS: Record<string, string> = {
  auth: "sync_error_auth",
  clock_skew: "sync_error_clock_skew",
  network: "sync_error_unreachable",
  unavailable: "sync_error_unreachable",
  rate_limited: "sync_error_unreachable",
  client_too_old: "sync_error_client_too_old",
  quota_exceeded: "sync_error_quota",
};

// ticks so "5 minutes ago" stays true while the page is open
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 30_000);
onUnmounted(() => clearInterval(ticker));

/** The last sync's exact time, shown on hover. */
const lastSyncAt = computed(() => {
  const at = state.value?.lastSync?.at;
  return at === undefined ? undefined : new Date(at).toLocaleString();
});

const status = computed(() => {
  const last = state.value?.lastSync;
  if (!last) return { warning: false, text: Host.getMessage("sync_status_never") };
  const when = relativeTime(
    last.at,
    now.value,
    Host.currentLocale(),
    Host.getMessage("sync_time_recent")
  );
  if (!last.error) {
    return { warning: false, text: Host.getMessage("sync_status_ok", when) };
  }
  const key = ERROR_KEYS[last.error.code];
  return {
    warning: true,
    text: key
      ? Host.getMessage(key, when)
      : Host.getMessage("sync_error_other", [when, last.error.code]),
  };
});

const failedCount = computed(() => Object.keys(state.value?.failed ?? {}).length);
const heldCount = computed(() => Object.keys(state.value?.held ?? {}).length);

// --- snapshots ---

const snapshotsVisible = ref(false);
const snapshots = shallowRef<SnapshotMeta[]>([]);

const openSnapshots = async () => {
  snapshotsVisible.value = true;
  try {
    snapshots.value = await listSnapshots();
  } catch (e) {
    notifyError(e);
  }
};

const restore = (id: string) =>
  withBusy("restore", async () => {
    await restoreSnapshot(id);
    snapshotsVisible.value = false;
    Notification.success({ content: Host.getMessage("sync_restore_done") });
  });

const snapshotReason = (r: SnapshotMeta["reason"]) =>
  Host.getMessage(`sync_snapshot_reason_${r.replace("-", "_")}`);
</script>

<template>
  <section data-testid="pref-sync">
    <a-divider orientation="left">{{ $t("preferences_section_sync") }}</a-divider>

    <!-- rows of the Preference page's form, sharing its label column -->
    <a-form-item v-if="!signedIn" :label="$t('sync_account')">
      <a-space direction="vertical" fill>
        <a-alert v-if="auth?.expired" type="warning" data-testid="pref-sync-expired">{{
          $t("sync_signin_expired", account)
        }}</a-alert>
        <a-button
          type="primary"
          data-testid="pref-sync-signin"
          :loading="busy === 'signin'"
          @click="startSignIn"
        >
          <template #icon><icon-cloud /></template>
          {{ $t("sync_action_signin") }}
        </a-button>
      </a-space>
      <template #extra>
        <div>{{ $t("sync_desc") }}</div>
        <div>{{ $t("sync_privacy_note") }}</div>
      </template>
    </a-form-item>

    <template v-else>
      <a-form-item :label="$t('sync_account')">
        <a-space wrap>
          <span data-testid="pref-sync-account">{{ account }}</span>
          <a-popconfirm :content="$t('sync_signout_confirm')" @ok="signOut">
            <a-button type="text" size="small" data-testid="pref-sync-signout">{{
              $t("sync_action_signout")
            }}</a-button>
          </a-popconfirm>
        </a-space>
      </a-form-item>

      <a-form-item :label="$t('sync_status')">
        <a-space direction="vertical" fill>
          <a-space wrap>
            <a-typography-text
              data-testid="pref-sync-status"
              :title="lastSyncAt"
              :type="status.warning ? 'warning' : 'secondary'"
              >{{ status.text }}</a-typography-text
            >
            <a-button
              size="small"
              data-testid="pref-sync-now"
              :loading="busy === 'sync'"
              @click="syncNow"
            >
              <template #icon><icon-sync /></template>
              {{ $t("sync_action_now") }}
            </a-button>
          </a-space>
          <a-typography-text
            v-if="failedCount > 0"
            type="warning"
            data-testid="pref-sync-failed"
            >{{ $t("sync_status_failed", failedCount.toString()) }}</a-typography-text
          >
          <a-typography-text
            v-if="heldCount > 0"
            type="warning"
            data-testid="pref-sync-held"
            >{{ $t("sync_status_held", heldCount.toString()) }}</a-typography-text
          >
        </a-space>
      </a-form-item>

      <a-form-item
        :label="$t('sync_prefs')"
        :extra="$t('sync_prefs_hint')"
      >
        <a-switch
          data-testid="pref-sync-prefs"
          :model-value="settings.syncPrefs"
          @change="(v) => toggleSyncPrefs(v as boolean)"
        />
      </a-form-item>

      <a-form-item :label="$t('sync_snapshots')" :extra="$t('sync_snapshots_hint')">
        <a-button size="small" data-testid="pref-sync-snapshots" @click="openSnapshots">
          <template #icon><icon-history /></template>
          {{ $t("sync_action_snapshots") }}
        </a-button>
      </a-form-item>
    </template>
  </section>

  <a-modal
    :visible="signedIn && !!state?.needsFirstChoice"
    :title="$t('sync_first_title')"
    :footer="false"
    :closable="false"
    :mask-closable="false"
  >
    <div data-testid="pref-sync-first-choice">
      <a-typography-paragraph>{{ $t("sync_first_desc") }}</a-typography-paragraph>
      <a-space direction="vertical" fill>
        <a-button
          long
          type="primary"
          data-testid="pref-sync-choice-merge"
          :loading="busy === 'choice'"
          @click="choose('merge')"
          >{{ $t("sync_first_merge") }}</a-button
        >
        <a-typography-text type="secondary">{{
          $t("sync_first_merge_hint")
        }}</a-typography-text>

        <a-popconfirm :content="$t('sync_first_cloud_confirm')" @ok="choose('cloud')">
          <a-button long data-testid="pref-sync-choice-cloud" :disabled="!!busy">{{
            $t("sync_first_cloud")
          }}</a-button>
        </a-popconfirm>
        <a-typography-text type="secondary">
          {{ $t("sync_first_cloud_hint") }}
          <a-link data-testid="pref-sync-backup" @click="emit('backup')">{{
            $t("sync_first_backup")
          }}</a-link>
        </a-typography-text>

        <a-popconfirm :content="$t('sync_first_upload_confirm')" @ok="choose('upload')">
          <a-button long data-testid="pref-sync-choice-upload" :disabled="!!busy">{{
            $t("sync_first_upload")
          }}</a-button>
        </a-popconfirm>
        <a-typography-text type="secondary">{{
          $t("sync_first_upload_hint")
        }}</a-typography-text>
      </a-space>
    </div>
  </a-modal>

  <a-modal
    v-model:visible="snapshotsVisible"
    :title="$t('sync_snapshots')"
    hide-cancel
  >
    <a-typography-paragraph type="secondary">{{
      $t("sync_snapshots_desc")
    }}</a-typography-paragraph>
    <a-empty v-if="snapshots.length === 0" />
    <a-list v-else size="small" data-testid="pref-sync-snapshot-list">
      <a-list-item v-for="s in snapshots" :key="s.id">
        <a-list-item-meta
          :title="new Date(s.createdAt).toLocaleString()"
          :description="$t('sync_snapshot_meta', [snapshotReason(s.reason), s.recordCount.toString()])"
        />
        <template #actions>
          <a-popconfirm :content="$t('sync_restore_confirm')" @ok="restore(s.id)">
            <a-button
              size="small"
              :data-testid="`pref-sync-restore-${s.id}`"
              :loading="busy === 'restore'"
              >{{ $t("sync_action_restore") }}</a-button
            >
          </a-popconfirm>
        </template>
      </a-list-item>
    </a-list>
  </a-modal>
</template>
