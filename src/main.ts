import { createApp } from "vue";
import "./style.css";
import "@arco-design/web-vue/es/message/style/css.js";
import "@arco-design/web-vue/es/notification/style/css.js";

import App from "./App.vue";
import { router } from "./router";
import { Host } from "./adapters";
import { applyStoredDarkMode } from "./services/preference";
import { applyStoredLanguage } from "./services/i18n";

// Highlight.js
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
hljs.registerLanguage("javascript", javascript);

const app = createApp(App);

// i18n
declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $t: (key: string, substitutions?: any) => string;
  }
}
app.config.globalProperties.$t = Host.getMessage;

// mount once the theme and language are applied, so the app never renders
// in the wrong ones
Promise.allSettled([applyStoredDarkMode(), applyStoredLanguage()]).then(() =>
  app.use(router).mount("#app")
);
