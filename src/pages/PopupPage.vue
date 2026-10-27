<script setup lang="ts">
import { type RouteLocationRaw, useRoute, useRouter } from "vue-router";
import { Message } from "@arco-design/web-vue";
import { computed, onMounted, onUnmounted, ref, toRaw } from "vue";
import {
  IconDesktop,
  IconSwap,
  IconRelation,
  IconPlus,
  IconTool,
} from "@arco-design/web-vue/es/icon";
import ThemeSwitcher from "../components/controls/ThemeSwitcher.vue";
import {
  ProfilesStorage,
  listProfiles,
  SystemProfile,
  ProxyProfile,
  onProfileUpdate,
} from "../services/profile";
import {
  setProxy,
  getCurrentProxySetting,
  onActiveProfileChanged,
} from "../services/proxy";
import { Host } from "@/adapters";
import { type Tab } from "@/adapters/base";
import AutoModeActionBar from "@/components/AutoModeActionBar.vue";
import FailedResourcesAlert from "@/components/FailedResourcesAlert.vue";
import {
  acknowledgeTabStats,
  subscribeTabStats,
  type TabStatsResult,
} from "@/services/stats";

const props = defineProps<{
  // in the side panel / sidebar: stays open, so it follows the active tab
  // and the profiles changed elsewhere
  sidebar?: boolean;
}>();

const router = useRouter();
const route = useRoute();
const profiles = ref<ProfilesStorage>({});
const currentTab = ref<Tab | undefined>();
const activeProfile = ref<ProxyProfile | undefined>();
const tabStats = ref<TabStatsResult | undefined>();
let unsubscribeTabStats: (() => void) | undefined;
const unsubscribes: (() => void)[] = [];

const selectedKeys = computed(() => {
  return activeProfile.value?.profileID ? [activeProfile.value.profileID] : [];
});

const loadActiveProfile = async () => {
  activeProfile.value = (await getCurrentProxySetting()).activeProfile;
};

/** Show `tab`: its route, rule actions and failed requests. */
const showTab = (tab: Tab | undefined) => {
  unsubscribeTabStats?.();
  unsubscribeTabStats = undefined;
  tabStats.value = undefined;
  currentTab.value = tab;
  if (tab?.id === undefined) return;

  // the user sees the failures here, so the badge can stop signaling them
  acknowledgeTabStats(tab.id);
  unsubscribeTabStats = subscribeTabStats(
    tab.id,
    (stats) => (tabStats.value = stats)
  );
};

onMounted(async () => {
  profiles.value = await listProfiles();
  await loadActiveProfile();

  // `?tabID=` makes the popup act on a given tab, used by e2e tests
  const tabID = Number(route.query.tabID);
  showTab(tabID ? await Host.getTab(tabID) : await Host.getActiveTab());

  if (props.sidebar) {
    // keep only the latest lookup when tabs switch in quick succession
    let lookup = 0;
    const showActiveTab = async () => {
      const n = ++lookup;
      const tab = await Host.getActiveTab();
      if (n === lookup) showTab(tab);
    };
    unsubscribes.push(
      Host.onActiveTabChanged(showActiveTab),
      onProfileUpdate((p) => {
        profiles.value = p;
        // the active profile may route to the changed ones
        loadActiveProfile();
      }),
      onActiveProfileChanged(loadActiveProfile)
    );
  }
});

onUnmounted(() => {
  unsubscribeTabStats?.();
  unsubscribes.forEach((unsubscribe) => unsubscribe());
});

const jumpTo = (to: RouteLocationRaw) => {
  const path = router.resolve(to).fullPath;
  window.open(`/index.html#${path}`, "_blank");
};

// open the active custom profile for editing, or the config home otherwise
const openConfig = () => {
  const profileID = activeProfile.value?.profileID;
  if (profileID && profiles.value[profileID]) {
    jumpTo({ name: "profile.custom", params: { id: profileID } });
  } else {
    jumpTo({ name: "profile.home" });
  }
};

// actions
const setProxyByProfile = async (val: ProxyProfile) => {
  try {
    await setProxy(toRaw(val));
    activeProfile.value = toRaw(val);
  } catch (e: any) {
    Message.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  }
};
</script>

<template>
  <a-layout class="popup">
    <a-layout-header>
      <section class="logo">
        <img src="/full-logo.svg" />
      </section>
    </a-layout-header>
    <a-layout-content class="profiles">
      <a-menu :selected-keys="selectedKeys">
        <a-menu-item
          :key="SystemProfile.DIRECT.profileID"
          data-testid="popup-profile-direct"
          @click.prevent="setProxyByProfile(SystemProfile.DIRECT)"
          :style="{ '--indicator-color': SystemProfile.DIRECT.color }"
        >
          <template #icon><icon-swap /></template>
          {{ $t("mode_direct") }}
        </a-menu-item>
        <a-menu-item
          :key="SystemProfile.SYSTEM.profileID"
          data-testid="popup-profile-system"
          @click.prevent="setProxyByProfile(SystemProfile.SYSTEM)"
          :style="{ '--indicator-color': SystemProfile.SYSTEM.color }"
        >
          <template #icon><icon-desktop /></template>
          {{ $t("mode_system") }}
        </a-menu-item>

        <a-divider>
          <a-space>
            <a-typography-text disabled style="white-space: nowrap">{{
              $t("nav_custom_profiles")
            }}</a-typography-text>

            <a-button
              type="secondary"
              shape="circle"
              size="mini"
              data-testid="popup-create"
              @click="jumpTo({ name: 'profile.create' })"
            >
              <icon-plus />
            </a-button>
          </a-space>
        </a-divider>

        <a-menu-item key="mode_auto_switch" v-if="false">
          <template #icon><icon-relation /></template>
          {{ $t("mode_auto_switch") }}
        </a-menu-item>

        <a-menu-item
          v-for="(item, _) in profiles"
          :key="item.profileID"
          :data-testid="`popup-profile-${item.profileID}`"
          @click.prevent="() => setProxyByProfile(item)"
          class="custom-profiles"
          :style="{ '--indicator-color': item.color }"
        >
          <template #icon><span class="color-indicator"></span></template>
          <a-space fill class="profile-name">
            <span>{{ item.profileName }}</span>
            <a-tag size="small" color="gray" v-if="item.proxyType == 'auto'">
              {{ $t("mode_auto_switch_abbr") }}
            </a-tag>
          </a-space>
        </a-menu-item>
      </a-menu>
    </a-layout-content>
    <a-layout-footer>
      <auto-mode-action-bar
        v-if="currentTab?.url && activeProfile?.proxyType == 'auto'"
        :current-tab="currentTab"
        :active-profile="activeProfile"
        :stats="tabStats"
        @switched="(p) => (activeProfile = p)"
      />
      <failed-resources-alert v-if="tabStats" :stats="tabStats" />
      <section class="settings">
        <a-button-group type="text" size="large">
          <a-button data-testid="popup-config" @click="openConfig">
            <template #icon>
              <icon-tool size="medium" />
            </template>
            {{ $t("nav_config") }}
          </a-button>

          <a-divider direction="vertical" />

          <ThemeSwitcher size="large" />
        </a-button-group>
      </section>
    </a-layout-footer>
  </a-layout>
</template>

<style lang="scss">
.popup {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 100vh;

  align-items: stretch;
  background-color: var(--color-bg-3);

  .logo {
    text-align: center;
    border-bottom: var(--color-border-1) 1px solid;
    background-color: var(--color-bg-4);
    padding: 0.5em 0.4em 0.4em;

    img {
      max-width: 100%;
      max-height: 2.6em;
    }
  }

  .settings {
    padding: 0 0.5em;
    text-align: center;
    border-top: var(--color-border-1) 1px solid;
    background-color: var(--color-bg-5);

    .arco-btn {
      color: var(--color-text-2);
    }
  }

  .profiles {
    --indicator-color: rgb(var(--primary-5));
    overflow-y: auto;

    .arco-menu-inner {
      padding-left: 0;
      padding-right: 0;
    }

    .arco-menu-selected {
      &::after {
        content: "";
        display: block;
        height: 100%;
        width: 4px;
        background-color: var(--indicator-color);

        position: absolute;
        inset-inline-start: 0;
        top: 0;
      }
    }

    .profile-name {
      justify-content: space-between;
    }
  }
}
</style>
