<script setup lang="ts">
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import hljsVuePlugin from "@highlightjs/vue-plugin";

const highlightjs = hljsVuePlugin.component;
hljs.registerLanguage("javascript", javascript);

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    minRows?: number;
  }>(),
  {
    placeholder: `function FindProxyForURL(url, host) {
  // …
}
`,
    minRows: 3,
  }
);

const model = defineModel<string>();
</script>

<template>
  <div class="wrapper">
    <div class="display">
      <highlightjs language="javascript" :code="model || ''" />
    </div>

    <a-textarea
      :placeholder="props.placeholder"
      class="editor"
      v-model="model"
      :auto-size="{ minRows: props.minRows }"
    />
  </div>
</template>

<style lang="scss" scoped>
@mixin unify-editor {
  box-sizing: border-box;
  font-size: 1em;
  line-height: 1.6em;
  font-family: monospace, monospace;
  padding: 1em;
  border: 1px solid transparent;

  outline: 0;

  overflow-wrap: break-word;
  text-wrap: wrap;
  white-space-collapse: break-spaces;
  white-space: break-spaces;
}

.wrapper {
  :deep(.display) {
    @import "highlight.js/scss/stackoverflow-light.scss";
  }

  body[arco-theme="dark"] & :deep(.display) {
    @import "highlight.js/scss/stackoverflow-dark.scss";
  }

  position: relative;
  flex: 1;

  .display {
    position: absolute;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
    border: 1px solid transparent;

    & > pre,
    :deep(.hljs) {
      box-sizing: border-box;
      display: block;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }

    :deep(.hljs) {
      @include unify-editor;
    }
  }

  .editor {
    background-color: transparent !important;

    :deep(.arco-textarea) {
      @include unify-editor;
      color: transparent;
      cursor: text;
      caret-color: var(--color-text-2);
    }
  }
}
</style>
