<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  DarkMode,
  changeDarkMode,
  getDarkModeSetting,
  currentDarkMode,
} from "../../services/preference";

const props = defineProps<{
  size?: "mini" | "small" | "medium" | "large";
}>();

const darkmode = ref<DarkMode>(DarkMode.Dark);

onMounted(async () => {
  darkmode.value = await getDarkModeSetting();
});

const onDarkModeChanged = (newMode: DarkMode) => {
  changeDarkMode(newMode);
  darkmode.value = newMode;
};

const toggleDarkMode = async () => {
  console.log(await currentDarkMode());
  switch (await currentDarkMode()) {
    case DarkMode.Dark:
      onDarkModeChanged(DarkMode.Light);
      break;

    default:
      onDarkModeChanged(DarkMode.Dark);
      break;
  }
};
</script>

<template>
  <a-dropdown trigger="hover" @select="onDarkModeChanged as any">
    <a-button
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
      <a-doption :value="DarkMode.Light">
        <template #icon>
          <icon-sun-fill />
        </template>
        {{ $t("theme_light_mode") }}
      </a-doption>
      <a-doption :value="DarkMode.Dark">
        <template #icon>
          <icon-moon-fill />
        </template>
        {{ $t("theme_dark_mode") }}
      </a-doption>
      <a-doption :value="DarkMode.Default">
        <template #icon>
          <icon-bg-colors />
        </template>
        {{ $t("theme_auto_mode") }}
      </a-doption>
    </template>
  </a-dropdown>
</template>
