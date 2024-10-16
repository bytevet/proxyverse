<script setup lang="ts">
import { Host } from "@/adapters";
import {
  AutoSwitchType,
  AutoSwitchRule,
  ProxyConfigAutoSwitch,
  SystemProfile,
} from "@/services/profile";
import { reactive, ref } from "vue";

const props = defineProps<{}>();

const config = ref<ProxyConfigAutoSwitch>({
  rules: [
    {
      type: "domain",
      condition: "example.com",
      profileID: SystemProfile.SYSTEM.profileID,
    },
  ],
  defaultProfileID: SystemProfile.SYSTEM.profileID,
});

const newRule = (record?: AutoSwitchRule) => {
  if (record) {
    config.value.rules.push(Object.assign({}, record));
    return;
  }

  config.value.rules.push({
    type: "domain",
    condition: "*.example.com",
    profileID: SystemProfile.DIRECT.profileID,
  });
};

const deleteRule = (index: number) => {
  config.value.rules = config.value.rules.filter((_, i) => i !== index);
};

const onDragged = (rules: AutoSwitchRule[]) => {
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
    @change="onDragged as any"
    :draggable="{ type: 'handle', width: 40 }"
  >
    <template #type="{ record }: { record: AutoSwitchRule }">
      <a-select :options="autoSwitchTypes" v-model="record.type" />
    </template>

    <template #condition="{ record }: { record: AutoSwitchRule }">
      <a-input v-model="record.condition" />
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
          <a-select
            :options="autoSwitchTypes"
            v-model="config.defaultProfileID"
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
