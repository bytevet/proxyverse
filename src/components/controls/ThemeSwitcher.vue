<script setup lang="ts">
import {
  IconSunFill,
  IconMoonFill,
  IconBgColors,
} from "@arco-design/web-vue/es/icon";
import { DarkMode, useDarkMode } from "../../services/preference";

const props = defineProps<{
  size?: "mini" | "small" | "medium" | "large";
}>();

const { setting: darkmode, shown, change } = useDarkMode();

const toggleDarkMode = () =>
  change(shown() == DarkMode.Dark ? DarkMode.Light : DarkMode.Dark);
</script>

<template>
  <a-dropdown trigger="hover" @select="change as any">
    <a-button
      data-testid="theme-switch"
      type="text"
      status="normal"
      style="color: var(--color-text-2)"
      @click="toggleDarkMode"
      :size="props.size"
    >
      <template #icon>
        <icon-sun-fill v-if="darkmode == DarkMode.Light" :size="props.size" />
        <icon-moon-fill
          v-else-if="darkmode == DarkMode.Dark"
          :size="props.size"
        />
        <icon-bg-colors v-else :size="props.size" />
      </template>
    </a-button>

    <template #content>
      <a-doption :value="DarkMode.Light" data-testid="theme-option-light">
        <template #icon>
          <icon-sun-fill />
        </template>
        {{ $t("theme_light_mode") }}
      </a-doption>
      <a-doption :value="DarkMode.Dark" data-testid="theme-option-dark">
        <template #icon>
          <icon-moon-fill />
        </template>
        {{ $t("theme_dark_mode") }}
      </a-doption>
      <a-doption :value="DarkMode.Default" data-testid="theme-option-auto">
        <template #icon>
          <icon-bg-colors />
        </template>
        {{ $t("theme_auto_mode") }}
      </a-doption>
    </template>
  </a-dropdown>
</template>
