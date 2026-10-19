<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { Host } from "@/adapters";
import type { ImportWarning } from "@/services/config";
import { listProfiles, saveManyProfiles } from "@/services/profile";
import { DarkMode, useDarkMode } from "@/services/preference";
import {
  type ActionBehavior,
  getActionBehavior,
  onActionBehaviorChanged,
  setActionBehavior,
} from "@/services/ui";
import { useFileDialog } from "@vueuse/core";
import { Notification } from "@arco-design/web-vue";
import {
  IconSettings,
  IconDownload,
  IconImport,
  IconSunFill,
  IconMoonFill,
  IconBgColors,
} from "@arco-design/web-vue/es/icon";

// interface
const darkMode = useDarkMode();
const sidebarSupported = Host.sidebarSupported();
const actionBehavior = ref<ActionBehavior>("popup");
let unsubscribeActionBehavior: (() => void) | undefined;
onMounted(async () => {
  actionBehavior.value = await getActionBehavior();
  unsubscribeActionBehavior = onActionBehaviorChanged(
    (b) => (actionBehavior.value = b)
  );
});
onUnmounted(() => unsubscribeActionBehavior?.());

const changeActionBehavior = async (behavior: ActionBehavior) => {
  actionBehavior.value = behavior;
  await setActionBehavior(behavior);
};

// loaded on use, keeping the importers out of the popup's bundle
const config = () => import("@/services/config");

// for import: Proxyverse exports and SwitchyOmega / ZeroOmega backups
const { open, reset, onChange } = useFileDialog({
  multiple: false,
  accept: "application/json,.json,.bak,.txt",
  directory: false,
});

// the warnings of the last import, shown until dismissed
const importWarnings = shallowRef<ImportWarning[]>([]);

// warnings shown per profile, the rest summed up
const WARNINGS_SHOWN_PER_PROFILE = 20;
const groupedImportWarnings = computed(() => {
  const groups = new Map<string, ImportWarning[]>();
  for (const w of importWarnings.value) {
    groups.set(w.profileName, [...(groups.get(w.profileName) ?? []), w]);
  }
  return [...groups].map(([profileName, warnings]) => ({
    profileName,
    messages: warnings
      .slice(0, WARNINGS_SHOWN_PER_PROFILE)
      .map((w) => Host.getMessage(w.key, w.args)),
    more: Math.max(0, warnings.length - WARNINGS_SHOWN_PER_PROFILE),
  }));
});

onChange(async (file) => {
  if (!file || file.length === 0) {
    return;
  }

  try {
    const { importConfig } = await config();
    const result = await importConfig(await file[0].text(), await listProfiles());
    await saveManyProfiles(result.profiles);
    Notification.success({
      content: Host.getMessage(
        "preferences_feedback_n_profiles_being_imported",
        result.profiles.length.toString()
      ),
    });

    importWarnings.value = result.warnings;
  } catch (e: any) {
    Notification.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  } finally {
    // allow choosing the same file again
    reset();
  }
});

const exportProfiles = async () => {
  const { exportConfig } = await config();
  const { json, count, skipped } = exportConfig(await listProfiles());
  if (count === 0) {
    Notification.warning({
      content: Host.getMessage(
        "preferences_feedback_no_profile_to_be_exported"
      ),
    });
    return;
  }

  if (skipped.length > 0) {
    Notification.warning({
      content: Host.getMessage(
        "preferences_feedback_profiles_not_exported",
        skipped.join(", ")
      ),
    });
  }

  try {
    // download
    const obj = new Blob([json], { type: "application/json" });
    const fileURL = URL.createObjectURL(obj);

    const downloadLink = document.createElement("a");
    downloadLink.href = fileURL;
    downloadLink.download = "proxyverse.json";
    document.body.appendChild(downloadLink);
    downloadLink.click();

    // cleanup
    URL.revokeObjectURL(fileURL);
    document.body.removeChild(downloadLink);
  } catch (e: any) {
    Notification.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  }
};
</script>

<template>
  <a-page-header
    :show-back="false"
    :style="{ background: 'var(--color-bg-2)' }"
  >
    <template #title>
      <a-space>
        <icon-settings />
        <span>{{ $t("nav_preference") }}</span>
      </a-space>
    </template>

    <section>
      <a-divider orientation="left">{{
        $t("preferences_section_interface")
      }}</a-divider>

      <a-form :model="{}" auto-label-width>
        <a-form-item :label="$t('preferences_theme')">
          <a-radio-group
            type="button"
            :model-value="darkMode.setting.value"
            @change="(v) => darkMode.change(v as DarkMode)"
          >
            <a-radio :value="DarkMode.Light" data-testid="pref-theme-light">
              <icon-sun-fill /> {{ $t("theme_light_mode") }}
            </a-radio>
            <a-radio :value="DarkMode.Dark" data-testid="pref-theme-dark">
              <icon-moon-fill /> {{ $t("theme_dark_mode") }}
            </a-radio>
            <a-radio :value="DarkMode.Default" data-testid="pref-theme-auto">
              <icon-bg-colors /> {{ $t("theme_auto_mode") }}
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item
          :label="$t('preferences_action_behavior')"
          :extra="
            sidebarSupported
              ? $t('preferences_action_behavior_hint')
              : $t('preferences_action_behavior_sidebar_unsupported')
          "
        >
          <a-radio-group
            type="button"
            :model-value="actionBehavior"
            @change="(v) => changeActionBehavior(v as ActionBehavior)"
          >
            <a-radio value="popup" data-testid="pref-action-popup">
              {{ $t("preferences_action_behavior_popup") }}
            </a-radio>
            <a-radio
              value="sidebar"
              data-testid="pref-action-sidebar"
              :disabled="!sidebarSupported"
            >
              {{ $t("preferences_action_behavior_sidebar") }}
            </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </section>

    <section>
      <a-divider orientation="left">{{
        $t("preferences_section_import_export")
      }}</a-divider>

      <a-typography-paragraph type="secondary">{{
        $t("preferences_section_import_export_desc")
      }}</a-typography-paragraph>

      <a-typography-paragraph
        type="secondary"
        data-testid="import-switchyomega-note"
      >
        <a-tag color="orangered" size="small">{{
          $t("preferences_tag_beta")
        }}</a-tag>
        {{ $t("preferences_section_import_switchyomega") }}
      </a-typography-paragraph>

      <a-space>
        <a-button data-testid="export-profiles" @click.prevent="exportProfiles">
          <template #icon>
            <icon-download />
          </template>
          {{ $t("preferences_action_profile_export") }}
        </a-button>

        <a-popconfirm
          :content="$t('preferences_tips_profile_overwrite')"
          @ok="open"
        >
          <a-button data-testid="import-profiles">
            <template #icon>
              <icon-import />
            </template>
            {{ $t("preferences_action_profile_import") }}
          </a-button>
        </a-popconfirm>
      </a-space>
    </section>
  </a-page-header>

  <a-modal
    :visible="importWarnings.length > 0"
    @update:visible="(v: boolean) => v || (importWarnings = [])"
    :title="$t('preferences_import_warnings_title')"
    hide-cancel
  >
    <div class="import-warnings" data-testid="import-warnings">
      <a-typography-paragraph type="secondary">{{
        $t("preferences_import_warnings_desc")
      }}</a-typography-paragraph>
      <section v-for="group in groupedImportWarnings" :key="group.profileName">
        <a-typography-text bold>{{
          group.profileName
        }}</a-typography-text>
        <ul>
          <li v-for="(message, i) in group.messages" :key="i">
            {{ message }}
          </li>
          <li v-if="group.more > 0">
            {{ $t("preferences_import_warnings_more", group.more.toString()) }}
          </li>
        </ul>
      </section>
    </div>
  </a-modal>
</template>

<style scoped>
.import-warnings {
  max-height: 60vh;
  overflow-y: auto;
  word-break: break-all;
}
</style>
