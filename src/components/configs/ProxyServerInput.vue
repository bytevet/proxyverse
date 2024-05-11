<script setup lang="ts">
import { ref, watch } from 'vue';
import { transify } from '../../models/i18n';
import { ProxyServer } from '../../models/profile';

const props = defineProps<{
  label: string,
  field: string,
  required?: boolean,
  allowDefault?: boolean
}>()

const model = defineModel<ProxyServer>()

const optionDirect = 'direct'
const optionDefault = transify('config_proxy_type_default')
const options = [optionDirect, 'http', 'https', 'socks4', 'socks5']

if (props.allowDefault) {
  options.unshift(optionDefault)
}

const proxyType = ref(model.value?.scheme || options[0])
const proxyHost = ref(model.value?.host || '')
const proxyPort = ref(model.value?.port)

watch(model, to=>{
  proxyType.value = to?.scheme|| options[0]
  proxyHost.value = to?.host|| ''
  proxyPort.value = to?.port
})

watch(proxyType, (to) => {
  if (to == optionDefault) {
    model.value = undefined
    return
  }

  if (model.value == undefined) {
    model.value = {
      scheme: to as any,
      host: proxyHost.value,
    }
  } else {
    model.value.scheme = to as any
  }
})

watch(
  () => proxyHost.value + proxyPort.value,
  () => {
    if (model.value) {
      Object.assign(model.value, {
        host: proxyHost.value,
        port: proxyPort.value,
      })
    }
  }
)
</script>

<template>
  <a-form-item :field="props.field" :label="props.label" :required="props.required">
    <a-input-group>
      <a-select :options="options" :style="{ width: proxyType == optionDefault ? 'auto' : '7em' }"
        v-model="proxyType" />

      <template v-if="proxyType == optionDirect"></template>
      <template v-else-if="proxyType == optionDefault"></template>
      <template v-else>
        <a-input :style="{ width: '16em' }" placeholder="127.0.0.1" v-model="proxyHost" required>
          <template #prepend>://</template>
        </a-input>
        <a-input-number :style="{ width: '8em' }" v-model="proxyPort" hide-button :min="1" :max="65535">
          <template #prepend>:</template>
        </a-input-number>
      </template>
    </a-input-group>
  </a-form-item>
</template>