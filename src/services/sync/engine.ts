import type { ProfilesStorage } from "@/services/profile";
import { withLock } from "@/services/utils";
import type { ExtensionInfo } from "@/adapters";
import { SyncApiError, type SyncApi, type SyncRecord } from "./api";
import { SyncAuthError } from "./auth";
import { compareHLC, observeHLC, tickHLC } from "./hlc";
import {
  collectLocalRecords,
  decodeRemote,
  hashPayload,
  mergeIncomingProfile,
  normalizeProfile,
  parseRecordID,
  PAYLOAD_ENCODING,
  PAYLOAD_SCHEMA,
  SYNCED_PREF_DEFAULTS,
  type LocalRecord,
  type Payload,
  type ProfilePayload,
  type SyncedPref,
} from "./records";
import {
  initialSyncState,
  type SyncSettings,
  type SyncState,
} from "./state";

/**
 * The sync engine (spec §5). One run pushes this device's changes and
 * pulls everyone else's. Runs are serialized across extension contexts.
 *
 * Bookkeeping, per record (`SyncState`):
 * - `local`: this device's version (HLC + content hash). A local edit gets a
 *   new HLC when a run first sees it.
 * - `base`: the version last agreed with the server.
 * A record is dirty, so pushed, while the two differ. There's no outbox: a
 * restarted service worker finds pending changes by comparing again.
 */

/** The hash of a deleted record. */
const TOMBSTONE = "deleted";
const PUSH_BATCH = 100;
/** How often the background pulls changes from other devices. */
export const POLL_INTERVAL_MINUTES = 15;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** What the user picked when both this device and the account had data. */
export type FirstChoice = "merge" | "cloud" | "upload";

export type RunTrigger = "start" | "signin" | "local" | "alarm" | "manual";

export type RunOptions = {
  trigger: RunTrigger;
  firstChoice?: FirstChoice;
};

/** The storage the engine syncs: this device's, or a test double. */
export interface SyncDevice {
  profiles(): Promise<ProfilesStorage>;
  /** Change the profiles under the profiles lock (see `updateProfiles`). */
  updateProfiles(
    mutate: (profiles: ProfilesStorage) => void | Promise<void>
  ): Promise<void>;
  prefs(): Promise<Partial<Record<SyncedPref, unknown>>>;
  setPref(key: SyncedPref, value: unknown): Promise<void>;
  state(): Promise<SyncState | undefined>;
  setState(state: SyncState): Promise<void>;
  settings(): Promise<SyncSettings>;
  signedIn(): Promise<boolean>;
}

export type SyncApiLike = Pick<
  SyncApi,
  "putDevice" | "changes" | "push" | "createSnapshot"
>;

export type SyncEngineDeps = {
  device: SyncDevice;
  api(deviceID: string): SyncApiLike | Promise<SyncApiLike>;
  info: ExtensionInfo;
  /** The server refused the token in a way refreshing can't fix. */
  onAuthRejected(): Promise<void>;
  /** This device was removed from the account. */
  onDeviceRevoked(): Promise<void>;
  now?: () => number;
  /** Name of the lock serializing runs; tests give each device its own. */
  lockName?: string;
};

// This device's side of a run: what detecting and applying work with.
type Local = {
  state: SyncState;
  settings: SyncSettings;
};

// What a run works with. `state` is saved after each step that wrote
// storage or reached the server, so a service worker killed mid-run loses
// little; storage is always written before the state that records it.
type Run = Local & {
  api: SyncApiLike;
  /** A problem that didn't stop the run, reported as its error. */
  warning?: { code: string; message?: string };
};

export class SyncEngine {
  private readonly now: () => number;

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Sync now. Resolves when done; failures are recorded in the state. */
  run(opts: RunOptions): Promise<void> {
    return withLock(this.deps.lockName ?? "proxyverse-sync", () =>
      this.runLocked(opts)
    );
  }

  private async runLocked(opts: RunOptions) {
    const { device } = this.deps;
    const [signedIn, stored, settings] = await Promise.all([
      device.signedIn(),
      device.state(),
      device.settings(),
    ]);
    if (!signedIn) return;

    const state = stored ?? initialSyncState();
    const userAsked = opts.trigger === "manual" || opts.trigger === "signin";
    if (!userAsked && state.backoff && this.now() < state.backoff.until) return;
    if (state.needsFirstChoice && !opts.firstChoice) return;
    const local: Local = { state, settings };

    // Done without reaching the server when there's nothing to push and
    // nothing to pull yet: a local change that only echoes the engine's own
    // writes (or a PAC refresh), or a service worker wake (it wakes on most
    // page loads) soon after the last sync. The poll alarm pulls the rest.
    let detected: Map<string, LocalRecord> | undefined;
    const pollDue =
      opts.trigger !== "start" ||
      !state.lastSync ||
      this.now() - state.lastSync.at >= POLL_INTERVAL_MINUTES * 60_000;
    if (state.synced && (opts.trigger === "local" || !pollDue)) {
      const { records, changed } = await this.detect(local);
      if (!this.anyDirty(state)) {
        if (changed) await this.deps.device.setState(state);
        return;
      }
      detected = records;
    }

    const run: Run = { ...local, api: await this.deps.api(state.deviceID) };
    try {
      await this.register(run);
      if (!state.synced) {
        await this.firstSync(run, opts.firstChoice);
      } else {
        await this.push(run, detected ?? (await this.detect(run)).records);
        await this.pull(run);
      }
      state.lastSync = run.warning
        ? { at: this.now(), error: run.warning }
        : { at: this.now() };
      delete state.backoff;
    } catch (e) {
      await this.fail(state, e);
    }
    await this.save(run);
  }

  // --- steps ---

  /** Name this device on the account, once per extension version. */
  private async register({ api, state }: Run) {
    const { version, browser, os } = this.deps.info;
    if (state.registered === version) return;
    await api.putDevice({
      name: `${browser[0].toUpperCase()}${browser.slice(1)} on ${os}`,
      browser,
      extVersion: version,
    });
    state.registered = version;
  }

  /**
   * The first sync with an account (spec §5.7). When both sides have data
   * and the user hasn't chosen yet, it stops with `needsFirstChoice`.
   */
  private async firstSync(run: Run, choice: FirstChoice | undefined) {
    const { api, state } = run;
    const remote = await this.pullAll(api);

    if (!choice) {
      const live = remote.records.filter((r) => !r.deleted);
      if (live.length === 0) choice = "merge";
      else if (await this.isPristine(run)) choice = "cloud";
      else {
        state.needsFirstChoice = true;
        return;
      }
    }

    switch (choice) {
      case "merge": {
        // local edits get fresh HLCs, so they win same-ID conflicts
        const { records } = await this.detect(run);
        await this.apply(run, remote.records);
        await this.push(run, records);
        break;
      }
      case "cloud": {
        await this.apply(run, remote.records, { force: true });
        const live = new Set(remote.records.filter((r) => !r.deleted).map((r) => r.id));
        const local = await this.collect(run);
        await this.deleteLocal(
          run,
          [...local.keys()].filter((id) => !live.has(id))
        );
        await this.detect(run);
        break;
      }
      case "upload": {
        await api.createSnapshot("before-overwrite");
        for (const r of remote.records) {
          state.clock = observeHLC(state.clock, r.hlc) ?? state.clock;
          state.base[r.id] = {
            rev: r.rev,
            hlc: r.hlc,
            hash: r.deleted ? TOMBSTONE : await this.remoteHash(r),
          };
        }
        const { records } = await this.detect(run);
        // remove what this device doesn't have from the account
        for (const r of remote.records) {
          if (r.deleted || records.has(r.id) || this.isDetached(run, r.id)) continue;
          state.local[r.id] = { hlc: this.tick(state), hash: TOMBSTONE };
        }
        await this.push(run, records);
        break;
      }
    }

    state.cursor = Math.max(state.cursor, remote.cursor);
    state.synced = true;
    delete state.needsFirstChoice;
    await this.save(run);
    await this.pull(run);
  }

  /**
   * Compare storage with `state.local` and give each change a new HLC
   * (spec §5.2). Returns this device's records, and whether `state` changed.
   */
  private async detect(
    local: Local
  ): Promise<{ records: Map<string, LocalRecord>; changed: boolean }> {
    const { state } = local;
    const { records, profiles, prefs } = await this.collectWithSource(local);
    let changed = false;

    for (const [id, rec] of records) {
      if (state.local[id]?.hash !== rec.hash) {
        state.local[id] = { hlc: this.tick(state), hash: rec.hash };
        changed = true;
      }
    }

    for (const id of Object.keys(state.local)) {
      if (records.has(id)) continue;
      if (this.isDetached(local, id)) {
        // local-only now: the cloud copy stays as is (spec §5.6)
        delete state.local[id];
        delete state.base[id];
        changed = true;
        continue;
      }
      const parsed = parseRecordID(id);
      // stored but invalid: leave the synced version alone
      if (parsed?.kind === "profile" && parsed.profileID in profiles) continue;
      if (parsed?.kind === "pref" && prefs[parsed.key] !== undefined) continue;

      if (state.local[id].hash === TOMBSTONE) continue;
      if (state.base[id]) {
        state.local[id] = { hlc: this.tick(state), hash: TOMBSTONE };
      } else {
        delete state.local[id]; // never synced: nothing to delete remotely
      }
      changed = true;
    }

    return { records, changed };
  }

  /** Push dirty records (spec §5.3, step 1). */
  private async push(run: Run, local: Map<string, LocalRecord>) {
    const { api, state } = run;
    const dirty = Object.keys(state.local).filter((id) => this.isDirty(state, id));

    for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
      const batch = dirty.slice(i, i + PUSH_BATCH).flatMap((id) => {
        const { hlc, hash } = state.local[id];
        const deleted = hash === TOMBSTONE;
        const payload = local.get(id)?.payload;
        if (!deleted && !payload) return []; // changed since: next run
        return [
          {
            id,
            baseRev: state.base[id]?.rev ?? 0,
            hlc,
            deleted,
            schema: PAYLOAD_SCHEMA,
            encoding: PAYLOAD_ENCODING,
            data: deleted ? null : payload,
          },
        ];
      });
      if (batch.length === 0) continue;

      const result = await api.push(batch);
      const pushed = new Map(batch.map((r) => [r.id, r]));
      for (const { id, rev } of result.accepted) {
        const sent = pushed.get(id);
        if (!sent) continue;
        state.base[id] = {
          rev,
          hlc: sent.hlc,
          hash: sent.deleted ? TOMBSTONE : state.local[id].hash,
        };
        delete state.failed?.[id];
      }

      const stale: SyncRecord[] = [];
      for (const { id, reason, current } of result.rejected) {
        if (reason === "stale" && current) stale.push(current);
        else if (reason === "clock_skew") {
          // retried on the next run; the user may fix the clock meanwhile
          run.warning = { code: "clock_skew" };
        } else {
          (state.failed ??= {})[id] = { reason, hash: state.local[id].hash };
        }
      }
      // a newer version is on the server: take it (spec §4.3)
      if (stale.length) await this.apply(run, stale);
      await this.save(run);
    }
  }

  /** Pull changes since the cursor (spec §5.3, step 2). */
  private async pull(run: Run) {
    const { api, state } = run;
    for (;;) {
      let page;
      try {
        page = await api.changes(state.cursor);
      } catch (e) {
        if (e instanceof SyncApiError && e.code === "cursor_expired") {
          return this.fullResync(run);
        }
        throw e;
      }
      await this.apply(run, page.records);
      state.cursor = Math.max(state.cursor, page.cursor);
      await this.save(run);
      if (!page.hasMore) return;
    }
  }

  /**
   * Resync from scratch after the server purged tombstones past our cursor
   * (spec §5.5): what we had synced and the server no longer has was
   * deleted elsewhere.
   */
  private async fullResync(run: Run) {
    const { state } = run;
    const remote = await this.pullAll(run.api);
    const onServer = new Set(remote.records.map((r) => r.id));

    const gone: SyncRecord[] = Object.entries(state.base)
      .filter(([id, b]) => !onServer.has(id) && b.hash !== TOMBSTONE)
      .map(([id, b]) => ({
        id,
        rev: b.rev,
        hlc: b.hlc,
        deviceID: "",
        deleted: true,
        schema: PAYLOAD_SCHEMA,
        encoding: PAYLOAD_ENCODING,
        data: null,
      }));

    await this.apply(run, [...gone, ...remote.records]);
    state.cursor = remote.cursor;
    await this.save(run);
    await this.push(run, (await this.detect(run)).records);
  }

  /**
   * Apply remote records (spec §5.4): one profiles write for all of them.
   * The caller saves the state after. A local change that is newer wins and
   * stays dirty; `force` makes remote win regardless ("use cloud data").
   */
  private async apply(
    run: Run,
    records: SyncRecord[],
    { force = false }: { force?: boolean } = {}
  ) {
    const { state, settings } = run;
    const puts = new Map<string, ProfilePayload>();
    const deletes = new Set<string>();
    const prefWrites = new Map<SyncedPref, unknown>();
    // this device's version of each applied profile, to spot edits made
    // since this run looked
    const expected = new Map<string, { id: string; mine?: SyncState["local"][string] }>();

    for (const r of records) {
      state.clock = observeHLC(state.clock, r.hlc) ?? state.clock;
      const parsed = parseRecordID(r.id);
      if (!parsed || this.isDetached(run, r.id)) continue;

      let payload: Payload | undefined;
      let hash = TOMBSTONE;
      if (!r.deleted) {
        if (r.encoding !== PAYLOAD_ENCODING || r.schema !== PAYLOAD_SCHEMA) {
          // a newer version wrote it: keep it, don't apply (spec §3.5)
          state.held[r.id] = r;
          continue;
        }
        payload = decodeRemote(r.id, r.data);
        if (!payload) {
          state.held[r.id] = r;
          continue;
        }
        hash = await hashPayload(payload);
      }
      delete state.held[r.id];

      const theirs = { rev: r.rev, hlc: r.hlc, hash };
      const mine = state.local[r.id];
      if (mine?.hash === hash) {
        state.base[r.id] = theirs;
        state.local[r.id] = { hlc: r.hlc, hash };
        continue;
      }
      const dirty = mine !== undefined && mine.hash !== state.base[r.id]?.hash;
      if (!force && dirty && compareHLC(mine.hlc, r.hlc) > 0) {
        state.base[r.id] = theirs; // ours is newer and will win on push
        continue;
      }

      if (parsed.kind === "profile") {
        expected.set(parsed.profileID, { id: r.id, mine });
        if (r.deleted) deletes.add(parsed.profileID);
        else puts.set(parsed.profileID, payload as ProfilePayload);
      } else if (!r.deleted && settings.syncPrefs) {
        prefWrites.set(parsed.key, (payload as { value: unknown }).value);
      }
      state.base[r.id] = theirs;
      state.local[r.id] = { hlc: r.hlc, hash };
    }

    if (puts.size || deletes.size) {
      await this.deps.device.updateProfiles(async (profiles) => {
        for (const [profileID, exp] of expected) {
          // edited since this run looked: keep the edit, which the next
          // run pushes with a newer HLC
          const current = profiles[profileID];
          const payload = current ? normalizeProfile(current) : undefined;
          const now = payload ? await hashPayload(payload) : undefined;
          const before = exp.mine?.hash === TOMBSTONE ? undefined : exp.mine?.hash;
          if (now !== before) {
            if (exp.mine) state.local[exp.id] = exp.mine;
            else delete state.local[exp.id];
            continue;
          }
          if (deletes.has(profileID)) delete profiles[profileID];
          const put = puts.get(profileID);
          if (put) profiles[profileID] = mergeIncomingProfile(put, current);
        }
      });
    }
    for (const [key, value] of prefWrites) {
      await this.deps.device.setPref(key, value);
    }
  }

  /** Delete local records by ID ("use cloud data"). */
  private async deleteLocal(run: Run, ids: string[]) {
    const profileIDs = ids.flatMap((id) => {
      const parsed = parseRecordID(id);
      return parsed?.kind === "profile" ? [parsed.profileID] : [];
    });
    if (profileIDs.length === 0) return;
    await this.deps.device.updateProfiles((profiles) => {
      profileIDs.forEach((p) => delete profiles[p]);
    });
    for (const id of ids) {
      delete run.state.local[id];
      delete run.state.base[id];
    }
  }

  // --- helpers ---

  /** Every record on the server, following pages. */
  private async pullAll(api: SyncApiLike) {
    const records: SyncRecord[] = [];
    let cursor = 0;
    for (;;) {
      const page = await api.changes(cursor);
      records.push(...page.records);
      cursor = Math.max(cursor, page.cursor);
      if (!page.hasMore) return { records, cursor };
    }
  }

  private async collectWithSource({ settings }: Local) {
    const { device } = this.deps;
    const [profiles, prefs] = await Promise.all([device.profiles(), device.prefs()]);
    const records = await collectLocalRecords({
      profiles,
      prefs,
      localOnly: settings.localOnly,
      syncPrefs: settings.syncPrefs,
    });
    return { records, profiles, prefs };
  }

  private async collect(run: Local) {
    return (await this.collectWithSource(run)).records;
  }

  /**
   * Whether this device has nothing worth keeping: no profiles that sync,
   * and default preferences. It then takes the account's data silently.
   */
  private async isPristine(run: Run): Promise<boolean> {
    for (const [id, rec] of await this.collect(run)) {
      const parsed = parseRecordID(id);
      if (parsed?.kind !== "pref") return false;
      if ((rec.payload as { value: unknown }).value !== SYNCED_PREF_DEFAULTS[parsed.key]) {
        return false;
      }
    }
    return true;
  }

  /** A record this device doesn't sync: a local-only profile, or a pref with prefs off. */
  private isDetached({ settings }: Local, id: string): boolean {
    const parsed = parseRecordID(id);
    if (parsed?.kind === "profile") {
      return settings.localOnly.includes(parsed.profileID);
    }
    return parsed?.kind === "pref" && !settings.syncPrefs;
  }

  private isDirty(state: SyncState, id: string): boolean {
    const mine = state.local[id];
    if (!mine || mine.hash === state.base[id]?.hash) return false;
    return state.failed?.[id]?.hash !== mine.hash;
  }

  private anyDirty(state: SyncState) {
    return Object.keys(state.local).some((id) => this.isDirty(state, id));
  }

  private async remoteHash(r: SyncRecord): Promise<string> {
    const payload = decodeRemote(r.id, r.data);
    // unreadable here: any local version differs from it
    return payload ? hashPayload(payload) : `unreadable:${r.hlc}`;
  }

  private tick(state: SyncState): string {
    state.clock = tickHLC(state.clock, state.deviceID, this.now());
    return state.clock;
  }

  private save({ state }: Run) {
    return this.deps.device.setState(state);
  }

  /** Record a failed run; back off from server trouble (spec §4.5). */
  private async fail(state: SyncState, e: unknown) {
    const at = this.now();

    if (e instanceof SyncAuthError) {
      state.lastSync = { at, error: { code: "auth", message: e.code } };
      return;
    }
    if (!(e instanceof SyncApiError)) {
      console.error("Sync failed", e);
      state.lastSync = { at, error: { code: "internal", message: String(e) } };
      return;
    }

    if (e.code === "invalid_token") {
      await this.deps.onAuthRejected();
      state.lastSync = { at, error: { code: "auth", message: e.code } };
      return;
    }
    state.lastSync = { at, error: { code: e.code, message: e.detail } };
    switch (e.code) {
      case "device_revoked":
        await this.deps.onDeviceRevoked();
        return;
      case "rate_limited":
      case "unavailable":
      case "network": {
        const attempts = (state.backoff?.attempts ?? 0) + 1;
        const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempts - 1));
        const wait = e.retryAfter !== undefined ? e.retryAfter * 1000 : exp * (0.5 + Math.random() / 2);
        state.backoff = { until: at + wait, attempts };
        return;
      }
    }
  }
}
