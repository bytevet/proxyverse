<script setup lang="ts">
import {
  IconDesktop,
  IconSwap,
  IconExclamationPolygonFill,
  IconDown,
} from "@arco-design/web-vue/es/icon";
import { ProxyProfile } from "@/services/profile";
import { computed } from "vue";
import ProfileOptions from "./ProfileOptions.vue";
import { useProfileOptions } from "./useProfileOptions";

// attrs (e.g. data-testid) go to the trigger button
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  currentProfileID?: string; // exclude current profile to avoid recursive selection
  disabled?: boolean;
}>();

const profileID = defineModel<string>({
  required: true,
});

const { userProfiles, findProfileByID } = useProfileOptions(
  () => props.currentProfileID
);
const selectedProfile = computed<ProxyProfile | undefined>(() =>
  findProfileByID(profileID.value)
);

const handleSelect = (key: any) => {
  profileID.value = key;
};
</script>

<template>
  <a-dropdown @select="handleSelect">
    <a-button v-bind="$attrs" :disabled="disabled">
      <!-- current profile indicator -->
      <a-space
        v-if="selectedProfile"
        class="custom-profiles"
        :style="{ '--indicator-color': selectedProfile.color }"
      >
        <template v-if="selectedProfile.proxyType == 'system'">
          <icon-desktop />
          <span>{{ $t("mode_system") }}</span>
        </template>
        <template v-else-if="selectedProfile.proxyType == 'direct'">
          <icon-swap />
          <span>{{ $t("mode_direct") }}</span>
        </template>
        <template v-else>
          <span class="color-indicator"></span>
          {{ selectedProfile.profileName }}
        </template>
      </a-space>

      <!-- something wrong -->
      <a-space v-else>
        <icon-exclamation-polygon-fill />
        <a-typography-text type="warning" delete>{{
          $t("config_feedback_unknown_profile")
        }}</a-typography-text>
      </a-space>
      <a-divider direction="vertical" />
      <icon-down />
    </a-button>

    <!-- dropdown -->
    <template #content>
      <profile-options
        :user-profiles="userProfiles"
        :disable-system="!!props.currentProfileID"
      />
    </template>
  </a-dropdown>
</template>
