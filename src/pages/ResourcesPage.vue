<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import {
  IconLeft,
  IconCloseCircleFill,
  IconLoading,
} from "@arco-design/web-vue/es/icon";
import { ProxyProfile } from "@/services/profile";
import {
  createProfileFinder,
  getCurrentProxySetting,
  type ResolvedProfile,
} from "@/services/proxy";
import {
  countFailures,
  isFailure,
  subscribeTabStats,
  type TabResource,
  type TabStatsResult,
} from "@/services/stats";
import ProfileSwitchChip from "@/components/controls/ProfileSwitchChip.vue";
import { parseWebURL } from "@/services/utils";

const props = defineProps<{
  tabID: string;
}>();

type ResourceItem = {
  resource: TabResource;
  path: string;
  failed: boolean;
  outlier?: ProxyProfile; // routed differently from the rest of its host
};

type ResourceGroup = {
  host: string;
  items: ResourceItem[];
  failures: number;
  profile?: ResolvedProfile; // the profile used by most resources
};

// badge label and Arco tag color for each webRequest resource type
const RESOURCE_TYPES: Record<string, { label: string; color: string }> = {
  main_frame: { label: "resource_type_main", color: "arcoblue" },
  sub_frame: { label: "resource_type_iframe", color: "purple" },
  stylesheet: { label: "resource_type_stylesheet", color: "cyan" },
  script: { label: "resource_type_script", color: "gold" },
  image: { label: "resource_type_image", color: "green" },
  imageset: { label: "resource_type_image", color: "green" },
  font: { label: "resource_type_font", color: "magenta" },
  xmlhttprequest: { label: "resource_type_xhr", color: "blue" },
  media: { label: "resource_type_media", color: "pinkpurple" },
  websocket: { label: "resource_type_websocket", color: "lime" },
};
const OTHER_TYPE = { label: "resource_type_other", color: "gray" };
const typeOf = (type: string) => RESOURCE_TYPES[type] ?? OTHER_TYPE;

const router = useRouter();
const tabID = computed(() => Number(props.tabID));
const stats = ref<TabStatsResult | undefined>();
const activeProfile = ref<ProxyProfile | undefined>();
const filter = ref<"all" | "failed">("all");
const expanded = ref<string[]>([]);
const autoExpanded = new Set<string>();

let unsubscribe: (() => void) | undefined;
onMounted(async () => {
  unsubscribe = subscribeTabStats(tabID.value, (s) => (stats.value = s));
  activeProfile.value = (await getCurrentProxySetting()).activeProfile;
});
onUnmounted(() => unsubscribe?.());

const resources = computed(() => stats.value?.resources ?? []);
const failureCount = computed(() => countFailures(resources.value));

// simulate which profile is used for each resource URL
const finder = shallowRef<Awaited<ReturnType<typeof createProfileFinder>>>();
const resolved = ref<Record<string, ResolvedProfile>>({});

watch(activeProfile, async (active) => {
  resolved.value = {};
  finder.value =
    active?.proxyType === "auto" ? await createProfileFinder(active) : undefined;
});

watch([resources, finder], async ([res, find], _, onCleanup) => {
  let cancelled = false;
  onCleanup(() => (cancelled = true));
  if (!find) return;

  const urls = [...new Set(res.map((r) => r.url))].filter(
    (url) => !resolved.value[url]
  );
  const results = await Promise.all(urls.map(find));
  if (cancelled || urls.length == 0) return;

  const ret = { ...resolved.value };
  urls.forEach((url, i) => (ret[url] = results[i]));
  resolved.value = ret;
});

// URL parsing is memoized, as stats are updated frequently
const parsedURLs = new Map<string, { host: string; path: string } | null>();
const parseURL = (url: string) => {
  if (!parsedURLs.has(url)) {
    const u = parseWebURL(url);
    parsedURLs.set(
      url,
      u ? { host: u.hostname, path: u.pathname + u.search || "/" } : null
    );
  }
  return parsedURLs.get(url);
};

// the most common profile among the resolved resources
const majorityProfile = (items: ResourceItem[]) => {
  const counts = new Map<string, { n: number; p: ResolvedProfile }>();
  for (const { resource } of items) {
    const p = resolved.value[resource.url];
    if (!p) continue;
    const key = p.profile?.profileID ?? "";
    const c = counts.get(key) ?? { n: 0, p };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.p;
};

const groups = computed<ResourceGroup[]>(() => {
  const byHost = new Map<string, ResourceGroup>();
  for (const resource of resources.value) {
    const failed = isFailure(resource);
    if (filter.value === "failed" && !failed) continue;
    const parsed = parseURL(resource.url);
    if (!parsed) continue;

    let group = byHost.get(parsed.host);
    if (!group) {
      group = { host: parsed.host, items: [], failures: 0 };
      byHost.set(parsed.host, group);
    }
    group.items.push({ resource, path: parsed.path, failed });
    failed && group.failures++;
  }

  const ret = [...byHost.values()];
  for (const g of ret) {
    g.profile = majorityProfile(g.items);
    for (const item of g.items) {
      const p = resolved.value[item.resource.url];
      if (p && p.profile?.profileID !== g.profile?.profile?.profileID) {
        item.outlier = p.profile;
      }
    }
  }
  return ret.sort(
    (a, b) => b.failures - a.failures || b.items.length - a.items.length
  );
});

// expand hosts with failures the first time they show up
watch(groups, (val) => {
  for (const g of val) {
    if (g.failures > 0 && !autoExpanded.has(g.host)) {
      autoExpanded.add(g.host);
      expanded.value.push(g.host);
    }
  }
});

const goBack = () =>
  router.push({ name: "page.popup", query: { tabID: tabID.value } });
</script>

<template>
  <a-layout class="resources-page">
    <a-layout-header class="header">
      <a-button
        type="text"
        size="small"
        data-testid="resources-back"
        @click="goBack"
      >
        <template #icon><icon-left /></template>
      </a-button>
      <a-typography-text bold class="title">
        {{ $t("resources_title") }}
        <a-typography-text type="secondary">
          ({{ resources.length }})
        </a-typography-text>
      </a-typography-text>
      <a-radio-group v-model="filter" type="button" size="mini">
        <a-radio value="all" data-testid="resources-filter-all">{{ $t("resources_filter_all") }}</a-radio>
        <a-radio value="failed" data-testid="resources-filter-failed">
          {{ $t("resources_filter_failed") }}
          <template v-if="failureCount">({{ failureCount }})</template>
        </a-radio>
      </a-radio-group>
    </a-layout-header>

    <a-layout-content class="content">
      <a-empty v-if="groups.length == 0" :description="$t('resources_empty')" />

      <a-collapse
        v-else
        v-model:active-key="expanded"
        :bordered="false"
      >
        <a-collapse-item
          v-for="group in groups"
          :key="group.host"
          :data-testid="`resource-group-${group.host}`"
          :class="{ failed: group.failures > 0 }"
        >
          <template #header>
            <div class="group-header">
              <span class="host" :title="group.host">{{ group.host }}</span>
              <a-typography-text type="secondary" class="count">
                {{ group.items.length }}
                <a-typography-text v-if="group.failures" type="danger">
                  · {{ group.failures }}
                  <icon-close-circle-fill />
                </a-typography-text>
              </a-typography-text>
            </div>
          </template>
          <template #extra v-if="finder && activeProfile">
            <span @click.stop>
              <profile-switch-chip
                :host="group.host"
                :tabID="tabID"
                :profile="group.profile?.profile"
                :uncertain="group.profile?.uncertain"
                :activeProfileID="activeProfile.profileID"
                @switched="(p) => (activeProfile = p)"
              />
            </span>
          </template>

          <ul class="resource-list">
            <li
              v-for="{ resource: r, path, failed, outlier } in group.items"
              :key="r.requestId"
              data-testid="resource-row"
              :data-type="r.type"
              :class="{ failed }"
            >
              <a-tag size="small" :color="typeOf(r.type).color" class="badge">
                {{ $t(typeOf(r.type).label) }}
              </a-tag>
              <a-tooltip :content="r.url" position="top" mini>
                <span class="path">{{ path }}</span>
              </a-tooltip>
              <span
                v-if="outlier"
                class="custom-profiles"
                :style="{ '--indicator-color': outlier.color }"
                :title="outlier.profileName"
              >
                <span class="color-indicator"></span>
              </span>
              <a-tooltip v-if="r.status == 'failed'" :content="r.error" mini>
                <icon-close-circle-fill
                  :class="failed ? 'status-failed' : 'status-benign'"
                />
              </a-tooltip>
              <icon-loading v-else-if="r.status == 'pending'" class="status-pending" />
            </li>
          </ul>
        </a-collapse-item>
      </a-collapse>
    </a-layout-content>
  </a-layout>
</template>

<style lang="scss">
.resources-page {
  width: 100%;
  max-height: 100vh;
  background-color: var(--color-bg-3);

  .header {
    display: flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.4em 0.5em;
    border-bottom: var(--color-border-1) 1px solid;
    background-color: var(--color-bg-4);

    .title {
      flex: 1;
      white-space: nowrap;
    }
  }

  .content {
    overflow-y: auto;
  }

  .arco-empty {
    padding: 2em 0;
  }

  .arco-collapse-item.failed > .arco-collapse-item-header {
    background-color: rgb(var(--danger-1));
  }

  .arco-collapse-item-content {
    padding: 0 0.5em;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-width: 0;

    .host {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .count {
      flex-shrink: 0;
      font-size: 0.9em;
    }
  }

  .resource-list {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      display: flex;
      align-items: center;
      gap: 0.4em;
      padding: 0.15em 0;
      font-size: 0.85em;
      color: var(--color-text-2);

      &.failed .path {
        color: rgb(var(--danger-6));
      }
    }

    .badge {
      flex-shrink: 0;
    }

    .path {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-failed {
      color: rgb(var(--danger-6));
    }

    .status-benign,
    .status-pending {
      color: var(--color-text-4);
    }
  }
}
</style>
