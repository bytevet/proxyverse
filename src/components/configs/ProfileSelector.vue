<script setup lang="ts">
import { listProfiles, ProxyProfile, SystemProfile } from "@/services/profile";
import { computed, onBeforeMount, ref } from "vue";

const props = defineProps<{
  currentProfileID?: string; // exclude current profile to avoid recursive selection
}>();

const profileID = defineModel<string>();
const userProfiles = ref<ProxyProfile[]>([]);
const systemProfiles = ref<ProxyProfile[]>([]);
const selectedProfile = computed<ProxyProfile | undefined>({
  get: () => {
    return (
      userProfiles.value.find(
        (profile) => profile.profileID == profileID.value
      ) ||
      systemProfiles.value.find(
        (profile) => profile.profileID == profileID.value
      )
    );
  },
  set: (value) => {
    profileID.value = value?.profileID;
  },
});

const handleSelect = (key: any) => {
  profileID.value = key;
};

const loadProfiles = async () => {
  systemProfiles.value = Object.values(SystemProfile);

  const profileCfg = await listProfiles();
  userProfiles.value = Object.values(profileCfg)
    .map((profile) => profile)
    .filter((profile) => profile.profileID !== props.currentProfileID);
};

onBeforeMount(() => {
  loadProfiles();
});
</script>

<template>
  <a-dropdown @select="handleSelect">
    <a-button>
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
      <a-dgroup :title="$t('nav_system_profiles')">
        <a-doption
          :value="SystemProfile.DIRECT.profileID"
          :style="{ '--indicator-color': SystemProfile.DIRECT.color }"
        >
          <template #icon><icon-swap /></template>
          {{ $t("mode_direct") }}
        </a-doption>
        <a-doption
          :value="SystemProfile.SYSTEM.profileID"
          :style="{ '--indicator-color': SystemProfile.SYSTEM.color }"
        >
          <template #icon><icon-desktop /></template>
          {{ $t("mode_system") }}
        </a-doption>
      </a-dgroup>
      <a-dgroup :title="$t('nav_custom_profiles')">
        <a-doption
          v-for="item in userProfiles"
          :key="item.profileID"
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
  </a-dropdown>
</template>
