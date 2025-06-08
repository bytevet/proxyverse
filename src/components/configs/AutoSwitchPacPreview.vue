<script setup lang="ts">
import { IconCopy } from "@arco-design/web-vue/es/icon";
import { ProfileAutoSwitch } from "@/services/profile";
import { useClipboard, watchDebounced } from "@vueuse/core";
import { ref } from "vue";
import { previewAutoSwitchPac } from "@/services/proxy";

import hljsVuePlugin from "@highlightjs/vue-plugin";
const highlightjs = hljsVuePlugin.component;

const { profile } = defineProps<{
  profile: ProfileAutoSwitch;
}>();

const pacScript = ref<string>("");
const loading = ref(false);

const { copy, copied } = useClipboard({ source: pacScript });

const updatePacScript = async () => {
  loading.value = true;
  try {
    pacScript.value = await previewAutoSwitchPac(profile);
  } catch (e) {
    console.error(e);
  }
  loading.value = false;
};

watchDebounced(() => profile, updatePacScript, {
  immediate: true,
  deep: true,
  debounce: 500,
  maxWait: 1000,
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
