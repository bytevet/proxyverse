<script setup lang="ts">
import { Host } from "@/adapters";
import {
  AutoSwitchType,
  AutoSwitchRule,
  ProxyConfigAutoSwitch,
  SystemProfile,
} from "@/services/profile";
import ProfileSelector from "./ProfileSelector.vue";

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
</script>

<template>
  <a-table
    :columns="columns"
    :data="config.rules"
    :pagination="false"
    @change="onDragged"
    :draggable="{ type: 'handle' }"
  >
    <template #type="{ record }: { record: AutoSwitchRule }">
      <a-select :options="autoSwitchTypes" v-model="record.type" />
    </template>

    <template #condition="{ record }: { record: AutoSwitchRule }">
      <a-input
        v-model="record.condition"
        :placeholder="getPlaceholder(record.type)"
        :disabled="record.type === 'disabled'"
      />
    </template>

    <template #profile="{ record }: { record: AutoSwitchRule }">
      <ProfileSelector
        v-model="record.profileID"
        :currentProfileID="props.currentProfileID"
        :disabled="record.type === 'disabled'"
      />
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
</template>

<style lang="scss">
.space-between {
  display: flex;
  justify-content: space-between;
}
</style>
