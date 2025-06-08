<script setup lang="ts">
import { IconCopy, IconPlus, IconDelete } from "@arco-design/web-vue/es/icon";
import type { FieldRule } from "@arco-design/web-vue";

import { Host } from "@/adapters";
import {
  AutoSwitchType,
  AutoSwitchRule,
  ProxyConfigAutoSwitch,
  SystemProfile,
} from "@/services/profile";
import ProfileSelector from "./ProfileSelector.vue";
import { BrowserFlavor } from "@/adapters/base";
import { isValidCIDR } from "ipaddr.js";

const props = defineProps<{
  currentProfileID?: string;
}>();

const config = defineModel<ProxyConfigAutoSwitch>({ required: true });

const getPlaceholder = (type: AutoSwitchType) => {
  switch (type) {
    case "domain":
      return "*.example.com";
    case "url":
      return "http://example.com/api/*";
    case "cidr":
      return "192.168.1.1/24";
    default:
      return "";
  }
};

const newRule = (record?: AutoSwitchRule) => {
  if (record) {
    config.value.rules.push(Object.assign({}, record));
    return;
  }

  config.value.rules.push({
    type: "domain",
    condition: "",
    profileID: SystemProfile.DIRECT.profileID,
  });
};

const deleteRule = (index: number) => {
  config.value.rules = config.value.rules.filter((_, i) => i !== index);
};

const onDragged = (rules: any) => {
  config.value.rules = rules;
};

const autoSwitchTypes: { label: string; value: AutoSwitchType }[] = [
  {
    label: Host.getMessage("config_section_auto_switch_type_domain"),
    value: "domain",
  },
  {
    label: Host.getMessage("config_section_auto_switch_type_url"),
    value: "url",
  },
  {
    label: Host.getMessage("config_section_auto_switch_type_cidr"),
    value: "cidr",
  },
  {
    label: Host.getMessage("config_section_auto_switch_type_disabled"),
    value: "disabled",
  },
];

const columns = [
  {
    title: Host.getMessage("config_section_auto_switch_type"),
    dataIndex: "type",
    slotName: "type",
  },
  {
    title: Host.getMessage("config_section_auto_switch_condition"),
    dataIndex: "condition",
    slotName: "condition",
  },
  {
    title: Host.getMessage("config_section_auto_switch_profile"),
    dataIndex: "profileID",
    slotName: "profile",
  },
  {
    title: Host.getMessage("config_section_auto_switch_actions"),
    slotName: "actions",
  },
];

const getConditionInputRule = (type: AutoSwitchType): FieldRule<string> => {
  switch (type) {
    case "disabled":
      return {};

    case "url":
      return {
        validator: async (value: string, cb: (message?: string) => void) => {
          console.log("test");
          let u;
          try {
            u = new URL(value || "");
          } catch (e) {
            cb(
              Host.getMessage("config_section_auto_switch_type_url_malformed")
            );
            return;
          }

          if (
            Host.flavor === BrowserFlavor.Chrome ||
            Host.flavor === BrowserFlavor.Web
          ) {
            if (u.protocol === "https:" && !["", "/"].includes(u.pathname)) {
              cb(
                Host.getMessage(
                  "config_section_auto_switch_type_url_malformed_chrome"
                )
              );
              return;
            }
          }

          cb();
        },
      };

    case "cidr":
      return {
        required: true,
        validator: (value: string, cb: (message?: string) => void) => {
          if (!value || !isValidCIDR(value)) {
            cb(
              Host.getMessage("config_section_auto_switch_type_cidr_malformed")
            );
            return;
          }

          cb();
        },
      };

    default:
      return {
        required: true,
      };
  }
};
</script>

<template>
  <form layout="vertical" class="auto-switch-form" :model="config">
    <a-table
      :columns="columns"
      :data="config.rules"
      :pagination="false"
      @change="onDragged"
      :draggable="{ type: 'handle' }"
    >
      <template
        #type="{
          record,
          rowIndex,
        }: {
          record: AutoSwitchRule,
          rowIndex: number,
        }"
      >
        <a-form-item hide-label :field="`rules[${rowIndex}].type`">
          <a-select
            :options="autoSwitchTypes"
            v-model="record.type as string"
          />
        </a-form-item>
      </template>

      <template
        #condition="{
          record,
          rowIndex,
        }: {
          record: AutoSwitchRule,
          rowIndex: number,
        }"
      >
        <a-form-item
          hide-label
          :field="`rules[${rowIndex}].condition`"
          :rules="getConditionInputRule(record.type)"
          validate-trigger="blur"
        >
          <a-input
            v-model="record.condition"
            :placeholder="getPlaceholder(record.type)"
            :disabled="record.type === 'disabled'"
          />
        </a-form-item>
      </template>

      <template
        #profile="{
          record,
          rowIndex,
        }: {
          record: AutoSwitchRule,
          rowIndex: number,
        }"
      >
        <a-form-item hide-label :field="`rules[${rowIndex}].profileID`">
          <ProfileSelector
            v-model="record.profileID"
            :currentProfileID="props.currentProfileID"
            :disabled="record.type === 'disabled'"
          />
        </a-form-item>
      </template>

      <template
        #actions="{
          record,
          rowIndex,
        }: {
          record: AutoSwitchRule,
          rowIndex: number,
        }"
      >
        <a-space>
          <a-tooltip :content="$t('config_section_auto_switch_delete_rule')">
            <a-button
              type="outline"
              shape="circle"
              status="danger"
              @click="() => deleteRule(rowIndex)"
            >
              <icon-delete />
            </a-button>
          </a-tooltip>
          <a-tooltip :content="$t('config_section_auto_switch_duplicate_rule')">
            <a-button
              type="outline"
              shape="circle"
              @click="() => newRule(record)"
            >
              <icon-copy />
            </a-button>
          </a-tooltip>
        </a-space>
      </template>

      <template #footer>
        <div class="space-between">
          <a-button @click="() => newRule()" size="small">
            <template #icon>
              <icon-plus />
            </template>
            {{ Host.getMessage("config_section_auto_switch_add_rule") }}
          </a-button>

          <a-space>
            <a-typography-text>
              {{
                Host.getMessage("config_section_auto_switch_default_profile")
              }}</a-typography-text
            >
            <ProfileSelector
              v-model="config.defaultProfileID"
              :currentProfileID="props.currentProfileID"
            />
          </a-space>
        </div>
      </template>
    </a-table>
  </form>
</template>

<style lang="scss">
.space-between {
  display: flex;
  justify-content: space-between;
}

.auto-switch-form {
  .arco-form-item {
    margin-bottom: 0;
  }
}
</style>
