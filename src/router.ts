import {
  type RouteRecordRaw,
  createRouter,
  createWebHashHistory,
} from "vue-router";
import ProfileConfig from "./components/ProfileConfig.vue";
import ConfigPage from "./pages/ConfigPage.vue";
import PopupPage from "./pages/PopupPage.vue";
import PreferencePage from "./components/PreferencePage.vue";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: ConfigPage,
    name: "page.config",
    children: [
      { path: "", name: "profile.home", redirect: "profiles/new" },
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

      { path: "preference", name: "preference", component: PreferencePage },
      { path: "/:pathMatch(.*)*", name: "NotFound", redirect: "/" },
    ],
  },
  {
    path: "/popup",
    name: "page.popup",
    component: PopupPage,
  },
  {
    // the popup in the browser's side panel / sidebar, following the active tab
    path: "/sidebar",
    name: "page.sidebar",
    component: PopupPage,
    props: { sidebar: true },
  },
  {
    path: "/popup/resources/:tabID",
    name: "popup.resources",
    component: () => import("./pages/ResourcesPage.vue"),
    props: true,
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
