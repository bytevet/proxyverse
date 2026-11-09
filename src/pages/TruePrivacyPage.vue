<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { IconSafe } from "@arco-design/web-vue/es/icon";
import { Host } from "@/adapters";
import { SystemProfile, TRUE_PRIVACY_ID } from "@/services/profile";
import { activeRoutesTo, onActiveProfileChanged } from "@/services/proxy";
import { formatGB, useTruePrivacy } from "@/components/sync/useTruePrivacy";

const tp = useTruePrivacy({ withUsage: true });

// --- whether it's in use ---

const inUse = ref(false);
const usedByRules = ref(false);
const loadActive = async () => {
  const { activeProfile, routes } = await activeRoutesTo(TRUE_PRIVACY_ID);
  inUse.value = activeProfile?.profileID === TRUE_PRIVACY_ID;
  usedByRules.value = routes && !inUse.value;
};

// --- usage ---

const facts = computed(() => {
  const u = tp.usage.value;
  if (!u) return undefined;
  const after =
    u.mode === "block"
      ? Host.getMessage("true_privacy_after_block")
      : Host.getMessage("true_privacy_after_throttle", String(Math.round(u.rate / 1000)));
  // `swatch`: the donut's legend
  return [
    { label: Host.getMessage("true_privacy_used"), value: formatGB(u.used), swatch: tp.ringColor.value },
    {
      label: Host.getMessage("true_privacy_remaining"),
      value: formatGB(Math.max(0, u.quota - u.used)),
      swatch: "var(--color-fill-3)",
    },
    { label: Host.getMessage("true_privacy_resets_on"), value: tp.resetsOn.value },
    { label: Host.getMessage("true_privacy_after_allowance"), value: after },
  ];
});
type Notice = { type: "error" | "warning"; text: string };
const notice = computed<Notice | undefined>(() => {
  if (tp.suspended.value) {
    return { type: "error", text: Host.getMessage("true_privacy_warn_suspended") };
  }
  if (["unavailable", "error"].includes(tp.status.value.state)) {
    return { type: "warning", text: Host.getMessage("true_privacy_warn_unavailable") };
  }
  const u = tp.usage.value;
  if (!u) return undefined;
  if (tp.overQuota.value) {
    const key = u.mode === "block" ? "true_privacy_warn_paused" : "true_privacy_warn_slowed";
    return { type: "warning", text: Host.getMessage(key, tp.resetsOn.value) };
  }
  if (tp.percent.value >= 80) {
    return {
      type: "warning",
      text: Host.getMessage("true_privacy_warn_80", String(tp.percent.value)),
    };
  }
  return undefined;
});

// --- the animation: you → entry point → 3 random stops → website ---

// You (52 wide), the entry point (52), the stops (288) and the website (60),
// with even 84-unit gaps between them and centered as a group. Labels are
// HTML (foreignObject) so long translations wrap inside the drawing instead
// of overflowing it.
const VIEW = { width: 800, height: 330 };
const YOU = [74, 170];
const ENTRY = [210, 170];
const SITE = [722, 170];
const RELAYS = [
  [370, 90], [364, 170], [374, 250],
  [466, 64], [460, 138], [468, 210], [462, 282],
  [558, 98], [564, 178], [554, 256],
];
const COLUMNS = [[0, 1, 2], [3, 4, 5, 6], [7, 8, 9]];
const REGIONS = ["IS", "CA", "JP", "BR", "SE", "KE", "ES", "DE", "CL", "TW"];
const regionNames = (() => {
  try {
    const names = new Intl.DisplayNames(
      [(document.documentElement.lang || navigator.language).replace("_", "-")],
      { type: "region" }
    );
    return REGIONS.map((r) => names.of(r) ?? r);
  } catch {
    return REGIONS;
  }
})();
const mesh = COLUMNS.slice(0, 2).flatMap((col, c) =>
  col.flatMap((a) => COLUMNS[c + 1].map((b) => [RELAYS[a], RELAYS[b]]))
);
// timeline of one loop (ms)
const T = { in: 1800, draw: 3200, hops: 6800, out: 8400, end: 10200 };
const STEP_STARTS = [600, T.in + 1200, T.draw + 1800, T.out + 400];

type Point = number[];
const lerp = (a: Point, b: Point, k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

// What changes a few times a loop is reactive; the packet's position and
// the route's drawing change every frame, so they're written to the SVG
// directly rather than re-rendering the page 60 times a second.
const anim = reactive({
  path: [0, 4, 8],
  layers: 3,
  visited: 0,
  sees: false,
  packetVisible: true,
  step: 0,
  paused: false,
});
const packetEl = ref<SVGGElement>();
const routeEl = ref<SVGPathElement>();
const routePoints = computed(() => [ENTRY, ...anim.path.map((i) => RELAYS[i]), SITE]);
const routeD = computed(() => "M" + routePoints.value.map((p) => p.join(" ")).join(" L"));
const routeLength = computed(() =>
  routePoints.value.slice(1).reduce((sum, p, i) => {
    const q = routePoints.value[i];
    return sum + Math.hypot(p[0] - q[0], p[1] - q[1]);
  }, 0)
);
// where the last line meets the website box, so the packet stays on it
const siteStop = () => {
  const from = RELAYS[anim.path[2]];
  const dx = Math.abs(from[0] - SITE[0]);
  const dy = Math.abs(from[1] - SITE[1]);
  return lerp(SITE, from, Math.min(dx ? 34 / dx : 1, dy ? 28 / dy : 1));
};

function newPath() {
  const pick = (col: number, prev: number) => {
    const options = COLUMNS[col].filter((x) => x !== prev);
    return options[Math.floor(Math.random() * options.length)];
  };
  anim.path = anim.path.map((prev, col) => pick(col, prev));
}

function frame(t: number) {
  let pos: Point;
  let draw = 1;
  // after the entry point: the route is drawn and the stops visited
  const next = { step: 3, layers: 0, visited: 3, sees: false };
  if (t < T.in) {
    pos = lerp([YOU[0] + 30, YOU[1]], ENTRY, ease(t / T.in));
    draw = 0;
    Object.assign(next, { step: 0, layers: 3, visited: 0 });
  } else if (t < T.draw) {
    pos = ENTRY;
    draw = ease((t - T.in) / (T.draw - T.in));
    Object.assign(next, { step: 1, layers: 3, visited: 0 });
  } else if (t < T.hops) {
    const points = [ENTRY, ...anim.path.map((i) => RELAYS[i])];
    const k = (t - T.draw) / ((T.hops - T.draw) / 3);
    const s = Math.min(2, Math.floor(k));
    const within = Math.min(1, k - s);
    pos = lerp(points[s], points[s + 1], ease(within));
    Object.assign(next, { step: 2, layers: 3 - s - (within > 0.98 ? 1 : 0), visited: s + 1 });
  } else if (t < T.out) {
    pos = lerp(RELAYS[anim.path[2]], siteStop(), ease((t - T.hops) / (T.out - T.hops)));
  } else {
    pos = siteStop();
    draw = Math.max(0, 1 - (t - T.out - 900) / 700);
    next.sees = true;
  }
  Object.assign(anim, next, { packetVisible: t < T.end - 500 });
  packetEl.value?.setAttribute("transform", `translate(${pos[0]} ${pos[1]})`);
  routeEl.value?.setAttribute("stroke-dashoffset", String(routeLength.value * (1 - draw)));
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let start = performance.now();
let pausedAt = 0;
let raf = 0;
function loop(now: number) {
  raf = 0;
  if (anim.paused || !packetEl.value) return; // stopped, or not on screen
  let t = now - start;
  if (t > T.end) {
    start = now;
    t = 0;
    newPath();
  }
  frame(t);
  raf = requestAnimationFrame(loop);
}
const play = () => {
  if (!raf) raf = requestAnimationFrame(loop);
};
function togglePause() {
  if (anim.paused) {
    start = performance.now() - pausedAt;
    anim.paused = false;
    play();
  } else {
    pausedAt = performance.now() - start;
    anim.paused = true;
  }
}
function jumpTo(step: number) {
  pausedAt = STEP_STARTS[step];
  start = performance.now() - pausedAt;
  anim.paused = true;
  frame(pausedAt);
}

const layerOpacity = (i: number) => (i < anim.layers ? [1, 0.6, 0.35][i] : 0);
const steps = [1, 2, 3, 4].map((n) => ({
  title: `true_privacy_step${n}_title`,
  text: `true_privacy_step${n}`,
}));

// the drawing is there only while it's shown: start it once it is
watch(packetEl, (el) => {
  if (!el) return;
  if (reducedMotion) jumpTo(3);
  else if (!anim.paused) play();
  else frame(pausedAt);
});

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  loadActive();
  unsubscribe = onActiveProfileChanged(loadActive);
});
onUnmounted(() => {
  unsubscribe?.();
  cancelAnimationFrame(raf);
});
</script>

<template>
  <a-page-header
    :show-back="false"
    :style="{ background: 'var(--color-bg-2)', '--tp-color': SystemProfile.TRUE_PRIVACY.color }"
  >
    <template #title>
      <a-space>
        <icon-safe class="tp-icon" />
        <span>{{ $t("true_privacy_name") }}</span>
        <a-tag size="small" color="orangered" data-testid="tp-beta">{{ $t("preferences_tag_beta") }}</a-tag>
        <template v-if="tp.shown.value">
          <a-tag v-if="inUse" color="green" data-testid="tp-status">{{
            $t("true_privacy_status_in_use")
          }}</a-tag>
          <a-tag v-else-if="usedByRules" color="green" data-testid="tp-status">{{
            $t("true_privacy_status_by_rules")
          }}</a-tag>
          <a-tag v-else data-testid="tp-status">{{ $t("true_privacy_status_not_in_use") }}</a-tag>
        </template>
      </a-space>
    </template>

    <!-- signed out or turned off -->
    <a-result v-if="!tp.shown.value" status="info" data-testid="tp-unavailable">
      <template #icon><icon-safe /></template>
      <template #title>{{
        tp.signedIn.value ? $t("true_privacy_off") : $t("true_privacy_signed_out")
      }}</template>
      <template #extra>
        <a-button type="primary" @click="$router.push({ name: 'preference' })">
          {{ $t("true_privacy_open_preference") }}
        </a-button>
      </template>
    </a-result>

    <a-space v-else direction="vertical" fill :size="16">
      <a-alert
        v-if="!tp.webRTCProtected.value"
        type="warning"
        :title="$t('true_privacy_webrtc_title')"
        data-testid="tp-webrtc"
      >
        {{ $t("true_privacy_webrtc_desc") }}
        <template #action>
          <a-button
            size="small"
            type="primary"
            data-testid="tp-webrtc-allow"
            @click="tp.allowWebRTCProtection()"
            >{{ $t("true_privacy_webrtc_allow") }}</a-button
          >
        </template>
      </a-alert>
      <a-card :title="$t('true_privacy_this_month')" data-testid="tp-usage">
        <a-row :gutter="[24, 16]" align="center">
          <a-col flex="none">
            <a-tooltip :content="tp.tooltip.value" :mouse-enter-delay="500">
              <a-progress
                type="circle"
                :width="140"
                :stroke-width="12"
                :percent="tp.percent.value / 100"
                :color="tp.ringColor.value"
                track-color="var(--color-fill-3)"
              >
                <template #text>
                  <div class="tp-ring-text">
                    <strong data-testid="tp-percent">{{ tp.percent.value }}%</strong>
                    <a-typography-text type="secondary">{{
                      tp.usage.value
                        ? $t("true_privacy_of_quota", formatGB(tp.usage.value.quota))
                        : ""
                    }}</a-typography-text>
                  </div>
                </template>
              </a-progress>
            </a-tooltip>
          </a-col>
          <a-col flex="auto" style="min-width: 220px">
            <a-descriptions
              v-if="facts"
              :column="{ xs: 1, md: 2 }"
              layout="inline-vertical"
              :data="facts"
              data-testid="tp-facts"
            >
              <template #label="{ label, data }">
                <span
                  v-if="data.swatch"
                  class="tp-swatch"
                  :style="{ background: data.swatch }"
                ></span>
                {{ label }}
              </template>
            </a-descriptions>
            <a-skeleton v-else animation><a-skeleton-line :rows="2" /></a-skeleton>
            <a-typography-text type="secondary">{{ $t("true_privacy_counts_all") }}</a-typography-text>
          </a-col>
        </a-row>
        <a-alert
          v-if="notice"
          :type="notice.type"
          style="margin-top: 16px"
          data-testid="tp-notice"
          >{{ notice.text }}</a-alert
        >
      </a-card>

      <a-card :title="$t('true_privacy_how_title')">
        <template #extra>
          <a-button size="small" @click="togglePause">{{
            anim.paused ? $t("true_privacy_how_play") : $t("true_privacy_how_pause")
          }}</a-button>
        </template>
        <div class="tp-anim">
          <svg :viewBox="`0 0 ${VIEW.width} ${VIEW.height}`" role="img" :aria-label="$t('true_privacy_how_aria')">
            <g class="mesh">
              <line
                v-for="(m, i) in mesh"
                :key="i"
                :x1="m[0][0]"
                :y1="m[0][1]"
                :x2="m[1][0]"
                :y2="m[1][1]"
              />
            </g>
            <rect x="320" y="40" width="288" height="270" rx="18" class="frame" />
            <text x="464" y="30" text-anchor="middle" class="caption">{{
              $t("true_privacy_how_stops")
            }}</text>
            <path
              :d="routeD"
              ref="routeEl"
              class="route"
              :stroke-dasharray="routeLength"
            />
            <path
              :d="`M${YOU[0] + 26} ${YOU[1]} L${ENTRY[0] - 26} ${ENTRY[1]}`"
              class="route"
              stroke-dasharray="4 6"
            />
            <g v-for="(r, i) in RELAYS" :key="i">
              <circle
                :cx="r[0]"
                :cy="r[1]"
                r="9"
                class="relay"
                :class="{ picked: anim.path.includes(i) }"
              />
              <text
                :x="r[0]"
                :y="r[1] + 24"
                text-anchor="middle"
                class="caption small"
                :opacity="anim.path.indexOf(i) >= 0 && anim.path.indexOf(i) < anim.visited ? 1 : 0"
              >
                {{ regionNames[i] }}
              </text>
            </g>

            <!-- you -->
            <rect :x="YOU[0] - 26" :y="YOU[1] - 20" width="52" height="40" rx="6" class="box" />
            <line :x1="YOU[0] - 26" :y1="YOU[1] - 10" :x2="YOU[0] + 26" :y2="YOU[1] - 10" class="ink" />
            <circle :cx="YOU[0]" :cy="YOU[1] + 4" r="6" class="ink-fill" />
            <path :d="`M${YOU[0] - 10} ${YOU[1] + 17}a10 8 0 0 1 20 0`" class="ink-fill" />
            <foreignObject :x="YOU[0] - 60" :y="YOU[1] + 26" width="120" height="60">
              <div class="label-html">{{ $t("true_privacy_how_you") }}</div>
            </foreignObject>

            <!-- entry point -->
            <circle :cx="ENTRY[0]" :cy="ENTRY[1]" r="26" class="entry" />
            <path
              :transform="`translate(${ENTRY[0] - 12} ${ENTRY[1] - 12})`"
              d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z"
              class="entry-mark"
            />
            <foreignObject :x="ENTRY[0] - 70" :y="ENTRY[1] + 32" width="140" height="60">
              <div class="label-html">{{ $t("true_privacy_how_entry") }}</div>
            </foreignObject>

            <!-- website -->
            <rect :x="SITE[0] - 30" :y="SITE[1] - 24" width="60" height="48" rx="6" class="box" />
            <circle :cx="SITE[0]" :cy="SITE[1]" r="12" class="ink" fill="none" />
            <ellipse :cx="SITE[0]" :cy="SITE[1]" rx="5" ry="12" class="ink" fill="none" />
            <line :x1="SITE[0] - 12" :y1="SITE[1]" :x2="SITE[0] + 12" :y2="SITE[1]" class="ink" />
            <foreignObject :x="SITE[0] - 60" :y="SITE[1] + 30" width="120" height="60">
              <div class="label-html">{{ $t("true_privacy_how_website") }}</div>
            </foreignObject>
            <foreignObject
              :x="SITE[0] - 66"
              :y="SITE[1] - 88"
              width="132"
              height="58"
              :opacity="anim.sees ? 1 : 0"
            >
              <div class="sees">
                {{ $t("true_privacy_how_sees", regionNames[anim.path[2]]) }}
              </div>
            </foreignObject>

            <!-- the request, sealed in layers; frame() moves it -->
            <g ref="packetEl" :opacity="anim.packetVisible ? 1 : 0">
              <circle r="13" class="layer" :opacity="layerOpacity(2)" />
              <circle r="9.5" class="layer" :opacity="layerOpacity(1)" />
              <circle r="6" class="layer" :opacity="layerOpacity(0)" />
              <circle r="3" class="core" />
            </g>
          </svg>
        </div>
        <a-row :gutter="[12, 12]" align="stretch" class="tp-steps">
          <a-col v-for="(s, i) in steps" :key="s.title" :xs="24" :sm="12" :lg="6">
            <div
              class="tp-step"
              :class="{ active: anim.step === i }"
              role="button"
              tabindex="0"
              @click="jumpTo(i)"
              @keydown.enter="jumpTo(i)"
            >
              <a-typography-text bold>{{ i + 1 }} · {{ $t(s.title) }}</a-typography-text>
              <a-typography-paragraph type="secondary">{{ $t(s.text) }}</a-typography-paragraph>
            </div>
          </a-col>
        </a-row>
        <a-typography-text type="secondary" class="tp-tor">{{
          $t("true_privacy_tor_note")
        }}</a-typography-text>
      </a-card>

      <!-- the same switch as in Preference -->
      <div class="tp-toggle">
        <a-typography-text type="secondary">{{ $t("true_privacy_toggle_on") }}</a-typography-text>
        <a-popconfirm
          :content="inUse ? $t('true_privacy_off_confirm_active') : $t('true_privacy_off_confirm')"
          @ok="tp.setEnabled(false)"
        >
          <a-space>
            <a-typography-text type="secondary">{{ $t("true_privacy_toggle_label") }}</a-typography-text>
            <a-switch
              size="small"
              data-testid="tp-toggle"
              :model-value="tp.enabled.value"
              :before-change="() => false"
            />
          </a-space>
        </a-popconfirm>
      </div>
    </a-space>
  </a-page-header>
</template>

<style lang="scss">
.tp-anim {
  overflow-x: auto;

  svg {
    display: block;
    width: 100%;
    max-width: 760px;
    min-width: 540px;
    height: auto;
    margin: 0 auto;
    overflow: visible;
    font-family: inherit;
  }

  .mesh line {
    stroke: var(--color-border-2);
    stroke-dasharray: 2 4;
  }
  .frame {
    fill: none;
    stroke: var(--color-border-1);
  }
  .caption {
    font-size: 13px;
    fill: var(--color-text-3);
    transition: opacity 0.3s;

    &.small {
      font-size: 12px;
    }
  }
  .route {
    fill: none;
    stroke: var(--tp-color);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .relay {
    fill: var(--color-bg-2);
    stroke: var(--color-border-3);
    stroke-width: 1.5;

    &.picked {
      fill: color-mix(in srgb, var(--tp-color) 15%, transparent);
      stroke: var(--tp-color);
    }
  }
  .box {
    fill: var(--color-bg-2);
    stroke: var(--color-text-3);
    stroke-width: 1.5;
  }
  .ink {
    stroke: var(--color-text-3);
    stroke-width: 1.5;
  }
  .ink-fill {
    fill: var(--color-text-3);
  }
  .entry {
    fill: color-mix(in srgb, var(--tp-color) 10%, transparent);
    stroke: var(--tp-color);
    stroke-width: 1.5;
  }
  .entry-mark {
    fill: none;
    stroke: var(--tp-color);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  .label-html {
    font-size: 15px;
    font-weight: 500;
    line-height: 1.3;
    text-align: center;
    color: var(--color-text-2);
  }
  .sees {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 100%;
    font-size: 13px;
    line-height: 1.3;
    text-align: center;
    color: var(--tp-color);
  }
  .layer {
    fill: none;
    stroke: var(--tp-color);
    stroke-width: 1.5;
  }
  .core {
    fill: var(--tp-color);
  }
}

.tp-ring-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.3;

  strong {
    font-size: 26px;
    font-weight: 600;
    color: var(--color-text-1);
    font-variant-numeric: tabular-nums;
  }
}

.tp-icon {
  color: var(--tp-color);
}

.tp-steps {
  margin-top: 12px;
}

.tp-swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-inline-end: 6px;
  border-radius: 2px;
}

.tp-steps > .arco-col {
  display: flex;
}

.tp-step {
  flex: 1;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: var(--color-fill-1);
  cursor: pointer;
  transition: background 0.4s, border-color 0.4s;

  .arco-typography {
    margin: 4px 0 0;
    font-size: 13px;
  }

  &.active {
    background: color-mix(in srgb, var(--tp-color) 8%, transparent);
    border-color: color-mix(in srgb, var(--tp-color) 20%, transparent);

    .arco-typography:first-child {
      color: var(--tp-color);
    }
  }
}

.tp-tor {
  display: block;
  margin-top: 12px;
  font-size: 12px;

  &.arco-typography {
    color: var(--color-text-3);
  }
}

.tp-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border-2);
}

@media (prefers-reduced-motion: reduce) {
  .tp-anim .caption {
    transition: none;
  }
}
</style>
