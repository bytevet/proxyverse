<script setup lang="ts">
import { type RouteLocationRaw, useRouter } from 'vue-router';
import ThemeSwitcher from '../components/controls/ThemeSwitcher.vue';
import { ProfilesStorage, listProfiles } from '../models/profile';
import { onMounted, ref, toRaw } from 'vue';
import { type ProxyValue, setProxy, getCurrentProxySetting } from '../models/proxy';
import { Message } from '@arco-design/web-vue';
import { transify } from '../models/i18n';

const router = useRouter()
const profiles = ref<ProfilesStorage>({})
const selectedKeys = defineModel<string[]>()

onMounted(async () => {
  profiles.value = await listProfiles();
  const proxy = await getCurrentProxySetting()
  const curMode = proxy.setting.value?.mode
  switch (curMode) {
    case 'system':
    case 'direct':
      selectedKeys.value = [curMode]
      return
  }

  const profileID = proxy.activeProfile?.profileID
  if (profileID) {
    selectedKeys.value = [profileID]
  }
})

const jumpTo = (to: RouteLocationRaw) => {
  const path = router.resolve(to).fullPath
  window.open(`/#${path}`, import.meta.url)
  window.open(router.resolve(to).href, import.meta.url)
}

// actions
const setProxyByProfile = async (val: ProxyValue) => {
  try {
    console.log(toRaw(val))
    await setProxy(toRaw(val))
    selectedKeys.value = [typeof val == 'string' ? val : val.profileID]
  } catch (e: any) {
    Message.error({
      content: transify('config_feedback_error_occured', e.toString())
    })
  }
}
</script>

<template>
  <a-layout class="popup">
    <a-layout-header>
      <section class="logo">
        <img src="/full-logo.svg">
      </section>
    </a-layout-header>
    <a-layout-content class="profiles">
      <a-menu :selected-keys="selectedKeys">
        <a-menu-item key="direct" @click.prevent="() => setProxyByProfile('direct')"
          style="--indicator-color: rgb(var(--success-3))">
          <template #icon><icon-swap /></template>
          {{ $t("mode_direct") }}
        </a-menu-item>
        <a-menu-item key="system" @click.prevent="() => setProxyByProfile('system')"
          style="--indicator-color: var(--color-border-4)">
          <template #icon><icon-desktop /></template>
          {{ $t("mode_system") }}
        </a-menu-item>

        <a-divider>
          <a-space>
            <a-typography-text disabled style="white-space: nowrap;">{{ $t('nav_custome_profiles')
              }}</a-typography-text>

            <a-button type="secondary" shape="circle" size="mini" @click="jumpTo({ name: 'profile.create' })">
              <icon-plus />
            </a-button>
          </a-space>
        </a-divider>

        <a-menu-item key="mode_auto_switch" v-if="false">
          <template #icon><icon-relation /></template>
          {{ $t("mode_auto_switch") }}
        </a-menu-item>

        <a-menu-item v-for="(item, _) in profiles" :key="item.profileID" @click.prevent="() => setProxyByProfile(item)"
          class="custom-profiles" :style="{ '--indicator-color': item.color }">
          <template #icon><span class="color-indicator"></span></template>
          {{ item.profileName }}
        </a-menu-item>
      </a-menu>
    </a-layout-content>
    <a-layout-footer>
      <section class="settings">
        <a-button-group type="text" size="large">
          <a-button @click="jumpTo({ name: 'profile.autoswitch' })">
            <template #icon>
              <icon-tool size="medium" />
            </template>
            {{ $t('nav_config') }}
          </a-button>

          <a-divider direction="vertical" />

          <ThemeSwitcher size="large" />
        </a-button-group>
      </section>
    </a-layout-footer>
  </a-layout>
</template>

<style scoped lang="scss">
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
    padding: .5em .4em .4em;

    img {
      max-width: 100%;
      max-height: 2.6em;
    }
  }
}

.settings {
  padding: 0 .5em;
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

  :deep(.arco-menu-inner) {
    padding-left: 0;
    padding-right: 0;
  }

  :deep(.arco-menu-selected) {
    &::after {
      content: "";
      display: block;
      height: 100%;
      width: 4px;
      background-color: var(--indicator-color);

      position: absolute;
      left: 0;
      top: 0;
    }
  }
}

.custom-profiles {
  .color-indicator {
    display: inline-block;
    width: 1em;
    height: 1em;
    background-color: var(--indicator-color);

    border-radius: .5em;
    vertical-align: middle;
    box-shadow: 0px 1px 4px var(--color-border-3);
  }
}
</style>