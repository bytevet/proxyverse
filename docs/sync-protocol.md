# Proxyverse Sync Protocol — v1 (draft)

Status: design only, nothing implemented. Server: `https://byte.vet`. Client: the
Proxyverse extension (Chrome, Edge, Firefox).

## 0. Decisions (from the design interview)

| Topic | Decision |
|---|---|
| What syncs | User profiles and preferences. The active profile does **not** sync. |
| Per-device opt-out | A profile can be marked "this device only"; preferences have a per-device toggle. |
| Secrets | Proxy credentials sync in the payload. Protected by TLS + server-side encryption at rest. byte.vet can read them. |
| Conflicts | Per-record last-writer-wins (LWW) ordered by a hybrid logical clock (HLC), with tombstones. |
| Trigger | Push on local change (debounced) + pull on start, sign-in and a periodic alarm. No server push channel. |
| Auth | byte.vet is the OAuth 2.1 authorization server. Authorization Code + PKCE through `identity.launchWebAuthFlow`. |
| PAC URL profiles | Sync `sourceURL` and interval; each device fetches the script itself. |
| History | Server keeps account snapshots for restore. |
| First sign-in with data on both sides | Ask: merge, keep cloud, or upload local. |

Non-goals for v1: real-time push, field-level merge inside a profile, end-to-end
encryption (the wire format reserves room for it, see §3.4), sharing profiles
between accounts.

## 1. Concepts

- **Account** — a byte.vet user. Owns one *record store*.
- **Device** — one extension install. Identified by `deviceID`, a random UUIDv4
  created on first sign-in and kept in `storage.local` (never synced).
- **Record** — the unit of sync and of conflict resolution. One profile or one
  preference key is one record.
- **rev** — a server-assigned, account-wide, strictly increasing integer. Every
  accepted write gets the next `rev`. A client's **cursor** is the highest `rev`
  it has applied.
- **HLC** — the record's logical edit time, assigned by the device that made the
  edit. Decides which write wins.
- **Tombstone** — a record with `deleted: true` and no data.

## 2. Authentication

### 2.1 Discovery

`GET https://byte.vet/.well-known/oauth-authorization-server` (RFC 8414) returns
`authorization_endpoint`, `token_endpoint`, `revocation_endpoint` and
`scopes_supported`. The client must not hard-code endpoint paths other than this
one.

### 2.2 Client registration

The extension is a **public client** (no secret). One `client_id`
(`proxyverse-extension`) with these redirect URIs registered:

| Build | Redirect URI |
|---|---|
| Chrome Web Store | `https://<chrome-ext-id>.chromiumapp.org/oauth` |
| Edge Add-ons | `https://<edge-ext-id>.chromiumapp.org/oauth` |
| Firefox AMO | `https://<firefox-hash>.extensions.allizom.org/oauth` (from `browser.identity.getRedirectURL()`) |
| Dev builds | Their own IDs, registered on a non-production `client_id` |

The server must match redirect URIs exactly.

### 2.3 Sign-in flow

1. Generate `code_verifier` (43–128 chars), `code_challenge = BASE64URL(SHA256(verifier))`, and a random `state`.
2. `identity.launchWebAuthFlow({ url: authorize?response_type=code&client_id&redirect_uri&scope=sync&code_challenge&code_challenge_method=S256&state, interactive: true })`.
3. Verify `state`; `POST token_endpoint` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`.
4. Response: `access_token` (JWT or opaque, lifetime ≈ 1 h), `refresh_token`
   (rotating, single use, sliding expiry ≈ 90 days), `expires_in`, `scope`.

Scope: `sync` (read + write the caller's own record store and snapshots).
Optional OpenID scopes (`openid email`) let the UI show who is signed in.

### 2.4 Token handling

- Tokens are stored in `storage.local` under `sync.auth`. Only the background
  service worker calls the sync API; UI pages ask it via messages.
- Before each request, refresh if the access token expires within 60 s.
- Refresh tokens rotate: persist the new one before using the new access token.
  If a refresh returns `invalid_grant`, enter the *signed-out (expired)* state
  and ask the user to sign in again. Local data is kept.
- Sign-out: `POST revocation_endpoint` with the refresh token (best effort),
  then delete `sync.auth` and `sync.state`. Local profiles stay.

### 2.5 Permissions

`identity` is new. Declare it under `optional_permissions` and request it when
the user clicks "Sign in", so existing users get no update prompt. API calls to
`https://byte.vet/*` are already covered by `host_permissions: <all_urls>`.

## 3. Data model

### 3.1 Record

```jsonc
{
  "id": "profile:3f2a…",        // "<kind>:<key>", see 3.2
  "rev": 1842,                   // server-assigned, read-only for clients
  "hlc": "001730023456789:0003:7b1e…", // see 3.3
  "deviceID": "7b1e…",          // device that made this edit
  "deleted": false,
  "schema": "2025-01",          // payload schema version, see 3.5
  "encoding": "json",           // reserved for future E2E, see 3.4
  "data": { … }                  // payload; null when deleted
}
```

### 3.2 Record kinds

| `id` | Source in `storage.local` | Payload |
|---|---|---|
| `profile:<profileID>` | `profiles[profileID]` | One profile in the export format (§3.6). |
| `pref:theme.darkmode` | `theme.darkmode` | `{ "value": <DarkMode> }` |
| `pref:ui.language` | `ui.language` | `{ "value": "auto" \| <LanguageCode> }` |
| `pref:ui.actionBehavior` | `ui.actionBehavior` | `{ "value": "popup" \| "sidebar" }` |

Never synced: `active-profile`, `tabstats:*`, `sync.*`, and the reserved
profiles `direct` / `system` (server rejects them). New preference keys are
added to this table explicitly; nothing syncs by default.

A record id is at most 200 bytes. `profileID` is used as-is, so profiles
imported from SwitchyOmega (UUIDv5 of the name) converge across devices.

### 3.3 Hybrid logical clock

Format: `TTTTTTTTTTTTTTT:CCCC:DEVICEID`

- `T` — milliseconds since epoch, zero-padded to 15 digits.
- `C` — counter, zero-padded to 4 decimal digits.
- `DEVICEID` — the editing device's id (tie-breaker).

Strings compare lexicographically, so `a > b` is a plain string compare.

Device rules (persist the last HLC in `sync.state.clock`):

- **Local edit:** `T = max(now, last.T)`; `C = (T == last.T) ? last.C + 1 : 0`.
- **Receiving a record:** `last = max(last, received.hlc)` before the next
  local edit, so a device never issues an HLC lower than one it has seen.

Server rule: reject a write whose `T` is more than **5 min ahead** of server
time (`clock_skew`). This keeps one device with a broken clock from winning
every conflict forever. The client then shows "check your system clock".

Why HLC rather than arrival order: a device that edits offline for a week and
then reconnects would otherwise overwrite newer edits made elsewhere.

### 3.4 Encryption

Payloads travel in plaintext JSON over TLS 1.2+. byte.vet encrypts records
and snapshots at rest with a per-account data key wrapped by a KMS key
(envelope encryption), and must never log `data`. The server can read proxy
credentials; the UI states this on the sign-in screen.

`encoding` is always `"json"` in v1. A future `"e2e-v1"` would put ciphertext in
`data`; servers must store unknown encodings opaquely and skip validation, and
v1 clients treat records with an unknown encoding as read-only (§3.5).

### 3.5 Schema versioning

`schema` is the Proxyverse config format version (`FORMAT_VERSION`, today
`"2025-01"`). Any change to the profile shape, even an additive field, bumps
it, because the client's zod schema strips unknown keys and an older client
would silently drop new fields on save.

A client that receives a record with a schema or encoding it doesn't know:

- keeps the raw record in `sync.state` but does not apply it locally;
- never pushes over it (its local copy is stale by definition);
- shows "a newer Proxyverse version synced data this version can't read".

The server validates `data` against the schema version it names and rejects
invalid payloads (`invalid_record`) and schema versions it doesn't know
(`unknown_schema`). So the server must be upgraded before a client that
writes a new schema ships.

### 3.6 Profile payload normalization

Before hashing or pushing, a profile goes through the same zod `ProxyProfile`
schema as export (`src/services/config/proxyverse/schema.ts`), which drops
runtime fields such as `pacScript.lastFetched` and `pacScript.lastError`. Then:

- If `pacScript.sourceURL` is set, drop `pacScript.data`. The receiving device
  keeps its own fetched `data` when `sourceURL` is unchanged, and fetches
  immediately otherwise (`pacFetcher.ts`).
- Inline PAC scripts (no `sourceURL`) keep `data`.
- Colors are upper-cased (matches the profile editor's normalization).

The content hash is SHA-256 of the canonical JSON (sorted keys, no whitespace)
of the normalized payload. It is used to detect real local changes and to
de-duplicate identical records.

### 3.7 Limits

| Limit | Value |
|---|---|
| Record payload | 256 KiB |
| Records per account (incl. tombstones) | 2,000 |
| Account total | 8 MiB |
| Records per push request | 100 |
| Request body | 2 MiB |

## 4. Sync API

Base: `https://byte.vet/api/proxyverse/v1` (all paths below are relative to it, e.g. `GET /api/proxyverse/v1/changes`). JSON in and out. Every request sends
`Authorization: Bearer <access_token>`, `X-Proxyverse-Device: <deviceID>` and
`X-Proxyverse-Version: <extension version>`. Errors use RFC 9457 problem
details with a stable `code` field.

### 4.1 Register device — `PUT /devices/{deviceID}`

Body `{ "name": "Chrome on macOS", "browser": "chrome", "extVersion": "2.3.0" }`.
Idempotent; also updates `lastSeen`. `GET /devices` lists them; `DELETE
/devices/{id}` removes one (its future requests get `device_revoked`).

### 4.2 Pull changes — `GET /changes?since=<rev>&limit=<n>`

Returns every record (including tombstones) with `rev > since`, ordered by `rev`.

```jsonc
{ "records": [ /* Record */ ], "cursor": 1850, "hasMore": false }
```

`since=0` returns the full current state. If `since` is older than the
tombstone horizon (§6), the server answers `410 cursor_expired`; the client
then does a full resync (§5.5).

### 4.3 Push — `POST /records`

```jsonc
{ "records": [
  { "id": "profile:3f2a…", "baseRev": 1842, "hlc": "…", "deleted": false,
    "schema": "2025-01", "encoding": "json", "data": { … } }
] }
```

Each record is processed on its own (no batch atomicity), in order:

1. Validate (§3.5, §3.7, reserved ids, `clock_skew`). Failure → `rejected` with that reason.
2. If no stored record, or `incoming.hlc > stored.hlc` → store, assign next `rev` → `accepted`.
3. If `incoming.hlc == stored.hlc` → already applied (retry) → `accepted` with the stored `rev`.
4. Otherwise → `rejected` with reason `stale` and the stored record in `current`.

`baseRev` is informational (diagnostics, "edited a stale copy" telemetry); the
LWW decision uses only the HLC, so the server decides the same way no matter
which device pushes first.

```jsonc
{ "accepted": [ { "id": "profile:3f2a…", "rev": 1851 } ],
  "rejected": [ { "id": "pref:ui.language", "reason": "stale", "current": { /* Record */ } } ] }
```

### 4.4 Snapshots

- `GET /snapshots` → `[{ "id", "createdAt", "reason", "rev", "recordCount", "createdBy" }]`
- `GET /snapshots/{id}` → `{ "records": [ /* Record */ ] }` (for previewing a restore)
- `POST /snapshots` → create one now (`reason: "manual"`).
- `POST /snapshots/{id}/restore` → see §6.

### 4.5 Errors

| HTTP | `code` | Client action |
|---|---|---|
| 400 | `invalid_request` | Bug; log, don't retry. |
| 401 | `invalid_token` | Refresh once, retry; then signed-out (expired). |
| 403 | `device_revoked` | Sign out locally. |
| 410 | `cursor_expired` | Full resync (§5.5). |
| 413 | `quota_exceeded` | Stop pushing; show quota message. |
| 426 | `client_too_old` | Stop syncing; ask the user to update. |
| 429 / 503 | `rate_limited` / `unavailable` | Honor `Retry-After`, else exponential backoff (30 s → 30 min, with jitter). |

Per-record rejection reasons: `stale`, `invalid_record`, `reserved_id`,
`too_large`, `clock_skew`, `unknown_schema`.

## 5. Client sync engine

Runs only in the background service worker. All runs are serialized with
`navigator.locks.request("proxyverse-sync", …)`, so a restart or two
overlapping triggers can't interleave.

### 5.1 Local state (`storage.local`, never synced)

```jsonc
"sync.auth":  { "accessToken", "refreshToken", "expiresAt", "account": { "email" } },
"sync.state": {
  "deviceID": "7b1e…",
  "cursor": 1850,
  "clock": "<last HLC>",
  "base":  { "<recordID>": { "rev": 1842, "hlc": "…", "hash": "…" } }, // last state agreed with server
  "local": { "<recordID>": { "hlc": "…", "hash": "…" } },              // current local version
  "held":  { "<recordID>": { /* Record with unknown schema/encoding */ } },
  "lastSync": { "at": 0, "error": null }
},
"sync.settings": { "enabled": true, "syncPrefs": true, "localOnly": ["<profileID>"] }
```

A record is **dirty** when `local[id].hash != base[id].hash`. There is no
separate outbox: after a service worker restart the dirty set is recomputed by
comparing local storage with `local`/`base`.

### 5.2 Detecting local changes

On a storage change to `profiles` or a synced pref key (and on each run, to
catch changes made while the worker was asleep):

1. Normalize and hash each synced profile/pref.
2. If the hash differs from `local[id].hash`, issue a new HLC and update `local[id]`.
3. A profile missing from local storage that has a `local` entry becomes a
   tombstone with a new HLC.
4. Schedule a push 2 s later (debounced).

Writes made by the engine itself (§5.4) set `local` and `base` to the applied
hash before writing storage, so the resulting storage event finds no change and
nothing echoes back.

### 5.3 A sync run

Triggers: browser start, sign-in, debounced local change, alarm `sync:poll`
every 15 min, "Sync now" button.

1. **Push** dirty records, 100 per request. For each `accepted`: `base[id] = { rev, hlc, hash }`. For each `stale`: apply `current` as a remote record (§5.4).
2. **Pull** `GET /changes?since=cursor` until `hasMore` is false. Apply each record (§5.4). Save `cursor` after each page.
3. Record `lastSync`.

Push before pull means a change made just before a poll goes out immediately;
correctness doesn't depend on the order, because both the server and the client
apply the same HLC rule.

### 5.4 Applying a remote record

```
clock = max(clock, r.hlc)
if r.id is local-only (5.6) or prefs sync is off for a pref: skip
if r.schema/encoding unknown: held[r.id] = r; skip
if local[r.id] exists and local[r.id].hlc > r.hlc:
    keep local (it is dirty and will win on push); base[r.id] = r; skip
apply: write/delete the profile or pref; local[r.id] = base[r.id] = { r.hlc, hash(r.data) }
```

All profile changes from one run are written in a **single** `profiles`
storage write. The existing `refreshProxyOnProfileUpdate` listener then
re-applies the proxy if the active profile or anything it routes to changed;
the sync engine needs no proxy logic of its own.

If a remote tombstone deletes the **active** profile, the device switches to
`direct` and shows a notice, the same as a local delete. Applying
`pref:ui.language` reloads open pages, as a local change does.

### 5.5 Full resync

Used after `cursor_expired`, and as the core of first sign-in. Pull
`GET /changes?since=0` into memory, then for each record id in the union of
remote and local:

- same hash on both sides → mark in sync, no write;
- only local, with a `base` entry, not dirty → it was synced before and has
  since been deleted elsewhere (tombstone already purged) → delete locally;
- only local otherwise (never synced, or edited since) → push it;
- otherwise resolve by HLC (§5.4). A local profile with no `local` entry yet
  gets a fresh HLC, so it counts as the newest edit.

### 5.6 Per-device opt-out

- `sync.settings.localOnly` lists profile ids this device neither pushes nor
  applies. The list itself never syncs.
- Marking a synced profile local-only *detaches* it: the cloud copy and other
  devices are untouched. The dialog offers "also remove it from the cloud",
  which pushes a tombstone and keeps the local copy.
- Unmarking it treats the profile as a new local edit (fresh HLC), so this
  device's version wins.
- References: an auto-switch profile that syncs may point (rule or default) at
  a local-only profile. Other devices don't have it; the proxy engine already
  skips missing profiles with a warning (`profile2config.ts`). The UI warns when
  marking a profile local-only that a synced profile references, and shows
  "missing profile" for such rules on other devices.
- `syncPrefs: false` turns off all `pref:*` records on this device, both ways.

### 5.7 First sign-in

After token exchange and device registration, pull the full state. If the
account has no live records, or the device has no user profiles and default
prefs, merge silently. Otherwise ask:

| Choice | Effect |
|---|---|
| **Merge** (default) | Full resync (§5.5). Local edits win same-id conflicts. |
| **Use cloud data** | The client offers a local backup (export-format JSON download), then replaces local profiles and synced prefs with the cloud state. |
| **Upload this device** | Client calls `POST /snapshots` (`reason: "before-overwrite"`), then pushes all local records with fresh HLCs and tombstones every cloud record absent locally. |

## 6. Server behavior

### 6.1 Storage

Per account: the record table (`id → Record`), a `rev` sequence, a snapshot
list and a device list. Writes to one account are serialized (one row lock or
one Durable Object per account), which makes the `rev` sequence gap-free and
monotonic.

### 6.2 Tombstones

Kept for **90 days** after deletion, then purged. `changes?since=X` returns
`410 cursor_expired` when `X` is lower than the highest purged `rev`. A device
offline for longer than that does a full resync, which removes profiles it had
synced before but that are gone from the cloud (§5.5). Only a profile that was
*edited* on that offline device comes back; that is the intended LWW outcome.

### 6.3 Snapshots

A snapshot is a copy of all live records at a `rev`. The server creates one:

- at most once per day, before the first write of the day;
- before a restore, and when a client asks (`POST /snapshots`).

Retention: all snapshots from the last 30 days, at least the 10 most recent.

**Restore** writes every record of the snapshot, and a tombstone for every
live record absent from it, as new writes with server-issued HLC
`max(all stored hlc).T + 1 : 0000 : server`. They get new `rev`s, so every
device picks them up through the normal pull. Restore never rewinds `rev`.

### 6.4 Security

- TLS 1.2+ only; HSTS on `byte.vet`.
- Envelope encryption at rest per account; `data` is never logged or included
  in error reports.
- Access tokens are bound to `client_id` and scope `sync`; a token only reaches
  its own account's records.
- Rate limit per account and per device (suggested: 60 requests/min).
- Account deletion deletes records, snapshots and devices.

## 7. Extension integration points

| Area | Change |
|---|---|
| `src/adapters/` | `launchWebAuthFlow`, `getRedirectURL`, optional permission request. |
| `src/services/sync/` (new) | HLC, normalization + hash, API client, engine, state. |
| `src/background.ts` | Start engine; storage listeners; `sync:poll` alarm; message handlers for the UI. |
| Preference page | Sign in/out, status, "Sync now", sync prefs toggle, snapshots and restore. |
| Profile editor | "This device only" switch, with the reference warning. |
| `manifest.json` | `identity` in `optional_permissions`. |

## 8. Open questions

1. Account deletion and data export from byte.vet: is that in the website's
   scope or does the extension need a button?
2. Should restore preview diff against the device's local state, or just list
   profile names?
3. Do we need a kill switch (server flag in `/devices` response) to pause sync
   for all clients during an incident?
4. Quotas in §3.7 are guesses; check against real user exports.
