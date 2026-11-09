import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { Host } from "@/adapters";
import { SystemProfile } from "@/services/profile";
import type { ProxyUsage } from "@/services/sync/api";
import {
  getSyncAuth,
  isSignedIn,
  keySyncAuth,
  onSyncStorageChanged,
  type SyncAuth,
} from "@/services/sync/state";
import {
  getTruePrivacyEnabled,
  onTruePrivacyEnabledChanged,
  setTruePrivacyEnabled,
} from "@/services/truePrivacy/setting";
import {
  getTruePrivacyStatus,
  getTruePrivacyUsage,
  keyTruePrivacyStatus,
  keyTruePrivacyUsage,
  OK_STATUS,
  requestTruePrivacyUsage,
  resetDate,
  usageRatio,
  WEBRTC_PERMISSION,
  type TruePrivacyStatus,
  type UsageSnapshot,
} from "@/services/truePrivacy/state";

const GiB = 1024 ** 3;

/** Bytes as GB with one decimal under 10 GB, e.g. "3.2 GB". */
export function formatGB(bytes: number): string {
  const gb = bytes / GiB;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

// One copy of the state per page, shared by every component using it (a
// profile picker can be on screen many times): subscribed to storage while
// at least one is mounted.

const auth = shallowRef<SyncAuth>();
const enabled = ref(false);
const status = shallowRef<TruePrivacyStatus>(OK_STATUS);
const snapshot = shallowRef<UsageSnapshot>();
/** WebRTC can't reveal the real IP: the `privacy` permission is granted. */
const webRTCProtected = ref(true);

const loadWebRTC = async () =>
  (webRTCProtected.value = await Host.hasPermission(WEBRTC_PERMISSION));

function subscribe(): () => void {
  // a change carries the new value: no need to read it back
  const unsubscribes = [
    onSyncStorageChanged((changes) => {
      if (keySyncAuth in changes) {
        auth.value = changes[keySyncAuth]?.newValue as SyncAuth | undefined;
      }
    }),
    onTruePrivacyEnabledChanged((v) => (enabled.value = v)),
    Host.onSessionStorageChanged((changes) => {
      if (keyTruePrivacyStatus in changes) {
        status.value =
          (changes[keyTruePrivacyStatus].newValue as TruePrivacyStatus) ??
          OK_STATUS;
      }
      if (keyTruePrivacyUsage in changes) {
        snapshot.value = changes[keyTruePrivacyUsage].newValue as
          | UsageSnapshot
          | undefined;
      }
    }),
    Host.onPermissionsChanged(loadWebRTC),
  ];
  Promise.all([
    getSyncAuth(),
    getTruePrivacyEnabled(),
    getTruePrivacyStatus(),
    getTruePrivacyUsage(),
    loadWebRTC(),
  ]).then(([a, e, s, u]) => {
    [auth.value, enabled.value, status.value, snapshot.value] = [a, e, s, u];
  });
  return () => unsubscribes.forEach((u) => u());
}

let users = 0;
let unsubscribe: (() => void) | undefined;

const signedIn = computed(() => isSignedIn(auth.value));
/** Listed in the popup, the sidebar and the profile pickers. */
const shown = computed(() => signedIn.value && enabled.value);
const suspended = computed(
  () =>
    status.value.state === "suspended" ||
    snapshot.value?.usage.status === "suspended"
);
/** Traffic can go through it: rules that route to it work. */
const available = computed(() => shown.value && !suspended.value);

const usage = computed<ProxyUsage | undefined>(() => snapshot.value?.usage);
const percent = computed(() =>
  usage.value ? Math.round(usageRatio(usage.value) * 100) : 0
);
const overQuota = computed(
  () => !!usage.value && usage.value.used >= usage.value.quota
);
const resetsOn = computed(() =>
  usage.value
    ? resetDate(usage.value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : ""
);
/** The usage ring's color: the profile's teal, then warning and danger. */
const ringColor = computed(() =>
  overQuota.value
    ? "rgb(var(--danger-6))"
    : percent.value >= 80
    ? "rgb(var(--warning-6))"
    : SystemProfile.TRUE_PRIVACY.color
);
const tooltip = computed(() =>
  usage.value
    ? Host.getMessage("true_privacy_usage_tooltip", [
        String(percent.value),
        formatGB(usage.value.used),
        formatGB(usage.value.quota),
        resetsOn.value,
      ])
    : Host.getMessage("true_privacy_usage_loading")
);

/**
 * Ask for the `privacy` permission. Call it right in a click handler,
 * before anything awaits: browsers only ask during a user gesture.
 */
const allowWebRTCProtection = () =>
  Host.requestPermission(WEBRTC_PERMISSION).catch(() => false);

/**
 * True Privacy Proxy as pages show it: whether it's shown (signed in and
 * turned on), its status and this month's usage, kept up to date with what
 * the background stores. `withUsage` asks the background for fresh usage.
 */
export function useTruePrivacy({ withUsage = false } = {}) {
  onMounted(() => {
    if (users++ === 0) unsubscribe = subscribe();
    if (withUsage) requestTruePrivacyUsage();
  });
  onUnmounted(() => {
    if (--users === 0) unsubscribe?.();
  });

  return {
    signedIn,
    enabled,
    shown,
    available,
    suspended,
    status,
    usage,
    percent,
    overQuota,
    resetsOn,
    ringColor,
    tooltip,
    webRTCProtected,
    allowWebRTCProtection,
    /** Turn it on or off; turning on asks for WebRTC protection too. */
    setEnabled(on: boolean) {
      if (on && !webRTCProtected.value) allowWebRTCProtection();
      return setTruePrivacyEnabled(on);
    },
  };
}
