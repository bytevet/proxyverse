<script setup lang="ts">
import { h, onBeforeMount, onMounted } from "vue";
import { Modal } from "@arco-design/web-vue";
import { useLocale, addI18nMessages } from "@arco-design/web-vue/es/locale";
import enUS from "@arco-design/web-vue/es/locale/lang/en-us";
import zhCN from "@arco-design/web-vue/es/locale/lang/zh-cn";
import zhTW from "@arco-design/web-vue/es/locale/lang/zh-tw";
import ptPT from "@arco-design/web-vue/es/locale/lang/pt-pt";
import { getDarkModeSetting, changeDarkMode } from "./services/preference";
import type { ArcoLang } from "@arco-design/web-vue/es/locale/interface";
import { Host } from "./adapters";
import { useRoute } from "vue-router";

const route = useRoute();
const i18nConfig: Record<string, ArcoLang> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "pt-PT": ptPT,
};

addI18nMessages(i18nConfig);
useLocale("en-US");

// Choose the most suitable lang
try {
  let lang = Host.currentLocale();
  if (i18nConfig[lang]) {
    useLocale(lang);
  } else {
    lang = lang.split("-", 1)[0];
    for (let locale in i18nConfig) {
      if (locale.startsWith(lang)) {
        useLocale(locale);
        break;
      }
    }
  }
} catch (e) {
  console.warn(e);
}

onBeforeMount(async () => changeDarkMode(await getDarkModeSetting()));
onMounted(async () => {
  const err = await Host.error();
  if (err) {
    Modal.error({
      title: Host.getMessage("feedback_error"),
      content: () => h("div", { innerHTML: err }),
      width: "auto",
      fullscreen: route.name === "page.popup",
    });
  }
});
</script>

<template>
  <router-view />
</template>
