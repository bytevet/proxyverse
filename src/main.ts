import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { router } from "./router";
import { Host } from "./adapters";

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

app.use(router).mount("#app");
