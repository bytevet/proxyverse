import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { transify } from './models/i18n'

const app = createApp(App)

// i18n
declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $t: (key: string, substitutions?: any) => string;
  }
}
app.config.globalProperties.$t = transify

app.use(router).mount('#app')
