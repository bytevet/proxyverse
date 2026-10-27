/// <reference types="node" />
/**
 * In-memory fake of byte.vet's OAuth server and Proxyverse sync API, for
 * tests. Pure logic, no sockets: `syncApi.ts` serves it over HTTP for e2e, and
 * unit tests use it directly or through `store.fetch` (a `fetch` drop-in).
 *
 * Behavior follows docs/sync-protocol.md (§2, §3, §4, §6) and the real
 * server's wire contract (webapp docs/proxyverse-sync.openapi.yaml):
 * webapp `src/lib/proxyverse/{api,validate}.ts` and ws-relay
 * `src/sync/sync-store.ts`. One account, one user.
 *
 * Only depends on `node:crypto`, so it type-checks under both the root and
 * the e2e tsconfig and runs in vitest.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { components } from "../../src/services/sync/api.gen";

// ── Wire types: the contract's, generated from docs/sync-api.openapi.yaml ──

export const HLC_PATTERN = /^(\d{15}):(\d{4}):([A-Za-z0-9-]{1,64})$/;

type Schemas = components["schemas"];
export type SyncRecord = Schemas["SyncRecord"];
export type PushRecord = Schemas["PushRecord"];
export type RejectReason = Schemas["RejectReason"];
export type PushResult = Schemas["PushResult"];
export type ChangesResult = Schemas["ChangesResult"];
export type Device = Schemas["Device"];
export type DeviceInput = Schemas["DeviceInput"];
export type SnapshotMeta = Schemas["SnapshotMeta"];
export type SnapshotReason = SnapshotMeta["reason"];
export type SyncErrorCode = Schemas["Problem"]["code"];

export const SYNC_ERROR_STATUS: Record<SyncErrorCode, number> = {
  invalid_request: 400,
  invalid_token: 401,
  device_revoked: 403,
  not_found: 404,
  cursor_expired: 410,
  quota_exceeded: 413,
  client_too_old: 426,
  rate_limited: 429,
  unavailable: 503,
};

const PROBLEM_TITLES: Record<string, string> = {
  invalid_request: "Invalid request",
  invalid_token: "Invalid or expired access token",
  device_revoked: "Device revoked",
  not_found: "Not found",
  cursor_expired: "Cursor expired",
  quota_exceeded: "Quota exceeded",
  client_too_old: "Client too old",
  rate_limited: "Rate limited",
  unavailable: "Service unavailable",
};

const PROBLEM_TYPE_BASE = "https://byte.vet/docs/proxyverse-sync#";

/** RFC 9457 problem details, as the real server sends them. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
}

/** A request-level error (`application/problem+json`). */
export class SyncProblem extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly status = SYNC_ERROR_STATUS[code as SyncErrorCode] ?? 500,
    readonly retryAfter?: number
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }

  get body(): Problem {
    return {
      type: PROBLEM_TYPE_BASE + this.code,
      title: PROBLEM_TITLES[this.code] ?? this.code,
      status: this.status,
      code: this.code,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

/** An OAuth error (RFC 6749 §5.2): `{error, error_description}`. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description?: string,
    readonly status = error === "invalid_client" || error === "invalid_token" ? 401 : 400
  ) {
    super(`${error}${description ? `: ${description}` : ""}`);
  }

  get body() {
    return {
      error: this.error,
      ...(this.description ? { error_description: this.description } : {}),
    };
  }
}

// ── Limits (spec §3.7) ─────────────────────────────────────────────────

export const SYNC_LIMITS = {
  recordPayloadBytes: 256 * 1024,
  recordsPerAccount: 2000,
  accountBytes: 8 * 1024 * 1024,
  recordsPerPush: 100,
  requestBodyBytes: 2 * 1024 * 1024,
  recordIdBytes: 200,
  changesDefaultLimit: 500,
  changesMaxLimit: 1000,
  clockSkewMs: 5 * 60 * 1000,
} as const;

export const KNOWN_SCHEMAS = new Set(["2025-01"]);
const RESERVED_PROFILES = new Set(["direct", "system"]);

export const SYNC_BASE_PATH = "/api/proxyverse/v1";
export const OAUTH_BASE_PATH = "/api/auth/oauth2";
export const SUPPORTED_SCOPES = ["openid", "email", "offline_access", "sync"];

// ── Options ────────────────────────────────────────────────────────────

export interface SyncStoreOptions {
  /** Accepted OAuth client ids. */
  clientIDs?: string[];
  /** Redirect URI check; default: `https://*.chromiumapp.org/oauth` or `https://*.extensions.allizom.org/oauth`. */
  redirectURIAllowed?: (uri: string, clientID: string) => boolean;
  /** The account's user. */
  user?: { sub: string; email: string };
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  /** Per-account quotas (records incl. tombstones, and payload bytes). */
  maxRecords?: number;
  maxBytes?: number;
  /** `X-Proxyverse-Version` below this gets 426 `client_too_old`. */
  minVersion?: string;
}

export const DEFAULT_CLIENT_IDS = [
  "proxyverse-extension",
  "proxyverse-extension-dev",
];

const DEFAULT_REDIRECT_RE =
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(chromiumapp\.org|extensions\.allizom\.org)\/oauth$/i;

const DEFAULTS: Required<SyncStoreOptions> = {
  clientIDs: DEFAULT_CLIENT_IDS,
  redirectURIAllowed: (uri) => DEFAULT_REDIRECT_RE.test(uri),
  user: { sub: "e2e-user", email: "e2e-user@example.test" },
  accessTokenTtlMs: 60 * 60 * 1000,
  refreshTokenTtlMs: 90 * 24 * 60 * 60 * 1000,
  maxRecords: SYNC_LIMITS.recordsPerAccount,
  maxBytes: SYNC_LIMITS.accountBytes,
  minVersion: "",
};

// ── Test-control types ─────────────────────────────────────────────────

export interface Failure {
  status: number;
  code: string;
  retryAfter?: number;
  /** Only requests whose pathname contains this (e.g. "/records"); any request if omitted. */
  path?: string;
  /** Only this method, e.g. "POST". */
  method?: string;
  detail?: string;
}

export interface RequestLogEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  status: number;
  /** Problem `code` or OAuth `error`, for error responses. */
  code?: string;
  device?: string;
  version?: string;
  /** Parsed JSON or form body, if any. */
  body?: unknown;
  time: number;
}

/** A record for `seed()`; missing fields get defaults. */
export type SeedRecord = Partial<Omit<SyncRecord, "rev">> & { id: string };

/** A request as `handle()` sees it. Header names are lower-case. */
export interface SyncRequest {
  method: string;
  /** Absolute URL. */
  url: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface SyncResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

const utf8Length = (s: string) => Buffer.byteLength(s, "utf8");

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUUID = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

export function formatHlc(t: number, c: number, deviceID: string): string {
  return `${String(t).padStart(15, "0")}:${String(c).padStart(4, "0")}:${deviceID}`;
}

const hlcTime = (hlc: string) => Number(HLC_PATTERN.exec(hlc)?.[1] ?? 0);

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const PREF_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  "theme.darkmode": (v) => v === 0 || v === 1 || v === 2,
  "ui.language": (v) =>
    v === "auto" || (typeof v === "string" && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(v)),
  "ui.actionBehavior": (v) => v === "popup" || v === "sidebar",
};

type Validated =
  | { ok: true; record: PushRecord }
  | { ok: false; id: string; reason: RejectReason; detail: string };

/**
 * Per-record validation, in the real server's order (webapp
 * `validate.ts`). `clock_skew`, `stale` and quotas need state and are decided
 * in `push`.
 */
export function validatePushRecord(input: unknown): Validated {
  const fail = (id: string, reason: RejectReason, detail: string): Validated => ({
    ok: false,
    id,
    reason,
    detail,
  });
  if (!isPlainObject(input)) return fail("", "invalid_record", "record must be an object");
  const id = typeof input.id === "string" ? input.id : "";
  if (!id) return fail("", "invalid_record", "id must be a non-empty string");

  const { hlc, deleted, schema, encoding, baseRev, data } = input;
  if (typeof hlc !== "string" || !HLC_PATTERN.test(hlc))
    return fail(id, "invalid_record", "hlc must match TTTTTTTTTTTTTTT:CCCC:DEVICEID");
  if (typeof deleted !== "boolean")
    return fail(id, "invalid_record", "deleted must be a boolean");
  if (typeof schema !== "string" || !schema)
    return fail(id, "invalid_record", "schema must be a non-empty string");
  if (typeof encoding !== "string" || !encoding)
    return fail(id, "invalid_record", "encoding must be a non-empty string");
  if (
    baseRev !== undefined &&
    !(typeof baseRev === "number" && Number.isSafeInteger(baseRev) && baseRev >= 0)
  )
    return fail(id, "invalid_record", "baseRev must be a non-negative integer");
  if (!("data" in input) || data === undefined)
    return fail(id, "invalid_record", "data is required (null for tombstones)");

  if (utf8Length(id) > SYNC_LIMITS.recordIdBytes)
    return fail(id, "invalid_record", `id exceeds ${SYNC_LIMITS.recordIdBytes} bytes`);
  let kind: "profile" | "pref";
  let key: string;
  if (id.startsWith("profile:") && id.length > "profile:".length) {
    kind = "profile";
    key = id.slice("profile:".length);
    if (RESERVED_PROFILES.has(key))
      return fail(id, "reserved_id", `profile "${key}" is built in and never synced`);
  } else if (id.startsWith("pref:") && id.slice(5) in PREF_VALIDATORS) {
    kind = "pref";
    key = id.slice(5);
  } else {
    return fail(id, "invalid_record", "id must be profile:<profileID> or pref:<known key>");
  }

  if (deleted && data !== null)
    return fail(id, "invalid_record", "tombstones must have data: null");
  if (!deleted && data === null)
    return fail(id, "invalid_record", "data must not be null unless deleted");

  const record: PushRecord = {
    id,
    ...(baseRev !== undefined ? { baseRev: baseRev as number } : {}),
    hlc,
    deleted,
    schema,
    encoding,
    data,
  };

  // unknown encodings (future E2E) are stored opaquely, unvalidated (§3.4)
  const opaque = encoding !== "json";
  if (!opaque && !KNOWN_SCHEMAS.has(schema))
    return fail(id, "unknown_schema", `unknown schema version "${schema}"`);

  const size = utf8Length(JSON.stringify(data));
  if (size > SYNC_LIMITS.recordPayloadBytes)
    return fail(
      id,
      "too_large",
      `payload is ${size} bytes; limit is ${SYNC_LIMITS.recordPayloadBytes}`
    );

  if (deleted || opaque) return { ok: true, record };

  if (!isPlainObject(data)) return fail(id, "invalid_record", "data must be an object");
  if (kind === "pref") {
    if (!PREF_VALIDATORS[key](data.value))
      return fail(id, "invalid_record", `invalid value for pref "${key}"`);
  } else {
    // Lighter than the real server, which parses `data` with a vendored copy
    // of the client's zod `ProxyProfile` (and stores the parsed result, with
    // unknown keys stripped). Here: profileID matches, proxyType is a string,
    // and the payload is stored as sent.
    if (typeof data.proxyType !== "string")
      return fail(id, "invalid_record", "proxyType must be a string");
    if (data.profileID !== key)
      return fail(id, "invalid_record", "data.profileID does not match the record id");
  }
  return { ok: true, record };
}

// ── OAuth state ────────────────────────────────────────────────────────

interface AuthCode {
  clientID: string;
  redirectURI: string;
  challenge: string;
  scopes: string[];
  expiresAt: number;
}

interface TokenEntry {
  kind: "access" | "refresh";
  clientID: string;
  scopes: string[];
  family: string;
  expiresAt: number;
  revoked: boolean;
  /** Refresh tokens: already exchanged once. */
  used?: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface StoredDevice extends Device {
  revokedAt: number | null;
}

interface Snapshot extends SnapshotMeta {
  records: SyncRecord[];
  seq: number;
}

// ── The store ──────────────────────────────────────────────────────────

export class SyncStore {
  private base: Required<SyncStoreOptions>;
  private opts!: Required<SyncStoreOptions>;

  // sync state
  private recs = new Map<string, SyncRecord>();
  private rev = 0;
  private purgedRev = 0;
  private devs = new Map<string, StoredDevice>();
  private snaps: Snapshot[] = [];
  private snapSeq = 0;

  // oauth state
  private codes = new Map<string, AuthCode>();
  private tokens = new Map<string, TokenEntry>();

  // test controls
  private fixedNow: number | null = null;
  private failures: Failure[] = [];
  /** Every request through `handle()`/`fetch`, oldest first. */
  log: RequestLogEntry[] = [];

  constructor(options: SyncStoreOptions = {}) {
    this.base = { ...DEFAULTS, ...options };
    this.reset();
  }

  // ── Test controls ──

  /** Back to an empty account, no tokens, the constructor's options, real time. */
  reset() {
    this.opts = { ...this.base };
    this.recs.clear();
    this.rev = 0;
    this.purgedRev = 0;
    this.devs.clear();
    this.snaps = [];
    this.snapSeq = 0;
    this.codes.clear();
    this.tokens.clear();
    this.fixedNow = null;
    this.failures = [];
    this.log = [];
  }

  /** Override options until the next `reset()`. */
  configure(options: SyncStoreOptions) {
    this.opts = { ...this.opts, ...options };
  }

  get user() {
    return { ...this.opts.user };
  }

  /** Freeze the server clock at `ms`; `null` goes back to real time. */
  setNow(ms: number | null) {
    this.fixedNow = ms;
  }

  now(): number {
    return this.fixedNow ?? Date.now();
  }

  /** One-shot error for the next matching request (queued; first match wins). */
  failNext(failure: Failure) {
    this.failures.push(failure);
  }

  /** Expire every access token issued so far (refresh tokens stay valid). */
  expireAccessTokens() {
    const past = this.now() - 1;
    for (const t of this.tokens.values()) if (t.kind === "access") t.expiresAt = past;
  }

  /**
   * Write records directly, as if pushed by another device: no validation,
   * no LWW. Each gets the next rev. Defaults: `hlc` now (counter = position),
   * device `seed-device`, live, schema 2025-01, encoding json.
   */
  seed(records: SeedRecord[]): SyncRecord[] {
    const now = this.now();
    return records.map((r, i) => {
      const deviceID = r.deviceID ?? "seed-device";
      const deleted = r.deleted ?? false;
      const rec: SyncRecord = {
        id: r.id,
        rev: ++this.rev,
        hlc: r.hlc ?? formatHlc(now, i, deviceID),
        deviceID,
        deleted,
        schema: r.schema ?? "2025-01",
        encoding: r.encoding ?? "json",
        data: deleted ? null : clone(r.data ?? null),
      };
      this.recs.set(rec.id, rec);
      return clone(rec);
    });
  }

  /** All stored records, tombstones included, by rev. */
  records(): SyncRecord[] {
    return [...this.recs.values()].sort((a, b) => a.rev - b.rev).map(clone);
  }

  get(id: string): SyncRecord | undefined {
    const r = this.recs.get(id);
    return r && clone(r);
  }

  /** The account's current rev. */
  currentRev() {
    return this.rev;
  }

  /**
   * Drop every tombstone (as the 90-day purge would) and remember the highest
   * purged rev; `changes(since)` with 0 < since < that rev then gets 410.
   */
  purgeTombstones(): number {
    let max = 0;
    for (const [id, r] of this.recs) {
      if (!r.deleted) continue;
      max = Math.max(max, r.rev);
      this.recs.delete(id);
    }
    this.purgedRev = Math.max(this.purgedRev, max);
    return this.purgedRev;
  }

  /** Logged requests whose path contains `path`. */
  requests(path?: string, method?: string): RequestLogEntry[] {
    return this.log.filter(
      (e) => (!path || e.path.includes(path)) && (!method || e.method === method)
    );
  }

  // ── OAuth ──

  /**
   * Authorization endpoint; auto-approves. Returns the redirect URL (with
   * `code` and `state`, or `error`). Throws `OAuthError` when the client or
   * redirect URI is invalid (nothing to redirect to safely).
   */
  authorize(params: {
    client_id?: string | null;
    redirect_uri?: string | null;
    code_challenge?: string | null;
    code_challenge_method?: string | null;
    state?: string | null;
    scope?: string | null;
    response_type?: string | null;
  }): string {
    const clientID = params.client_id ?? "";
    const redirectURI = params.redirect_uri ?? "";
    if (!this.opts.clientIDs.includes(clientID))
      throw new OAuthError("invalid_client", "unknown client_id");
    if (!this.opts.redirectURIAllowed(redirectURI, clientID))
      throw new OAuthError("invalid_request", "redirect_uri is not registered");

    const target = new URL(redirectURI);
    const redirectError = (error: string, description: string) => {
      target.searchParams.set("error", error);
      target.searchParams.set("error_description", description);
      if (params.state) target.searchParams.set("state", params.state);
      return target.href;
    };
    if (params.response_type !== undefined && params.response_type !== null && params.response_type !== "code")
      return redirectError("unsupported_response_type", "response_type must be code");
    if (!params.code_challenge || params.code_challenge_method !== "S256")
      return redirectError("invalid_request", "PKCE with S256 is required");

    const scopes = (params.scope ?? "")
      .split(/\s+/)
      .filter((s) => SUPPORTED_SCOPES.includes(s));
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, {
      clientID,
      redirectURI,
      challenge: params.code_challenge,
      scopes,
      expiresAt: this.now() + 10 * 60 * 1000,
    });
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    return target.href;
  }

  /** Token endpoint: `authorization_code` (PKCE) and `refresh_token` grants. */
  token(params: Record<string, string | undefined>): TokenResponse {
    const clientID = params.client_id ?? "";
    if (!this.opts.clientIDs.includes(clientID))
      throw new OAuthError("invalid_client", "unknown client_id");

    if (params.grant_type === "authorization_code") {
      const code = this.codes.get(params.code ?? "");
      if (!code) throw new OAuthError("invalid_grant", "unknown or used code");
      this.codes.delete(params.code!); // single use, even on failure
      if (code.expiresAt <= this.now()) throw new OAuthError("invalid_grant", "code expired");
      if (code.clientID !== clientID)
        throw new OAuthError("invalid_grant", "code was issued to another client");
      if (code.redirectURI !== params.redirect_uri)
        throw new OAuthError("invalid_grant", "redirect_uri mismatch");
      const verifier = params.code_verifier ?? "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
        throw new OAuthError("invalid_request", "code_verifier must be 43-128 chars");
      if (pkceChallenge(verifier) !== code.challenge)
        throw new OAuthError("invalid_grant", "PKCE verification failed");
      return this.issue(clientID, code.scopes, randomUUID());
    }

    if (params.grant_type === "refresh_token") {
      const value = params.refresh_token ?? "";
      const entry = this.tokens.get(value);
      if (!entry || entry.kind !== "refresh")
        throw new OAuthError("invalid_grant", "unknown refresh token");
      if (entry.clientID !== clientID)
        throw new OAuthError("invalid_grant", "refresh token was issued to another client");
      if (entry.used) {
        // reuse of a rotated token: assume theft, revoke the whole family
        this.revokeFamily(entry.family);
        throw new OAuthError("invalid_grant", "refresh token reused");
      }
      if (entry.revoked) throw new OAuthError("invalid_grant", "refresh token revoked");
      if (entry.expiresAt <= this.now())
        throw new OAuthError("invalid_grant", "refresh token expired");
      entry.used = true;
      return this.issue(clientID, entry.scopes, entry.family);
    }

    throw new OAuthError("unsupported_grant_type");
  }

  /**
   * Issue tokens without the authorize dance (for unit tests). Scopes
   * default to `openid email offline_access sync`.
   */
  issueTokens(
    scopes = ["openid", "email", "offline_access", "sync"],
    clientID = this.opts.clientIDs[0]
  ): TokenResponse {
    return this.issue(clientID, scopes, randomUUID());
  }

  private issue(clientID: string, scopes: string[], family: string): TokenResponse {
    const now = this.now();
    const access = `at_${randomBytes(24).toString("base64url")}`;
    this.tokens.set(access, {
      kind: "access",
      clientID,
      scopes,
      family,
      expiresAt: now + this.opts.accessTokenTtlMs,
      revoked: false,
    });
    const res: TokenResponse = {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(this.opts.accessTokenTtlMs / 1000),
      scope: scopes.join(" "),
    };
    if (scopes.includes("offline_access")) {
      const refresh = `rt_${randomBytes(24).toString("base64url")}`;
      this.tokens.set(refresh, {
        kind: "refresh",
        clientID,
        scopes,
        family,
        expiresAt: now + this.opts.refreshTokenTtlMs,
        revoked: false,
      });
      res.refresh_token = refresh;
    }
    return res;
  }

  private revokeFamily(family: string) {
    for (const t of this.tokens.values()) if (t.family === family) t.revoked = true;
  }

  /**
   * Revocation endpoint (RFC 7009): always succeeds. A refresh token also
   * revokes its family's access tokens.
   */
  revoke(token: string) {
    const entry = this.tokens.get(token);
    if (!entry) return;
    if (entry.kind === "refresh") this.revokeFamily(entry.family);
    else entry.revoked = true;
  }

  /** Userinfo endpoint. Throws `OAuthError("invalid_token")` (401). */
  userinfo(accessToken: string): { sub: string; email?: string } {
    const entry = this.validAccessToken(accessToken);
    if (!entry) throw new OAuthError("invalid_token", "invalid or expired access token");
    return entry.scopes.includes("email")
      ? { sub: this.opts.user.sub, email: this.opts.user.email }
      : { sub: this.opts.user.sub };
  }

  private validAccessToken(token: string): TokenEntry | null {
    const entry = this.tokens.get(token);
    if (!entry || entry.kind !== "access" || entry.revoked) return null;
    if (entry.expiresAt <= this.now()) return null;
    return entry;
  }

  /**
   * Checks a sync API bearer token as the real server does: 401 when
   * missing/unknown/expired, 403 without scope `sync` or for another client.
   */
  authenticate(authorization: string | undefined) {
    const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    const entry = m ? this.validAccessToken(m[1]) : null;
    if (!entry) throw new SyncProblem("invalid_token", "missing, invalid or expired access token");
    if (!entry.scopes.includes("sync") || !this.opts.clientIDs.includes(entry.clientID))
      throw new SyncProblem("invalid_token", "token lacks scope sync", 403);
  }

  // ── Devices ──

  private assertNotRevoked(deviceID: string) {
    if (this.devs.get(deviceID)?.revokedAt != null) throw new SyncProblem("device_revoked");
  }

  /** Register a device implicitly / bump `lastSeen`. */
  touchDevice(deviceID: string) {
    this.putDevice(deviceID, {});
  }

  putDevice(deviceID: string, input: DeviceInput): Device {
    this.assertNotRevoked(deviceID);
    const now = this.now();
    const d = this.devs.get(deviceID) ?? {
      id: deviceID,
      name: null,
      browser: null,
      extVersion: null,
      createdAt: now,
      lastSeen: now,
      revokedAt: null,
    };
    d.name = input.name ?? d.name;
    d.browser = input.browser ?? d.browser;
    d.extVersion = input.extVersion ?? d.extVersion;
    d.lastSeen = now;
    this.devs.set(deviceID, d);
    const { revokedAt: _, ...device } = d;
    return clone(device);
  }

  /** Live devices, most recently seen first. */
  listDevices(): Device[] {
    return [...this.devs.values()]
      .filter((d) => d.revokedAt === null)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map(({ revokedAt: _, ...d }) => clone(d));
  }

  /** Returns false for an unknown or already revoked device. */
  revokeDevice(deviceID: string): boolean {
    const d = this.devs.get(deviceID);
    if (!d || d.revokedAt !== null) return false;
    d.revokedAt = this.now();
    return true;
  }

  // ── Records ──

  /** `GET /changes`. Throws 410 `cursor_expired` when 0 < since < purged rev. */
  changes(since = 0, limit: number = SYNC_LIMITS.changesDefaultLimit): ChangesResult {
    const lim = Math.min(Math.max(limit, 1), SYNC_LIMITS.changesMaxLimit);
    // since=0 is a full resync and always allowed (as on the real server)
    if (since > 0 && since < this.purgedRev) throw new SyncProblem("cursor_expired");
    const rows = [...this.recs.values()]
      .filter((r) => r.rev > since)
      .sort((a, b) => a.rev - b.rev);
    const page = rows.slice(0, lim);
    return {
      records: page.map(clone),
      cursor: page.length ? page[page.length - 1].rev : Math.max(since, this.rev),
      hasMore: rows.length > lim,
    };
  }

  private totals() {
    let n = 0;
    let bytes = 0;
    for (const r of this.recs.values()) {
      n++;
      if (!r.deleted) bytes += utf8Length(JSON.stringify(r.data));
    }
    return { n, bytes };
  }

  /**
   * `POST /records`: each record on its own, in order. Results keep request
   * order per bucket; as on the real server, validation rejects come first.
   */
  push(records: unknown[], deviceID = "00000000-0000-4000-8000-000000000000"): PushResult {
    if (!Array.isArray(records) || records.length < 1 || records.length > SYNC_LIMITS.recordsPerPush)
      throw new SyncProblem(
        "invalid_request",
        `Body must be { records: [...] } with 1 to ${SYNC_LIMITS.recordsPerPush} records`
      );
    this.assertNotRevoked(deviceID);

    const invalid: PushResult["rejected"] = [];
    const valid: PushRecord[] = [];
    for (const input of records) {
      const v = validatePushRecord(input);
      if (v.ok) valid.push(v.record);
      else invalid.push({ id: v.id, reason: v.reason });
    }

    const result: PushResult = { accepted: [], rejected: invalid };
    for (const rec of valid) {
      if (hlcTime(rec.hlc) > this.now() + SYNC_LIMITS.clockSkewMs) {
        result.rejected.push({ id: rec.id, reason: "clock_skew" });
        continue;
      }
      const stored = this.recs.get(rec.id);
      if (stored && rec.hlc === stored.hlc) {
        result.accepted.push({ id: rec.id, rev: stored.rev });
        continue;
      }
      if (stored && rec.hlc < stored.hlc) {
        result.rejected.push({ id: rec.id, reason: "stale", current: clone(stored) });
        continue;
      }
      const data = rec.deleted ? null : rec.data;
      const size = rec.deleted ? 0 : utf8Length(JSON.stringify(data));
      const totals = this.totals();
      const n = totals.n + (stored ? 0 : 1);
      const storedSize = stored && !stored.deleted ? utf8Length(JSON.stringify(stored.data)) : 0;
      if (n > this.opts.maxRecords || totals.bytes - storedSize + size > this.opts.maxBytes) {
        result.rejected.push({ id: rec.id, reason: "quota_exceeded" });
        continue;
      }
      const row: SyncRecord = {
        id: rec.id,
        rev: ++this.rev,
        hlc: rec.hlc,
        deviceID,
        deleted: rec.deleted,
        schema: rec.schema,
        encoding: rec.encoding,
        data: clone(data),
      };
      this.recs.set(rec.id, row);
      result.accepted.push({ id: rec.id, rev: row.rev });
    }
    return result;
  }

  // ── Snapshots ──

  createSnapshot(createdBy: string, reason: SnapshotReason = "manual"): SnapshotMeta {
    const records = this.records().filter((r) => !r.deleted);
    const snap: Snapshot = {
      id: randomUUID(),
      createdAt: this.now(),
      reason,
      rev: this.rev,
      recordCount: records.length,
      createdBy,
      records,
      seq: ++this.snapSeq,
    };
    this.snaps.push(snap);
    return this.metaOf(snap);
  }

  private metaOf({ id, createdAt, reason, rev, recordCount, createdBy }: Snapshot): SnapshotMeta {
    return { id, createdAt, reason, rev, recordCount, createdBy };
  }

  /** Newest first. */
  listSnapshots(): SnapshotMeta[] {
    return [...this.snaps]
      .sort((a, b) => b.createdAt - a.createdAt || b.rev - a.rev || b.seq - a.seq)
      .map((s) => this.metaOf(s));
  }

  private findSnapshot(id: string): Snapshot {
    const snap = this.snaps.find((s) => s.id === id);
    if (!snap) throw new SyncProblem("not_found", "snapshot");
    return snap;
  }

  getSnapshot(id: string): { records: SyncRecord[] } {
    return { records: clone(this.findSnapshot(id).records) };
  }

  /**
   * Restore (§6.3): a `before-restore` snapshot, then every snapshot record
   * and a tombstone for every live record absent from it, as new writes with
   * HLC `max(maxStoredT + 1, now):0000:server`. Quotas are not enforced.
   */
  restore(id: string, deviceID: string): { rev: number; written: number } {
    this.assertNotRevoked(deviceID);
    const snap = this.findSnapshot(id);
    this.createSnapshot(deviceID, "before-restore");
    let maxT = 0;
    for (const r of this.recs.values()) maxT = Math.max(maxT, hlcTime(r.hlc));
    const hlc = formatHlc(Math.max(maxT + 1, this.now()), 0, "server");

    const keep = new Set(snap.records.map((r) => r.id));
    const live = [...this.recs.values()].filter((r) => !r.deleted && !keep.has(r.id));
    let written = 0;
    for (const r of snap.records) {
      this.recs.set(r.id, { ...clone(r), rev: ++this.rev, hlc, deviceID, deleted: false });
      written++;
    }
    for (const r of live) {
      this.recs.set(r.id, { ...r, rev: ++this.rev, hlc, deviceID, deleted: true, data: null });
      written++;
    }
    return { rev: this.rev, written };
  }

  // ── HTTP dispatch (no sockets) ──

  /** Discovery metadata (RFC 8414) for a server at `origin`. */
  metadata(origin: string) {
    const issuer = `${origin}/api/auth`;
    return {
      issuer,
      authorization_endpoint: `${origin}${OAUTH_BASE_PATH}/authorize`,
      token_endpoint: `${origin}${OAUTH_BASE_PATH}/token`,
      revocation_endpoint: `${origin}${OAUTH_BASE_PATH}/revoke`,
      userinfo_endpoint: `${origin}${OAUTH_BASE_PATH}/userinfo`,
      scopes_supported: SUPPORTED_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  /** Answer one request. Never throws. */
  handle(req: SyncRequest): SyncResponse {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const entry: RequestLogEntry = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      status: 0,
      device: req.headers["x-proxyverse-device"],
      version: req.headers["x-proxyverse-version"],
      time: Date.now(),
    };
    if (req.body) {
      try {
        entry.body = (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")
          ? Object.fromEntries(new URLSearchParams(req.body))
          : JSON.parse(req.body);
      } catch {
        entry.body = req.body;
      }
    }

    let res: SyncResponse;
    try {
      res = this.route(method, url, req);
    } catch (err) {
      if (err instanceof SyncProblem) res = problemResponse(err);
      else if (err instanceof OAuthError) res = jsonResponse(err.body, err.status);
      else
        res = problemResponse(
          new SyncProblem("unavailable", err instanceof Error ? err.message : String(err), 503)
        );
    }
    entry.status = res.status;
    if (res.status >= 400) {
      try {
        const body = JSON.parse(res.body);
        entry.code = body.code ?? body.error;
      } catch {
        /* not JSON */
      }
    }
    this.log.push(entry);
    return res;
  }

  /**
   * A `fetch` drop-in over `handle()`, for unit tests: absolute URLs only;
   * the origin is ignored except for discovery metadata.
   */
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    const body = request.body ? await request.text() : undefined;
    const res = this.handle({ method: request.method, url: request.url, headers, body });
    const nullBody = res.status === 204 || res.status === 304 || (res.status >= 300 && res.status < 400 && !res.body);
    return new Response(nullBody ? null : res.body, { status: res.status, headers: res.headers });
  };

  private takeFailure(method: string, path: string): Failure | undefined {
    const i = this.failures.findIndex(
      (f) => (!f.path || path.includes(f.path)) && (!f.method || f.method.toUpperCase() === method)
    );
    return i < 0 ? undefined : this.failures.splice(i, 1)[0];
  }

  private route(method: string, url: URL, req: SyncRequest): SyncResponse {
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const failure = this.takeFailure(method, path);
    if (failure)
      throw new SyncProblem(failure.code, failure.detail, failure.status, failure.retryAfter);

    if (path === "/.well-known/oauth-authorization-server" && method === "GET")
      return jsonResponse(this.metadata(url.origin));

    if (path.startsWith(OAUTH_BASE_PATH + "/")) return this.routeOAuth(method, path.slice(OAUTH_BASE_PATH.length), url, req);

    if (path.startsWith(SYNC_BASE_PATH + "/")) return this.routeSync(method, path.slice(SYNC_BASE_PATH.length), url, req);

    throw new SyncProblem("not_found", `no route for ${method} ${path}`);
  }

  private routeOAuth(method: string, sub: string, url: URL, req: SyncRequest): SyncResponse {
    // Clients must not send byte.vet's cookies. byte.vet's auth server
    // refuses cookie-bearing cross-site POSTs (its token endpoint did until
    // it learned to ignore them); enforcing it here keeps the client honest.
    if (method === "POST" && req.headers.cookie) {
      return jsonResponse({ message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" }, 403);
    }
    const form = () => Object.fromEntries(new URLSearchParams(req.body ?? "")) as Record<string, string>;
    if (sub === "/authorize" && method === "GET") {
      const q = url.searchParams;
      const location = this.authorize({
        client_id: q.get("client_id"),
        redirect_uri: q.get("redirect_uri"),
        code_challenge: q.get("code_challenge"),
        code_challenge_method: q.get("code_challenge_method"),
        state: q.get("state"),
        scope: q.get("scope"),
        response_type: q.get("response_type"),
      });
      // signing in leaves a session cookie, as on byte.vet
      return {
        status: 302,
        headers: {
          location,
          "cache-control": "no-store",
          "set-cookie": "e2e.session_token=signed-in; Path=/; HttpOnly; SameSite=Lax",
        },
        body: "",
      };
    }
    if (sub === "/token" && method === "POST") return jsonResponse(this.token(form()));
    if (sub === "/revoke" && method === "POST") {
      this.revoke(form().token ?? "");
      return { status: 200, headers: { "cache-control": "no-store" }, body: "" };
    }
    if (sub === "/userinfo" && (method === "GET" || method === "POST")) {
      const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
      return jsonResponse(this.userinfo(m?.[1] ?? ""));
    }
    throw new OAuthError("invalid_request", `no route for ${method} ${sub}`, 404);
  }

  private routeSync(method: string, sub: string, url: URL, req: SyncRequest): SyncResponse {
    // same order as the real server: bearer, device header, version, liveness
    this.authenticate(req.headers.authorization);
    const deviceID = req.headers["x-proxyverse-device"];
    if (!isUUID(deviceID)) throw new SyncProblem("invalid_request", "X-Proxyverse-Device must be a UUID");
    const version = req.headers["x-proxyverse-version"];
    if (!version) throw new SyncProblem("invalid_request", "X-Proxyverse-Version is required");
    if (this.opts.minVersion && compareVersions(version, this.opts.minVersion) < 0)
      throw new SyncProblem("client_too_old", `Proxyverse ${this.opts.minVersion} or newer is required to sync`);

    if (req.body && utf8Length(req.body) > SYNC_LIMITS.requestBodyBytes)
      throw new SyncProblem("invalid_request", "Request body exceeds 2 MiB");
    const json = (): unknown => {
      if (!req.body) return null;
      try {
        return JSON.parse(req.body);
      } catch {
        throw new SyncProblem("invalid_request", "Body is not valid JSON");
      }
    };

    const deviceMatch = /^\/devices\/([^/]+)$/.exec(sub);
    // PUT /devices/{id} registers the device itself
    if (!(deviceMatch && method === "PUT")) this.touchDevice(deviceID);

    if (sub === "/devices" && method === "GET") return jsonResponse(this.listDevices());

    if (deviceMatch) {
      const id = decodeURIComponent(deviceMatch[1]);
      if (!isUUID(id)) throw new SyncProblem("invalid_request", "deviceID must be a UUID");
      if (method === "PUT") {
        const body = json();
        if (!isPlainObject(body)) throw new SyncProblem("invalid_request", "Body must be an object");
        const field = (k: keyof DeviceInput) => {
          const v = body[k];
          if (v === undefined || v === null) return undefined;
          if (typeof v !== "string" || v.length > 200)
            throw new SyncProblem("invalid_request", `${k} must be a string of at most 200 characters`);
          return v;
        };
        return jsonResponse(
          this.putDevice(id, { name: field("name"), browser: field("browser"), extVersion: field("extVersion") })
        );
      }
      if (method === "DELETE") {
        if (!this.revokeDevice(id)) throw new SyncProblem("not_found", "Unknown device");
        return { status: 204, headers: {}, body: "" };
      }
    }

    if (sub === "/changes" && method === "GET") {
      const int = (name: string, fallback: number) => {
        const v = url.searchParams.get(name);
        if (v === null || v === "") return fallback;
        if (!/^\d+$/.test(v)) throw new SyncProblem("invalid_request", `${name} must be a non-negative integer`);
        return Number(v);
      };
      return jsonResponse(this.changes(int("since", 0), int("limit", SYNC_LIMITS.changesDefaultLimit)));
    }

    if (sub === "/records" && method === "POST") {
      const body = json();
      if (!isPlainObject(body) || !Array.isArray(body.records))
        throw new SyncProblem("invalid_request", "Body must be { records: [...] } with 1 to 100 records");
      return jsonResponse(this.push(body.records, deviceID));
    }

    if (sub === "/snapshots" && method === "GET") return jsonResponse(this.listSnapshots());
    if (sub === "/snapshots" && method === "POST") {
      const body = json();
      const reason = isPlainObject(body) && body.reason === "before-overwrite" ? "before-overwrite" : "manual";
      return jsonResponse(this.createSnapshot(deviceID, reason), 201);
    }

    const snap = /^\/snapshots\/([^/]+)(\/restore)?$/.exec(sub);
    if (snap) {
      const id = decodeURIComponent(snap[1]);
      if (!snap[2] && method === "GET") return jsonResponse(this.getSnapshot(id));
      if (snap[2] && method === "POST") return jsonResponse(this.restore(id, deviceID));
    }

    throw new SyncProblem("not_found", `no route for ${method} ${sub}`);
  }
}

function jsonResponse(body: unknown, status = 200): SyncResponse {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function problemResponse(p: SyncProblem): SyncResponse {
  const headers: Record<string, string> = {
    "content-type": "application/problem+json",
    "cache-control": "no-store",
  };
  if (p.status === 401 && p.code === "invalid_token") headers["www-authenticate"] = 'Bearer error="invalid_token"';
  if (p.retryAfter !== undefined || p.status === 429 || p.status === 503)
    headers["retry-after"] = String(Math.max(0, Math.ceil(p.retryAfter ?? (p.status === 429 ? 60 : 30))));
  return { status: p.status, headers, body: JSON.stringify(p.body) };
}
