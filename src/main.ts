import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { router } from "./router";
import { Host } from "./adapters";

// Highlight.js
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import { initializePresetProfiles } from "./presets";
hljs.registerLanguage("javascript", javascript);

// i18n
declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $t: (key: string, substitutions?: any) => string;
  }
}

initializePresetProfiles().then(() => {
  const app = createApp(App);

  app.config.globalProperties.$t = Host.getMessage;

  app.use(router).mount("#app");
});
