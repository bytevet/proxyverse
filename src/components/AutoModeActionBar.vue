<script setup lang="ts">
import { type Tab } from "@/adapters/base";
import { ProfileAutoSwitch, ProxyProfile } from "@/services/profile";
import { type ResolvedProfile } from "@/services/proxy";
import { createRouteResolver, currentFacts } from "@/services/proxy/route";
import type { TabStatsResult } from "@/services/stats";
import { computed, defineAsyncComponent, ref, shallowRef, watch } from "vue";
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

// what the browser reported about the page's route, once it loaded
const rulesChangedAt = ref(0);
const facts = computed(() => {
  const page = props.stats?.resources.find((r) => r.type === "main_frame");
  return page && currentFacts(page, rulesChangedAt.value);
});

const resolver = shallowRef<Awaited<ReturnType<typeof createRouteResolver>>>();
watch(
  () => props.activeProfile,
  async (active) => (resolver.value = await createRouteResolver(active)),
  { immediate: true }
);

watch(
  [() => props.currentTab.url, resolver, facts],
  async ([url, resolve, facts]) => {
    current.value =
      host.value && url && resolve ? await resolve(url, facts) : undefined;
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
