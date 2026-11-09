<script setup lang="ts">
import { IconDesktop, IconSafe, IconSwap } from "@arco-design/web-vue/es/icon";
import { ProxyProfile, SystemProfile, TRUE_PRIVACY_ID } from "@/services/profile";
import { useTruePrivacy } from "@/components/sync/useTruePrivacy";

// dropdown options shared by profile pickers; must be placed in `a-dropdown`
defineProps<{
  userProfiles: ProxyProfile[];
  disableSystem?: boolean;
}>();

// listed once the user turned it on
const { shown: truePrivacyShown } = useTruePrivacy();
</script>

<template>
  <a-dgroup :title="$t('nav_system_profiles')">
    <a-doption
      :data-testid="`profile-option-${SystemProfile.DIRECT.profileID}`"
      :value="SystemProfile.DIRECT.profileID"
      :style="{ '--indicator-color': SystemProfile.DIRECT.color }"
    >
      <template #icon><icon-swap /></template>
      {{ $t("mode_direct") }}
    </a-doption>
    <a-doption
      :data-testid="`profile-option-${SystemProfile.SYSTEM.profileID}`"
      :value="SystemProfile.SYSTEM.profileID"
      :disabled="disableSystem"
      :style="{ '--indicator-color': SystemProfile.SYSTEM.color }"
    >
      <template #icon><icon-desktop /></template>
      {{ $t("mode_system") }}
    </a-doption>
    <a-doption
      v-if="truePrivacyShown"
      :data-testid="`profile-option-${TRUE_PRIVACY_ID}`"
      :value="TRUE_PRIVACY_ID"
      :style="{ '--indicator-color': SystemProfile.TRUE_PRIVACY.color }"
    >
      <template #icon><icon-safe /></template>
      {{ $t("true_privacy_name") }}
    </a-doption>
  </a-dgroup>
  <a-dgroup :title="$t('nav_custom_profiles')">
    <a-doption
      v-for="item in userProfiles"
      :key="item.profileID"
      :data-testid="`profile-option-${item.profileID}`"
      :value="item.profileID"
      class="custom-profiles"
      :style="{ '--indicator-color': item.color }"
    >
      {{ item.profileName }}
      <template #icon>
        <span class="color-indicator"></span>
      </template>
    </a-doption>
  </a-dgroup>
</template>
