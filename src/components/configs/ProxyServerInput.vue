<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { ProxyServer } from "../../services/profile";
import { Host } from "@/adapters";

const props = defineProps<{
  label: string;
  field: string;
  required?: boolean;
  allowDefault?: boolean;
}>();

const model = defineModel<ProxyServer>();

const optionDirect = "direct";
const optionDefault = Host.getMessage("config_proxy_type_default");
const options = [optionDirect, "http", "https", "socks4", "socks5"];

if (props.allowDefault) {
  options.unshift(optionDefault);
}

const proxyType = ref(model.value?.scheme || options[0]);
const proxyHost = ref(model.value?.host || "");
const proxyPort = ref(model.value?.port);

const proxyAuth = reactive({
  visible: false,
  username: "",
  password: "",
});

watch(model, (to) => {
  proxyType.value = to?.scheme || options[0];
  proxyHost.value = to?.host || "";
  proxyPort.value = to?.port;
});

watch(proxyType, (to) => {
  if (to == optionDefault) {
    model.value = undefined;
    return;
  }

  if (model.value == undefined) {
    model.value = {
      scheme: to as any,
      host: proxyHost.value,
    };
  } else {
    model.value.scheme = to as any;
  }
});

watch(
  () => proxyHost.value + proxyPort.value,
  () => {
    if (model.value) {
      Object.assign(model.value, {
        host: proxyHost.value,
        port: proxyPort.value,
      });
    }
  }
);

const onBeforeAuthModalOpen = () => {
  proxyAuth.username = model.value?.auth?.username || "";
  proxyAuth.password = model.value?.auth?.password || "";
};

const onSaveAuth = () => {
  proxyAuth.visible = false;

  if (!model.value) {
    return;
  }

  if (!proxyAuth.username && !proxyAuth.password) {
    model.value.auth = undefined;
  } else {
    model.value.auth = {
      username: proxyAuth.username,
      password: proxyAuth.password,
    };
  }

  return;
};

const onClearAuth = () => {
  proxyAuth.visible = false;
  if (model.value) {
    model.value.auth = undefined;
    proxyAuth.username = "";
    proxyAuth.password = "";
  }
  return;
};
</script>

<template>
  <a-form-item
    :field="props.field"
    :label="props.label"
    :required="props.required"
  >
    <a-space>
      <a-input-group>
        <a-select
          :options="options"
          :style="{ width: proxyType == optionDefault ? 'auto' : '7em' }"
          v-model="proxyType"
        />

        <template v-if="proxyType == optionDirect"></template>
        <template v-else-if="proxyType == optionDefault"></template>
        <template v-else>
          <a-input
            :style="{ width: '16em' }"
            placeholder="127.0.0.1"
            v-model="proxyHost"
            required
          >
            <template #prepend>://</template>
          </a-input>
          <a-input-number
            :style="{ width: '8em' }"
            v-model="proxyPort"
            hide-button
            :min="1"
            :max="65535"
          >
            <template #prepend>:</template>
          </a-input-number>
        </template>
      </a-input-group>

      <a-tooltip
        v-if="proxyType != optionDirect && proxyType != optionDefault"
        :content="$t('config_section_proxy_auth_tips')"
      >
        <a-button
          :type="model?.auth === undefined ? 'secondary' : 'primary'"
          :disabled="!['http', 'https', undefined].includes(model?.scheme)"
          @click="
            () => {
              proxyAuth.visible = true;
            }
          "
        >
          <template #icon>
            <icon-user />
          </template>
        </a-button>
      </a-tooltip>
    </a-space>
  </a-form-item>

  <a-modal
    v-model:visible="proxyAuth.visible"
    :title="$t('config_section_proxy_auth_title')"
    @before-open="onBeforeAuthModalOpen"
  >
    <a-form :model="proxyAuth">
      <a-form-item
        field="name"
        :label="$t('config_section_proxy_auth_username')"
      >
        <a-input v-model="proxyAuth.username" />
      </a-form-item>
      <a-form-item
        field="password"
        :label="$t('config_section_proxy_auth_password')"
      >
        <a-input-password v-model="proxyAuth.password" />
      </a-form-item>
    </a-form>

    <template #footer>
      <a-button type="text" status="danger" @click="onClearAuth">
        <template #icon>
          <icon-eraser />
        </template>
        {{ $t("config_action_clear") }}
      </a-button>
      <a-button type="primary" @click="onSaveAuth">
        <template #icon>
          <icon-save />
        </template>
        {{ $t("config_action_save") }}
      </a-button>
    </template>
  </a-modal>
</template>
