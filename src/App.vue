<script setup lang="ts">
import { onBeforeMount } from 'vue';
import { useLocale, addI18nMessages } from '@arco-design/web-vue/es/locale/';
import enUS from '@arco-design/web-vue/es/locale/lang/en-us';
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn';
import { getDarkModeSetting, changeDarkMode } from './models/preference';

addI18nMessages({
  'en-US': enUS,
  'zh-CN': zhCN,
})
useLocale('en-US')

onBeforeMount(async () => changeDarkMode(await getDarkModeSetting()))
</script>

<template>
  <router-view />
</template>