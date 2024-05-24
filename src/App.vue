<script setup lang="ts">
import { onBeforeMount } from 'vue';
import { useLocale, addI18nMessages } from '@arco-design/web-vue/es/locale/';
import enUS from '@arco-design/web-vue/es/locale/lang/en-us';
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn';
import zhTW from '@arco-design/web-vue/es/locale/lang/zh-tw';
import ptPT from '@arco-design/web-vue/es/locale/lang/pt-pt';
import { getDarkModeSetting, changeDarkMode } from './models/preference';
import { ArcoLang } from '@arco-design/web-vue/es/locale/interface';

const i18nConfig: Record<string, ArcoLang> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'pt-PT': ptPT,
}

addI18nMessages(i18nConfig)
useLocale('en-US')

// Choose the most suitable lang
try {
  let lang = chrome.i18n.getUILanguage()
  if (i18nConfig[lang]) {
    useLocale(lang)
  } else {
    lang = lang.split('-', 1)[0]
    for (let locale in i18nConfig) {
      if (locale.startsWith(lang)) {
        useLocale(locale)
        break
      }
    }
  }
} catch (e) { console.warn(e) }

onBeforeMount(async () => changeDarkMode(await getDarkModeSetting()))
</script>

<template>
  <router-view />
</template>