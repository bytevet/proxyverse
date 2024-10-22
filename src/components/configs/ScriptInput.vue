<script setup lang="ts">
import hljsVuePlugin from "@highlightjs/vue-plugin";
const highlightjs = hljsVuePlugin.component;

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
  <div class="script-editor-wrapper">
    <div class="script-display">
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

<style lang="scss">
@use "sass:meta";

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

.script-display {
  @include meta.load-css("highlight.js/scss/stackoverflow-light.scss");

  & > pre,
  .hljs {
    box-sizing: border-box;
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
  }

  .hljs {
    @include unify-editor;
  }
}

body[arco-theme="dark"] .script-display {
  @include meta.load-css("highlight.js/scss/stackoverflow-dark.scss");
}

.script-editor-wrapper {
  position: relative;
  flex: 1;

  .script-display {
    position: absolute;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    left: 0;
    top: 0;
    border: 1px solid transparent;
  }

  .editor {
    background-color: transparent !important;

    .arco-textarea {
      @include unify-editor;
      color: transparent;
      cursor: text;
      caret-color: var(--color-text-2);
    }
  }
}
</style>
