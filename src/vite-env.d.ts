/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
}

import { RouteLocationNormalizedLoaded, Router } from "vue-router";
declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $router: Router;
    $route: RouteLocationNormalizedLoaded;
  }
}
