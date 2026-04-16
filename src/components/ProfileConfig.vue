<script setup lang="ts">
import {
  computed,
  reactive,
  ref,
  toRaw,
  useTemplateRef,
  watch,
  watchEffect,
} from "vue";
import { colors } from "@arco-design/web-vue/es/color-picker/colors";
import { IconUndo, IconSave, IconDelete } from "@arco-design/web-vue/es/icon";
import { FieldRule, Notification } from "@arco-design/web-vue";
import { useRouter } from "vue-router";
import ProxyServerInput from "./configs/ProxyServerInput.vue";
import AutoSwitchInput from "./configs/AutoSwitchInput.vue";
import AutoSwitchPacPreview from "./configs/AutoSwitchPacPreview.vue";
import ScriptInput from "./configs/ScriptInput.vue";
import {
  DEFAULT_PAC_REFRESH_MINUTES,
  PAC_REFRESH_INTERVAL_OPTIONS,
  PacScriptConfig,
  ProfileAutoSwitch,
  ProfileSimple,
  ProxyServer,
  SystemProfile,
  deleteProfile,
  getProfile,
  saveProfile,
} from "@/services/profile";
import { Host } from "@/adapters";
import { fetchPacScript } from "@/services/proxy/pacFetcher";
import { refreshProxy } from "@/services/proxy";

const router = useRouter();
const props = defineProps<{
  profileID?: string;
}>();

const chooseRandomColor = () => {
  const idx = Math.floor(Math.random() * colors.length);
  return colors[idx];
};

type ConfigState = (ProfileSimple | ProfileAutoSwitch) & {
  [key: string]: any;
};

// forms
const profileConfig = reactive<ConfigState>({
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
    sourceURL: "",
    refreshIntervalMinutes: undefined,
    lastFetched: undefined,
    lastError: undefined,
  },

  // auto switch part
  rules: [
    {
      type: "domain",
      condition: "example.com",
      profileID: SystemProfile.DIRECT.profileID,
    },
    {
      type: "url",
      condition: "http://example.com/api/*",
      profileID: SystemProfile.DIRECT.profileID,
    },
  ],
  defaultProfileID: SystemProfile.DIRECT.profileID,
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
    if (profileConfig.proxyType != "proxy" || !val) {
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
    validator(
      value: ProxyServer | undefined,
      callback: (message?: string) => void
    ) {
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
): FieldRule<PacScriptConfig | undefined> => {
  return {
    type: "object",
    required: required,
    validator(
      value: PacScriptConfig | undefined,
      callback: (message?: string) => void
    ) {
      if (value == undefined) {
        return;
      }

      if (value.sourceURL?.trim()) {
        return;
      }

      if (!value.data?.trim()) {
        callback(Host.getMessage("form_is_required", readable_name));
      }
    },
  };
};

const pacSourceURLFieldRule = (
  readable_name: string
): FieldRule<string | undefined> => {
  return {
    type: "string",
    validator(
      value: string | undefined,
      callback: (message?: string) => void
    ) {
      const trimmed = value?.trim();
      if (!trimmed) {
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        callback(Host.getMessage("form_invalid_url", readable_name));
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        callback(Host.getMessage("form_invalid_url", readable_name));
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

    // need to overwrite the current proxy settings
    await refreshProxy();

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

const pacFetching = ref(false);

const formatLastFetched = (ts?: number) => {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
};

const pacIntervalOptions = computed(() =>
  PAC_REFRESH_INTERVAL_OPTIONS.map((minutes) => ({
    value: minutes,
    label: pacIntervalLabel(minutes),
  }))
);

function pacIntervalLabel(minutes: number): string {
  if (minutes === 0) {
    return Host.getMessage("config_pac_refresh_interval_disabled");
  }
  if (minutes < 60) {
    return Host.getMessage(
      "config_pac_refresh_interval_minutes",
      String(minutes)
    );
  }
  if (minutes === 60) {
    return Host.getMessage("config_pac_refresh_interval_one_hour");
  }
  if (minutes === 1440) {
    return Host.getMessage("config_pac_refresh_interval_one_day");
  }
  const hours = minutes / 60;
  return Host.getMessage("config_pac_refresh_interval_hours", String(hours));
}

const pacRefreshIntervalModel = computed<number>({
  get() {
    if (profileConfig.proxyType !== "pac") return DEFAULT_PAC_REFRESH_MINUTES;
    const v = profileConfig.pacScript.refreshIntervalMinutes;
    return v === undefined ? DEFAULT_PAC_REFRESH_MINUTES : v;
  },
  set(val: number) {
    if (profileConfig.proxyType !== "pac") return;
    profileConfig.pacScript.refreshIntervalMinutes = val;
  },
});

const fetchPacNow = async () => {
  if (profileConfig.proxyType !== "pac") return;
  const url = profileConfig.pacScript.sourceURL?.trim();
  if (!url) return;

  pacFetching.value = true;
  try {
    const body = await fetchPacScript(url);
    profileConfig.pacScript.data = body;
    profileConfig.pacScript.lastFetched = Date.now();
    profileConfig.pacScript.lastError = undefined;
    Notification.success({
      content: Host.getMessage("config_feedback_pac_fetched"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    profileConfig.pacScript.lastError = message;
    Notification.error({
      content: Host.getMessage("config_feedback_pac_fetch_failed", message),
    });
  } finally {
    pacFetching.value = false;
  }
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

watchEffect(async () => {
  if (props.profileID) {
    await loadProfile(props.profileID);
  }
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
          :label="$t('config_section_pac_url')"
          field="pacScript.sourceURL"
          :validate-trigger="['blur']"
          :rules="pacSourceURLFieldRule($t('config_section_pac_url'))"
        >
          <template #extra>
            <a-space direction="vertical" size="mini">
              <a-typography-text>
                {{ $t("config_section_pac_url_hint") }}
              </a-typography-text>
              <a-typography-text
                v-if="profileConfig.pacScript.lastFetched"
                type="secondary"
              >
                {{
                  $t(
                    "config_pac_last_fetched",
                    formatLastFetched(profileConfig.pacScript.lastFetched)
                  )
                }}
              </a-typography-text>
              <a-typography-text
                v-if="profileConfig.pacScript.lastError"
                type="danger"
              >
                {{
                  $t("config_pac_last_error", profileConfig.pacScript.lastError)
                }}
              </a-typography-text>
            </a-space>
          </template>
          <a-input-group>
            <a-input
              v-model="profileConfig.pacScript.sourceURL"
              :placeholder="$t('config_section_pac_url_placeholder')"
              allow-clear
            />
            <a-button
              type="primary"
              :loading="pacFetching"
              :disabled="!profileConfig.pacScript.sourceURL?.trim()"
              @click="fetchPacNow"
            >
              {{ $t("config_action_pac_fetch") }}
            </a-button>
          </a-input-group>
        </a-form-item>

        <a-form-item
          v-if="profileConfig.pacScript.sourceURL?.trim()"
          :label="$t('config_section_pac_refresh_interval')"
          field="pacScript.refreshIntervalMinutes"
        >
          <template #extra>
            <div>{{ $t("config_section_pac_refresh_interval_hint") }}</div>
          </template>
          <a-select
            v-model="pacRefreshIntervalModel"
            :options="pacIntervalOptions"
            style="max-width: 240px"
          />
        </a-form-item>

        <a-alert
          v-if="profileConfig.pacScript.sourceURL?.trim()"
          type="warning"
          :show-icon="true"
          style="margin-bottom: 16px"
        >
          {{ $t("config_pac_manual_edit_warning") }}
        </a-alert>

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

        <a-space direction="vertical">
          <AutoSwitchInput
            :currentProfileID="profileConfig.profileID"
            v-model="profileConfig"
          />

          <AutoSwitchPacPreview
            v-if="profileConfig.proxyType == 'auto'"
            :profile="(profileConfig as ProfileAutoSwitch)"
          />
        </a-space>
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
