<script setup lang="ts">
import { type Tab } from "@/adapters/base";
import { ProfileAutoSwitch, ProxyProfile } from "@/services/profile";
import {
  createProfileFinder,
  type ResolvedProfile,
} from "@/services/proxy";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { parseWebURL } from "@/services/utils";

// loaded on demand, as it brings in the public suffix list
const ProfileSwitchChip = defineAsyncComponent(
  () => import("./controls/ProfileSwitchChip.vue")
);

const props = defineProps<{
  currentTab: Tab;
  activeProfile: ProxyProfile;
}>();

const emit = defineEmits<{
  switched: [profile: ProfileAutoSwitch];
}>();

const current = ref<ResolvedProfile | undefined>();
const host = computed(() => parseWebURL(props.currentTab.url)?.hostname);

watch(
  () => [props.currentTab.url, props.activeProfile],
  async () => {
    const url = props.currentTab.url;
    current.value =
      host.value && url
        ? await (await createProfileFinder(props.activeProfile))(url)
        : undefined;
  },
  { immediate: true }
);
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
          @switched="(p) => emit('switched', p)"
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
