<script setup lang="ts">
import ThemeSwitcher from "../components/controls/ThemeSwitcher.vue";
import "@arco-design/web-vue/es/resize-box/style/index.css";
import {
  ProfilesStorage,
  listProfiles,
  onProfileUpdate,
} from "../services/profile";
import { onMounted, ref } from "vue";

const profiles = ref<ProfilesStorage>({});

onMounted(async () => {
  profiles.value = await listProfiles();
  onProfileUpdate((p) => (profiles.value = p));
});
</script>

<template>
  <a-layout class="config-layout">
    <a-layout-sider :resize-directions="['right']" class="sidebar">
      <div class="sidebar-container">
        <section class="logo">
          <img src="/full-logo.svg" />
        </section>

        <section class="settings">
          <a-button-group type="text" size="large">
            <a-tooltip
              :content="$t('nav_preference')"
              position="bottom"
              v-if="false"
            >
              <a-button @click="$router.push({ name: 'preference' })">
                <template #icon>
                  <icon-settings size="large" />
                </template>
              </a-button>
            </a-tooltip>
            <ThemeSwitcher size="large" />
          </a-button-group>
        </section>

        <section class="menu">
          <a-menu :selected-keys="[$route.path]">
            <RouterLink :to="{ name: 'profile.autoswitch' }" v-if="false">
              <a-menu-item
                :key="$router.resolve({ name: 'profile.autoswitch' }).path"
              >
                <template #icon><icon-relation /></template>
                {{ $t("mode_auto_switch") }}
              </a-menu-item>
            </RouterLink>

            <RouterLink
              v-for="(p, idx) in profiles"
              :to="{ name: 'profile.custom', params: { id: p.profileID } }"
              :key="idx"
            >
              <a-menu-item
                :key="
                  $router.resolve({
                    name: 'profile.custom',
                    params: { id: p.profileID },
                  }).path
                "
                class="custom-profiles"
                :style="{ '--indicator-color': p.color }"
              >
                <template #icon><span class="color-indicator"></span></template>
                {{ p.profileName }}
                <icon-edit class="icon-edit" />
              </a-menu-item>
            </RouterLink>

            <RouterLink :to="{ name: 'profile.create' }">
              <a-menu-item
                :key="$router.resolve({ name: 'profile.create' }).path"
              >
                <template #icon><icon-plus /></template>
                {{ $t("mode_profile_create") }}
              </a-menu-item>
            </RouterLink>
          </a-menu>
        </section>
      </div>
    </a-layout-sider>

    <a-layout class="content-wrapper">
      <a-layout-content>
        <RouterView :key="$route.fullPath" />
      </a-layout-content>
      <a-layout-footer>
        <a-typography-text type="secondary"
          >made by
          <a-link :hoverable="false" href="https://byte.vet">ByteVet</a-link>
          with ❤️</a-typography-text
        >
      </a-layout-footer>
    </a-layout>
  </a-layout>
</template>

<style scoped lang="scss">
.config-layout {
  background-color: var(--color-bg-1);

  .sidebar {
    background-color: var(--color-bg-3);

    width: 24em;
    min-width: 18em;
    max-width: 36em;
  }

  .content-wrapper {
    display: flex;
    flex-direction: column;
    min-height: 100vh;

    > .arco-layout-content {
      flex: 1;
    }

    > .arco-layout-footer {
      text-align: center;
      padding: 0.5em;
    }
  }
}

.sidebar-container {
  .logo {
    text-align: center;
    line-height: 64px;
    padding-bottom: 1em;

    img {
      vertical-align: middle;
      max-height: 48px;
    }
  }

  .settings {
    padding: 0.5em;
    text-align: center;
    border-top: var(--color-border-1) 1px solid;
    border-bottom: var(--color-border-1) 1px solid;

    .arco-btn {
      color: var(--color-text-2);
    }
  }
}

.custom-profiles {
  .color-indicator {
    display: inline-block;
    width: 1em;
    height: 1em;
    background-color: var(--indicator-color);

    border-radius: 0.5em;
    vertical-align: middle;
    box-shadow: 0px 1px 4px var(--color-border-3);
  }

  .icon-edit {
    display: none;
  }

  &:hover .icon-edit {
    display: inline-block;
  }
}
</style>
