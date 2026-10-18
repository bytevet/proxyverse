<script setup lang="ts">
import {
  IconDesktop,
  IconSwap,
  IconDown,
  IconQuestionCircle,
} from "@arco-design/web-vue/es/icon";
import { computed, ref } from "vue";
import { ProfileAutoSwitch, ProxyProfile } from "@/services/profile";
import { siteDomain, type RuleScope } from "@/services/proxy/ruleEditor";
import ProfileOptions from "../configs/ProfileOptions.vue";
import { useProfileOptions } from "../configs/useProfileOptions";
import { switchHostWithFeedback } from "./hostSwitch";

// shows the profile used for `host`, and routes it to another one on select
const props = defineProps<{
  host: string;
  tabID?: number; // the tab to offer reloading after switching
  profile?: ProxyProfile; // the profile currently in use
  uncertain?: boolean; // the detection may not be accurate
  activeProfileID: string; // the active auto switch profile
}>();

const emit = defineEmits<{
  switched: [profile: ProfileAutoSwitch];
}>();

const { userProfiles } = useProfileOptions(() => props.activeProfileID);
const switching = ref(false);

// what the picked profile applies to: the host, or its whole site
const scope = ref<RuleScope>("host");
const domain = computed(() => siteDomain(props.host));

const onVisibleChange = (visible: boolean) => {
  if (visible) scope.value = "host";
};

const onSelect = async (profileID: string) => {
  switching.value = true;
  try {
    const updated = await switchHostWithFeedback(
      props.host,
      profileID,
      props.tabID,
      scope.value
    );
    updated && emit("switched", updated);
  } finally {
    switching.value = false;
  }
};
</script>

<template>
  <a-dropdown
    trigger="click"
    @select="(key) => onSelect(`${key}`)"
    @popup-visible-change="onVisibleChange"
  >
    <a-button
      size="mini"
      data-testid="switch-chip"
      class="profile-switch-chip custom-profiles"
      :class="{ uncertain }"
      :loading="switching"
      :style="{ '--indicator-color': profile?.color }"
    >
      <a-space :size="4">
        <template v-if="profile?.proxyType == 'direct'">
          <icon-swap />
          <span>{{ $t("mode_direct") }}</span>
        </template>
        <template v-else-if="profile?.proxyType == 'system'">
          <icon-desktop />
          <span>{{ $t("mode_system") }}</span>
        </template>
        <template v-else-if="profile">
          <span class="color-indicator"></span>
          <span class="profile-name">{{ profile.profileName }}</span>
        </template>
        <span v-else>{{ $t("config_feedback_unknown_profile") }}</span>

        <a-tooltip v-if="uncertain" :content="$t('mode_auto_switch_uncertain')">
          <icon-question-circle data-testid="switch-chip-uncertain" />
        </a-tooltip>
        <icon-down />
      </a-space>
    </a-button>

    <template #content>
      <div v-if="domain" class="switch-scope" @click.stop>
        <a-radio-group v-model="scope" type="button" size="mini">
          <a-radio value="host" data-testid="switch-scope-host">
            {{ $t("mode_auto_switch_scope_host") }}
          </a-radio>
          <a-radio value="site" data-testid="switch-scope-site">
            *.{{ domain }}
          </a-radio>
        </a-radio-group>
      </div>
      <profile-options :user-profiles="userProfiles" disable-system />
    </template>
  </a-dropdown>
</template>

<style lang="scss">
.profile-switch-chip {
  max-width: 12em;

  .profile-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.uncertain .arco-space-item:not(:last-child) {
    opacity: 0.6;
  }
}

.switch-scope {
  padding: 4px 8px 8px;
  border-bottom: 1px solid var(--color-border-1);
  margin-bottom: 4px;
}
</style>
