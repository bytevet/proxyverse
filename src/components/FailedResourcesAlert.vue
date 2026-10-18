<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { IconRight } from "@arco-design/web-vue/es/icon";
import { countFailures, type TabStatsResult } from "@/services/stats";

const props = defineProps<{
  stats: TabStatsResult;
}>();

const router = useRouter();
const failures = computed(() => countFailures(props.stats.resources));
</script>

<template>
  <a-alert
    v-if="failures > 0"
    data-testid="failed-alert"
    type="warning"
    banner
    class="failed-resources-alert"
  >
    {{ $t("stats_failed_resources", [`${failures}`]) }}
    <template #action>
      <a-link
        data-testid="failed-alert-details"
        @click="
          router.push({
            name: 'popup.resources',
            params: { tabID: stats.tabID },
          })
        "
      >
        {{ $t("stats_details") }}
        <icon-right />
      </a-link>
    </template>
  </a-alert>
</template>

<style lang="scss">
.failed-resources-alert {
  font-size: 0.9em;
}
</style>
