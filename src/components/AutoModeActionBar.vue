<script setup lang="ts">
import { type Tab } from "@/adapters/base";
import { ProfileAutoSwitch, ProxyProfile } from "@/services/profile";
import { type ResolvedProfile } from "@/services/proxy";
import { createRouteResolver } from "@/services/proxy/route";
import type { TabStatsResult } from "@/services/stats";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { parseWebURL } from "@/services/utils";

// loaded on demand, as it brings in the public suffix list
const ProfileSwitchChip = defineAsyncComponent(
  () => import("./controls/ProfileSwitchChip.vue")
);

const props = defineProps<{
  currentTab: Tab;
  activeProfile: ProxyProfile;
  stats?: TabStatsResult; // the tab's requests, telling the route of the page
}>();

const emit = defineEmits<{
  switched: [profile: ProfileAutoSwitch];
}>();

const current = ref<ResolvedProfile | undefined>();
const host = computed(() => parseWebURL(props.currentTab.url)?.hostname);

// the route the browser reported for the page, once it loaded. It only
// holds for the rules it was made under
const rulesChangedAt = ref(0);
const observed = computed(() => {
  const page = props.stats?.resources.find((r) => r.type === "main_frame");
  return page && page.ts >= rulesChangedAt.value ? page.observed : undefined;
});

watch(
  () => [
    props.currentTab.url,
    props.activeProfile,
    JSON.stringify(observed.value ?? null),
  ],
  async () => {
    const url = props.currentTab.url;
    current.value =
      host.value && url
        ? await (
            await createRouteResolver(props.activeProfile)
          )(url, observed.value)
        : undefined;
  },
  { immediate: true }
);

const onSwitched = (p: ProfileAutoSwitch) => {
  rulesChangedAt.value = Date.now();
  emit("switched", p);
};
</script>

<template>
  <div
    class="auto-mode-action"
    data-testid="auto-mode-action"
    v-if="host && current"
  >
    <a-alert type="info" banner :show-icon="false">
      <a-space :size="4" wrap>
        <a-typography-text class="detection-info">{{
          $t("mode_auto_switch_via")
        }}</a-typography-text>
        <profile-switch-chip
          :host="host"
          :tabID="currentTab.id"
          :profile="current.profile"
          :uncertain="current.uncertain"
          :activeProfileID="activeProfile.profileID"
          @switched="onSwitched"
        />
      </a-space>
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
