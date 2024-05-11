import { type RouteRecordRaw, createRouter, createWebHashHistory } from "vue-router";
import HelloWorld from "./components/HelloWorld.vue";
import ProfileConfig from "./components/ProfileConfig.vue";
import ConfigPage from "./pages/ConfigPage.vue";
import PopupPage from "./pages/PopupPage.vue";


const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: ConfigPage,
    children: [
      { path: '', name: 'profile.autoswitch', redirect: 'profiles/new' },
      { path: 'profiles/new', name: 'profile.create', component: ProfileConfig, props: {profileID: undefined} },
      { path: 'profiles/:id', name: 'profile.custom', component: ProfileConfig, props: route => ({ profileID: route.params.id }) },

      { path: 'preference', name: 'preference', component: HelloWorld },
      { path: '/:pathMatch(.*)*', name: 'NotFound', redirect: '/' }
    ]
  },
  {
    path: '/popup',
    component: PopupPage,
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})