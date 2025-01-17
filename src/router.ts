import {
  type RouteRecordRaw,
  createRouter,
  createWebHashHistory,
} from "vue-router";
import ProfileConfig from "./components/ProfileConfig.vue";
import ConfigPage from "./pages/ConfigPage.vue";
import PopupPage from "./pages/PopupPage.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: ConfigPage,
    name: "page.config",
    children: [
      { path: "", name: "profile.autoswitch", redirect: "profiles/new" },
      {
        path: "profiles/new",
        name: "profile.create",
        component: ProfileConfig,
        props: { profileID: undefined },
      },
      {
        path: "profiles/:id",
        name: "profile.custom",
        component: ProfileConfig,
        props: (route) => ({ profileID: route.params.id }),
      },

      // { path: 'preference', name: 'preference', component: HelloWorld },
      { path: "/:pathMatch(.*)*", name: "NotFound", redirect: "/" },
    ],
  },
  {
    path: "/popup",
    name: "page.popup",
    component: PopupPage,
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
