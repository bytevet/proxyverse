import { Host } from "@/adapters";
import { onProfileUpdate } from "@/services/profile";
import { POLL_INTERVAL_MINUTES, type RunTrigger } from "./engine";
import { handleSyncMessages, syncEngine } from "./index";
import { SYNCED_PREFS } from "./records";
import {
  getSyncAuth,
  isSignedIn,
  keySyncAuth,
  keySyncSettings,
  type SyncAuth,
} from "./state";

/**
 * When the background syncs (spec §5.3): at start, right after sign-in, a
 * moment after a local change, and every 15 minutes.
 */

const POLL_ALARM = "sync:poll";
// batch a burst of edits (e.g. typing in a form that saves) into one run
const LOCAL_CHANGE_DELAY_MS = 2000;

function run(trigger: RunTrigger) {
  syncEngine()
    .then((engine) => engine.run({ trigger }))
    .catch(console.error);
}

let pending: ReturnType<typeof setTimeout> | undefined;
// a run returns at once when signed out, so scheduling needs no check
function localChanged() {
  clearTimeout(pending);
  pending = setTimeout(() => run("local"), LOCAL_CHANGE_DELAY_MS);
}

async function startPolling() {
  if (!(await Host.getAllAlarmNames()).includes(POLL_ALARM)) {
    await Host.createPeriodicAlarm(POLL_ALARM, POLL_INTERVAL_MINUTES);
  }
}

export function initSync() {
  handleSyncMessages();

  Host.onAlarm((name) => {
    if (name === POLL_ALARM) run("alarm");
  });

  // profiles, the synced prefs, and this device's sync settings (a profile
  // marked local-only, prefs sync turned on) all change what syncs
  onProfileUpdate(localChanged);
  Host.onLocalStorageChanged((changes) => {
    if (SYNCED_PREFS.some((k) => k in changes) || keySyncSettings in changes) {
      localChanged();
    }

    if (keySyncAuth in changes) {
      const { newValue, oldValue } = changes[keySyncAuth];
      const now = newValue as SyncAuth | undefined;
      if (isSignedIn(now) && !isSignedIn(oldValue as SyncAuth | undefined)) {
        startPolling().catch(console.error);
        run("signin");
      } else if (!now) {
        Host.clearAlarm(POLL_ALARM).catch(console.error);
      }
    }
  });

  getSyncAuth()
    .then(async (auth) => {
      if (!isSignedIn(auth)) return;
      await startPolling();
      run("start");
    })
    .catch(console.error);
}
