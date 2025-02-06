<script setup lang="ts">
import { Host } from "@/adapters";
import { config2json, json2config } from "@/services/config/schema";
import { listProfiles, saveProfile } from "@/services/profile";
import { useFileDialog } from "@vueuse/core";
import { Notification } from "@arco-design/web-vue";
import {
  IconSettings,
  IconDownload,
  IconImport,
} from "@arco-design/web-vue/es/icon";

// for import
const { open, reset, onChange } = useFileDialog({
  multiple: false,
  accept: "application/json",
  directory: false,
});

onChange(async (file) => {
  if (!file || file.length === 0) {
    return;
  }

  const profiles = json2config(await file[0].text());
  profiles.forEach(saveProfile);
  Notification.success({
    content: Host.getMessage(
      "preferences_feedback_n_profiles_being_imported",
      profiles.length.toString()
    ),
  });
  reset();
});

const exportProfiles = async () => {
  const profiles = await listProfiles();
  if (!profiles) {
    Notification.warning({
      content: Host.getMessage(
        "preferences_feedback_no_profile_to_be_exported"
      ),
    });
    return;
  }

  try {
    const jsonStr = config2json(profiles);

    // download
    const obj = new Blob([jsonStr], { type: "application/json" });
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
        $t("preferences_section_import_export")
      }}</a-divider>

      <a-typography-paragraph type="secondary">{{
        $t("preferences_section_import_export_desc")
      }}</a-typography-paragraph>

      <a-space>
        <a-button @click.prevent="exportProfiles">
          <template #icon>
            <icon-download />
          </template>
          {{ $t("preferences_action_profile_export") }}
        </a-button>

        <a-popconfirm
          :content="$t('preferences_tips_profile_overwrite')"
          @ok="open"
        >
          <a-button>
            <template #icon>
              <icon-import />
            </template>
            {{ $t("preferences_action_profile_import") }}
          </a-button>
        </a-popconfirm>
      </a-space>
    </section>
  </a-page-header>
</template>
