<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  reactive,
  ref,
  toRaw,
  useTemplateRef,
  watch,
} from "vue";
import { colors } from "@arco-design/web-vue/es/color-picker/colors";
import ProxyServerInput from "./configs/ProxyServerInput.vue";
import AutoSwitchInput from "./configs/AutoSwitchInput.vue";
import ScriptInput from "./configs/ScriptInput.vue";
import {
  ProxyConfigAutoSwitch,
  ProxyConfigMeta,
  ProxyConfigSimple,
  ProxyServer,
  deleteProfile,
  getProfile,
  saveProfile,
} from "../services/profile";
import { FieldRule, Notification } from "@arco-design/web-vue";
import { useRouter } from "vue-router";
import { Host, PacScript } from "@/adapters";

const router = useRouter();
const props = defineProps<{
  profileID?: string;
}>();

const chooseRandomColor = () => {
  const idx = Math.floor(Math.random() * colors.length);
  return colors[idx];
};

// forms
const profileConfig = reactive<
  ProxyConfigMeta & ProxyConfigSimple & ProxyConfigAutoSwitch
>({
  profileID: props.profileID || crypto.randomUUID(),
  color: chooseRandomColor(),
  profileName: props.profileID ? "" : "Custom Profile",

  proxyType: "proxy",

  // simple proxy part
  proxyRules: {
    default: {
      host: "127.0.0.1",
      scheme: "http",
      port: 8080,
    },

    bypassList: ["<local>", "127.0.0.1", "[::1]"],
  },

  // pac part
  pacScript: {
    data: `function FindProxyForURL(url, host) {
  // …
  return 'DIRECT';
}`,
  },

  // auto switch part
  rules: [],
  defaultProfileID: "system",
});

const showAdvanceConfig = ref(false);
const newProfileMode = !props.profileID;
const editing = ref(newProfileMode);
let profileFirstLoaded = false;

watch(
  profileConfig,
  () => {
    if (profileFirstLoaded) {
      profileFirstLoaded = false;
      editing.value = false;
      return;
    }
    editing.value = true;
  },
  { immediate: true }
);

const bypassList = computed({
  get: () => {
    if (profileConfig.proxyType != "proxy") {
      return "";
    }

    return profileConfig.proxyRules.bypassList.join("\n");
  },

  set: (val) => {
    if (profileConfig.proxyType != "proxy") {
      return;
    }
    profileConfig.proxyRules.bypassList = val
      .split("\n")
      .map((host) => host.trim());
  },
});

const refForm = useTemplateRef("profile-form");

// form validators
const proxyServerFieldRule = (
  readable_name: string,
  required?: boolean
): FieldRule<ProxyServer | undefined> => {
  return {
    type: "object",
    required: required,
    validator(value, callback) {
      console.log(value);
      if (value == undefined || value.scheme == "direct") {
        return;
      }

      if (!value.host) {
        callback(Host.getMessage("form_is_required", readable_name));
      }
    },
  };
};

const pacScriptFieldRule = (
  readable_name: string,
  required?: boolean
): FieldRule<PacScript | undefined> => {
  return {
    type: "object",
    required: required,
    validator(value, callback) {
      if (value == undefined) {
        return;
      }

      if (!value.data?.trim()) {
        callback(Host.getMessage("form_is_required", readable_name));
      }
    },
  };
};

// actions
const saveProfileEvent = async () => {
  const validationResult = await refForm.value?.validate();

  if (validationResult) {
    // display 1st error message
    for (let key in validationResult) {
      Notification.error({
        content: validationResult[key].message,
      });
      return;
    }
  }

  try {
    await saveProfile(toRaw(profileConfig));
    Notification.success({
      content: Host.getMessage("config_feedback_saved"),
    });

    if (newProfileMode) {
      router.replace({
        name: "profile.custom",
        params: { id: profileConfig.profileID },
      });
      return;
    }
    editing.value = false;
  } catch (e: any) {
    Notification.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  }
};

const deleteProfileEvent = async () => {
  try {
    await deleteProfile(profileConfig.profileID);
    Notification.success({
      content: Host.getMessage("config_feedback_deleted"),
    });

    router.replace({ name: "preference" });
  } catch (e: any) {
    Notification.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  }
};

const discardEditEvent = () => {
  props.profileID && loadProfile(props.profileID);
};

// load data
const loadProfile = async (profileID: string) => {
  const profile = await getProfile(profileID);

  if (!profile) {
    // TODO: data not found
    return;
  }

  profileFirstLoaded = true;
  Object.assign(profileConfig, profile);
  if (
    profileConfig.proxyType == "proxy" &&
    (profileConfig.proxyRules.ftp ||
      profileConfig.proxyRules.http ||
      profileConfig.proxyRules.https)
  ) {
    showAdvanceConfig.value = true;
  }
};

onBeforeMount(() => {
  props.profileID && loadProfile(props.profileID);
});
</script>

<template>
  <a-page-header
    :show-back="false"
    :style="{ background: 'var(--color-bg-2)' }"
  >
    <template #title>
      <a-space class="profile-name">
        <a-color-picker
          v-model="profileConfig.color"
          disabledAlpha
          showPreset
          format="hex"
        />
        <a-typography-text
          editable
          :defaultEditing="newProfileMode"
          v-model:editText="profileConfig.profileName"
          >{{ profileConfig.profileName }}</a-typography-text
        >
      </a-space>
    </template>
    <template #extra>
      <!-- action buttons -->
      <a-space>
        <a-button v-if="editing && !newProfileMode" @click="discardEditEvent">
          <template #icon>
            <icon-undo />
          </template>
          {{ $t("config_action_cancel") }}
        </a-button>
        <a-button
          type="primary"
          @click="saveProfileEvent"
          v-if="editing || newProfileMode"
        >
          <template #icon>
            <icon-save />
          </template>
          {{ $t("config_action_save") }}
        </a-button>
        <a-popconfirm
          v-if="!newProfileMode"
          :ok-text="$t('config_action_delete')"
          type="warning"
          @ok="deleteProfileEvent"
          :ok-button-props="{ status: 'danger' }"
          :content="$t('config_action_delete_double_confirm')"
        >
          <a-button type="primary" status="danger">
            <template #icon>
              <icon-delete />
            </template>
            {{ $t("config_action_delete") }}
          </a-button>
        </a-popconfirm>
      </a-space>
    </template>

    <a-form :model="profileConfig" autoLabelWidth ref="profile-form">
      <a-form-item field="proxyType" :label="$t('config_proxy_type')" required>
        <a-radio-group type="button" v-model="profileConfig.proxyType">
          <a-radio value="proxy">{{ $t("config_proxy_type_proxy") }}</a-radio>
          <a-radio value="pac">{{ $t("config_proxy_type_pac") }}</a-radio>
          <a-radio value="auto">{{ $t("config_proxy_type_auto") }}</a-radio>
        </a-radio-group>
      </a-form-item>

      <template v-if="profileConfig.proxyType == 'proxy'">
        <a-divider orientation="left">{{
          $t("config_section_proxy_server")
        }}</a-divider>

        <ProxyServerInput
          field="proxyRules.default"
          v-model="profileConfig.proxyRules.default"
          :label="$t('config_section_proxy_server_default')"
          :validate-trigger="['change', 'blur']"
          required
          :rules="
            proxyServerFieldRule(
              $t('config_section_proxy_server_default'),
              true
            )
          "
        />

        <a-form-item field="configAdvanceMode">
          <a-checkbox v-model="showAdvanceConfig">{{
            $t("config_section_advance")
          }}</a-checkbox>
        </a-form-item>
        <template v-if="showAdvanceConfig">
          <ProxyServerInput
            field="proxyRules.http"
            v-model="profileConfig.proxyRules.http"
            :label="$t('config_section_proxy_server_http')"
            allow-default
            :validate-trigger="['change', 'blur']"
            :rules="
              proxyServerFieldRule($t('config_section_proxy_server_http'))
            "
          />

          <ProxyServerInput
            field="proxyRules.https"
            v-model="profileConfig.proxyRules.https"
            :label="$t('config_section_proxy_server_https')"
            allow-default
            :validate-trigger="['change', 'blur']"
            :rules="
              proxyServerFieldRule($t('config_section_proxy_server_https'))
            "
          />

          <ProxyServerInput
            field="proxyRules.ftp"
            v-model="profileConfig.proxyRules.ftp"
            :label="$t('config_section_proxy_server_ftp')"
            allow-default
            :validate-trigger="['change', 'blur']"
            :rules="proxyServerFieldRule($t('config_section_proxy_server_ftp'))"
          />
        </template>

        <a-divider orientation="left">{{
          $t("config_section_bypass_list")
        }}</a-divider>
        <a-form-item :label="$t('config_section_bypass_list')">
          <template #extra>
            <a-link
              icon
              target="_blank"
              referrerpolicy="no-referrer"
              href="https://developer.chrome.com/docs/extensions/reference/api/proxy#bypass_list"
            >
              {{ $t("config_reference_bypass_list") }}
            </a-link>
          </template>
          <a-textarea
            v-model="bypassList"
            :autoSize="{
              minRows: 2,
            }"
          />
        </a-form-item>
      </template>
      <template v-else-if="profileConfig.proxyType == 'pac'">
        <a-form-item
          :label="$t('config_proxy_type_pac')"
          field="pacScript"
          :validate-trigger="['blur']"
          :rules="pacScriptFieldRule($t('config_proxy_type_pac'), true)"
          required
        >
          <ScriptInput v-model="profileConfig.pacScript.data" :min-rows="4" />
        </a-form-item>
      </template>

      <!-- Auto Switch Mode -->
      <template v-else>
        <a-divider orientation="left">{{
          $t("config_section_auto_switch_rules")
        }}</a-divider>

        <AutoSwitchInput :currentProfileID="profileConfig.profileID" />
      </template>
    </a-form>
  </a-page-header>
</template>

<style lang="scss">
.profile-name {
  .arco-typography-edit-content {
    margin: 0 0.5em;

    .arco-input {
      font-size: 18px;
    }
  }
}
</style>
