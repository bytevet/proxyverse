<script setup lang="ts">
import { type Tab } from "@/adapters/base";
import { ProxyProfile } from "@/services/profile";
import { queryStats, type TabStatsResult } from "@/services/stats";
import { ref, watch } from "vue";
import { IconInfoCircle } from "@arco-design/web-vue/es/icon";

const props = defineProps<{
  currentTab: Tab;
  activeProfile: ProxyProfile;
}>();

const tabStats = ref<TabStatsResult | undefined>();

const loadTabStats = async () => {
  if (!props.currentTab.id) {
    return;
  }
  const stats = await queryStats(props.currentTab.id);
  tabStats.value = stats;

  // mocking
  //   tabStats.value = {
  //     failedRequests: [],
  //     currentProfile: {
  //       profile: {
  //         profileID: "profile1",
  //         profileName: "Profile 1",
  //         proxyType: "proxy",
  //         color: "#000000",
  //         proxyRules: {
  //           default: {
  //             host: "127.0.0.1",
  //             port: 8080,
  //           },
  //           bypassList: [],
  //         },
  //       },
  //       isConfident: true,
  //     },
  //     tabID: props.currentTab.id,
  //   };
  //   console.log(tabStats.value);
};

watch(props.currentTab, loadTabStats, { immediate: true });
</script>

<template>
  <div class="auto-mode-action">
    <a-alert
      v-if="tabStats?.currentProfile?.profile"
      type="info"
      banner
      class="custom-profiles"
      :style="{ '--indicator-color': tabStats.currentProfile?.profile?.color }"
    >
      <template #icon><span class="color-indicator"></span></template>
      <a-typography-text class="detection-info">{{
        $t("mode_auto_switch_detection_info", [
          tabStats.currentProfile?.profile?.profileName,
        ])
      }}</a-typography-text>
      <template #action>
        <a-tooltip :content="$t('mode_auto_switch_detection_tips')">
          <a-typography-text type="secondary">
            <icon-info-circle />
          </a-typography-text>
        </a-tooltip>
      </template>
    </a-alert>
  </div>
</template>

<style lang="scss">
.auto-mode-action {
  .detection-info {
    font-size: 0.9em;
  }
}
</style>
