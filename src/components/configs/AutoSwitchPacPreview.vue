<script setup lang="ts">
import { ProfileAuthSwitch } from "@/services/profile";
import { useClipboard, watchDebounced } from "@vueuse/core";
import { ref } from "vue";
import { previewAutoSwitchPac } from "@/services/proxy";

import hljsVuePlugin from "@highlightjs/vue-plugin";
const highlightjs = hljsVuePlugin.component;

const profile = defineModel<ProfileAuthSwitch>({ required: true });

const pacScript = ref<string>("");
const loading = ref(false);

const { copy, copied } = useClipboard({ source: pacScript });

const updatePacScript = async () => {
  loading.value = true;
  try {
    pacScript.value = await previewAutoSwitchPac(profile.value);
  } catch (e) {
    console.error(e);
  }
  loading.value = false;
};

watchDebounced(profile, updatePacScript, {
  debounce: 500,
  maxWait: 1000,
  immediate: true,
  deep: true,
});
</script>

<template>
  <a-collapse :bordered="true">
    <a-collapse-item
      :header="$t('config_section_auto_switch_pac_preview')"
      class="pac-preview-wrapper"
      key="pac-script"
    >
      <template #extra>
        <a-button size="small" @click.stop="copy(pacScript)">
          <span v-if="copied">{{ $t("config_feedback_copied") }}</span>
          <icon-copy v-else />
        </a-button>
      </template>
      <highlightjs
        :loading="loading"
        language="javascript"
        :code="pacScript"
        class="script-display"
      />
    </a-collapse-item>
  </a-collapse>
</template>

<style lang="scss">
.pac-preview-wrapper {
  .arco-collapse-item-content,
  .arco-collapse-item-content-box {
    padding: 0;
  }

  .script-display {
    margin: 0;
    font-size: 0.8em;

    code.hljs {
      padding: 1em !important;
    }
  }
}
</style>
