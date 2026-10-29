import { beforeEach, describe, expect, it } from "vitest";
import {
  SyncProblem,
  SyncStore,
  formatHlc,
  pkceChallenge,
  type PushRecord,
} from "../../../e2e/servers/syncStore";

const NOW = 1_760_000_000_000;
const DEV_A = "11111111-1111-4111-8111-111111111111";
const DEV_B = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "http://sync.test";
const CLIENT = "proxyverse-extension";
const REDIRECT = "https://abcdef.chromiumapp.org/oauth";

const hlc = (t: number, c = 0, dev = DEV_A) => formatHlc(t, c, dev);

function profile(id: string, t = NOW, extra: Partial<PushRecord> = {}): PushRecord {
  return {
    id: `profile:${id}`,
    hlc: hlc(t),
    deleted: false,
    schema: "2025-01",
    encoding: "json",
    data: { profileID: id, profileName: id, proxyType: "direct", color: "#FFFFFF" },
    ...extra,
  };
}

const pref = (key: string, value: unknown, t = NOW): PushRecord => ({
  id: `pref:${key}`,
  hlc: hlc(t),
  deleted: false,
  schema: "2025-01",
  encoding: "json",
  data: { value },
});

let store: SyncStore;
beforeEach(() => {
  store = new SyncStore();
  store.setNow(NOW);
});

describe("push", () => {
  it("stores new records with increasing revs", () => {
    const res = store.push([profile("a"), profile("b")], DEV_A);
    expect(res).toEqual({
      accepted: [
        { id: "profile:a", rev: 1 },
        { id: "profile:b", rev: 2 },
      ],
      rejected: [],
    });
    expect(store.get("profile:a")).toMatchObject({ rev: 1, deviceID: DEV_A, deleted: false });
  });

  it("is last-writer-wins on the HLC", () => {
    store.push([profile("a", NOW - 10)], DEV_A);
    const newer = profile("a", NOW, { data: { profileID: "a", proxyType: "proxy" } });
    expect(store.push([newer], DEV_B).accepted).toEqual([{ id: "profile:a", rev: 2 }]);
    expect(store.get("profile:a")).toMatchObject({ rev: 2, hlc: newer.hlc, deviceID: DEV_B });
  });

  it("treats an equal HLC as already accepted, with the stored rev", () => {
    store.push([profile("a"), profile("b")], DEV_A);
    const res = store.push([profile("a")], DEV_A);
    expect(res.accepted).toEqual([{ id: "profile:a", rev: 1 }]);
    expect(store.currentRev()).toBe(2);
  });

  it("rejects an older HLC as stale with the stored record", () => {
    store.push([profile("a", NOW)], DEV_A);
    const res = store.push([profile("a", NOW - 1)], DEV_B);
    expect(res.accepted).toEqual([]);
    expect(res.rejected).toEqual([
      { id: "profile:a", reason: "stale", current: store.get("profile:a") },
    ]);
  });

  it("processes records on their own", () => {
    const res = store.push([profile("direct"), profile("ok")], DEV_A);
    expect(res.accepted).toEqual([{ id: "profile:ok", rev: 1 }]);
    expect(res.rejected).toEqual([{ id: "profile:direct", reason: "reserved_id" }]);
  });

  it.each([
    ["bad HLC", profile("a", NOW, { hlc: "123:0000:x" }), "invalid_record"],
    ["HLC device with bad chars", profile("a", NOW, { hlc: formatHlc(NOW, 0, "a_b") }), "invalid_record"],
    ["reserved direct", profile("direct"), "reserved_id"],
    ["reserved system", profile("system"), "reserved_id"],
    ["tombstone with data", profile("a", NOW, { deleted: true }), "invalid_record"],
    ["live record without data", profile("a", NOW, { data: null }), "invalid_record"],
    ["unknown schema", profile("a", NOW, { schema: "2099-01" }), "unknown_schema"],
    ["unknown pref key", pref("theme.color", 1), "invalid_record"],
    ["bad darkmode", pref("theme.darkmode", 3), "invalid_record"],
    ["bad language", pref("ui.language", "EN"), "invalid_record"],
    ["bad actionBehavior", pref("ui.actionBehavior", "tab"), "invalid_record"],
    ["profileID mismatch", profile("a", NOW, { data: { profileID: "b", proxyType: "direct" } }), "invalid_record"],
    ["proxyType missing", profile("a", NOW, { data: { profileID: "a" } }), "invalid_record"],
    ["too large", profile("a", NOW, { data: { profileID: "a", proxyType: "pac", pad: "x".repeat(256 * 1024) } }), "too_large"],
    ["clock skew", profile("a", NOW + 5 * 60 * 1000 + 1), "clock_skew"],
  ])("rejects %s", (_name, rec, reason) => {
    const res = store.push([rec], DEV_A);
    expect(res.accepted).toEqual([]);
    expect(res.rejected).toEqual([{ id: rec.id, reason }]);
    expect(store.records()).toEqual([]);
  });

  it("accepts valid prefs and clock skew up to 5 minutes", () => {
    const res = store.push(
      [
        pref("theme.darkmode", 2),
        pref("ui.language", "zh_CN"),
        pref("ui.actionBehavior", "sidebar"),
        profile("a", NOW + 5 * 60 * 1000),
      ],
      DEV_A
    );
    expect(res.rejected).toEqual([]);
    expect(res.accepted).toHaveLength(4);
  });

  it("stores unknown encodings opaquely, without schema validation", () => {
    const rec = profile("a", NOW, { schema: "2099-01", encoding: "e2e-v1", data: "ciphertext" });
    expect(store.push([rec], DEV_A).accepted).toEqual([{ id: "profile:a", rev: 1 }]);
    expect(store.get("profile:a")?.data).toBe("ciphertext");
  });

  it("stores tombstones", () => {
    store.push([profile("a", NOW - 1)], DEV_A);
    store.push([profile("a", NOW, { deleted: true, data: null })], DEV_A);
    expect(store.get("profile:a")).toMatchObject({ rev: 2, deleted: true, data: null });
  });

  it("rejects records over the account quota on their own, tombstones included", () => {
    store.configure({ maxRecords: 2 });
    store.push([profile("a"), profile("b", NOW, { deleted: true, data: null })], DEV_A);
    const res = store.push([profile("c"), profile("a", NOW + 1)], DEV_A);
    expect(res.rejected).toEqual([{ id: "profile:c", reason: "quota_exceeded" }]);
    expect(res.accepted).toEqual([{ id: "profile:a", rev: 3 }]);

    store.reset();
    store.setNow(NOW);
    store.configure({ maxBytes: 200 });
    const big = { profileID: "x", proxyType: "pac", pad: "x".repeat(150) };
    expect(store.push([profile("x", NOW, { data: big })], DEV_A).accepted).toHaveLength(1);
    expect(store.push([profile("y", NOW, { data: { ...big, profileID: "y" } })], DEV_A).rejected).toEqual([
      { id: "profile:y", reason: "quota_exceeded" },
    ]);
  });

  it("refuses an empty or oversized batch", () => {
    expect(() => store.push([], DEV_A)).toThrow(SyncProblem);
    const many = Array.from({ length: 101 }, (_, i) => profile(`p${i}`));
    expect(() => store.push(many, DEV_A)).toThrow(/invalid_request/);
  });
});

describe("changes", () => {
  beforeEach(() => {
    store.push(["a", "b", "c", "d", "e"].map((id) => profile(id)), DEV_A);
  });

  it("pages by rev with a cursor", () => {
    const p1 = store.changes(0, 2);
    expect(p1.records.map((r) => r.rev)).toEqual([1, 2]);
    expect(p1).toMatchObject({ cursor: 2, hasMore: true });
    const p2 = store.changes(p1.cursor, 2);
    expect(p2.records.map((r) => r.rev)).toEqual([3, 4]);
    const p3 = store.changes(p2.cursor, 2);
    expect(p3.records.map((r) => r.rev)).toEqual([5]);
    expect(p3).toMatchObject({ cursor: 5, hasMore: false });
  });

  it("returns max(since, rev) as the cursor when there is nothing new", () => {
    expect(store.changes(5)).toEqual({ records: [], cursor: 5, hasMore: false });
    expect(store.changes(9)).toEqual({ records: [], cursor: 9, hasMore: false });
  });

  it("defaults the limit to 500 and caps it at 1000", () => {
    store.seed(Array.from({ length: 1100 }, (_, i) => ({ id: `profile:s${i}`, data: {} })));
    expect(store.changes(0).records).toHaveLength(500);
    expect(store.changes(0, 5000).records).toHaveLength(1000);
  });

  it("answers 410 cursor_expired below the purged rev, but allows a full resync", () => {
    store.push([profile("a", NOW + 1, { deleted: true, data: null })], DEV_A); // rev 6
    store.push([profile("b", NOW + 1)], DEV_A); // rev 7
    expect(store.purgeTombstones()).toBe(6);
    expect(store.get("profile:a")).toBeUndefined();
    expect(() => store.changes(5)).toThrow(expect.objectContaining({ status: 410, code: "cursor_expired" }));
    expect(store.changes(6).records.map((r) => r.rev)).toEqual([7]);
    expect(store.changes(0).records.map((r) => r.id)).not.toContain("profile:a");
  });
});

describe("snapshots", () => {
  it("lists newest first, with reasons", () => {
    store.push([profile("a")], DEV_A);
    store.createSnapshot(DEV_A, "manual");
    store.setNow(NOW + 1000);
    store.createSnapshot(DEV_A, "before-overwrite");
    expect(store.listSnapshots().map((s) => s.reason)).toEqual(["before-overwrite", "manual"]);
    expect(store.listSnapshots()[0]).toMatchObject({ rev: 1, recordCount: 1, createdBy: DEV_A });
  });

  it("restores with a server HLC above every stored one, tombstoning extra records", () => {
    store.push([profile("a"), profile("b")], DEV_A);
    const snap = store.createSnapshot(DEV_A);
    // a device with a clock ahead of the server (within the skew window)
    const ahead = NOW + 60_000;
    store.push([profile("a", ahead, { data: { profileID: "a", proxyType: "proxy" } }), profile("c")], DEV_B);

    const res = store.restore(snap.id, DEV_A);
    expect(res).toEqual({ rev: 7, written: 3 });
    const serverHlc = formatHlc(ahead + 1, 0, "server");
    expect(store.get("profile:a")).toMatchObject({ rev: 5, hlc: serverHlc, deleted: false, data: { proxyType: "direct" } });
    expect(store.get("profile:b")).toMatchObject({ rev: 6, hlc: serverHlc });
    expect(store.get("profile:c")).toMatchObject({ rev: 7, hlc: serverHlc, deleted: true, data: null });
    expect(store.listSnapshots()[0]).toMatchObject({ reason: "before-restore", recordCount: 3 });
  });

  it("floors the restore HLC at now", () => {
    store.push([profile("a", NOW - 100_000)], DEV_A);
    const snap = store.createSnapshot(DEV_A);
    store.restore(snap.id, DEV_A);
    expect(store.get("profile:a")?.hlc).toBe(formatHlc(NOW, 0, "server"));
  });

  it("404s an unknown snapshot", () => {
    expect(() => store.getSnapshot("nope")).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("oauth", () => {
  const verifier = "v".repeat(43);
  function authorize(challenge = pkceChallenge(verifier), scope = "openid email offline_access sync") {
    const url = new URL(
      store.authorize({
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "st",
        scope,
      })
    );
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st");
    return url.searchParams.get("code")!;
  }
  const exchange = (code: string, v = verifier) =>
    store.token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: v });
  const refresh = (token: string) =>
    store.token({ grant_type: "refresh_token", refresh_token: token, client_id: CLIENT });

  it("exchanges a code with PKCE, once", () => {
    const code = authorize();
    const tokens = exchange(code);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "openid email offline_access sync" });
    expect(tokens.refresh_token).toBeTruthy();
    expect(store.userinfo(tokens.access_token)).toEqual(store.user);
    expect(() => exchange(code)).toThrow(/invalid_grant/);
  });

  it("rejects a PKCE mismatch", () => {
    expect(() => exchange(authorize(), "w".repeat(43))).toThrow(/invalid_grant/);
  });

  it("rejects unknown clients and redirect URIs, and requires S256", () => {
    expect(() => store.authorize({ client_id: "other", redirect_uri: REDIRECT })).toThrow(/invalid_client/);
    expect(() => store.authorize({ client_id: CLIENT, redirect_uri: "https://evil.example/oauth" })).toThrow(
      /invalid_request/
    );
    const url = new URL(store.authorize({ client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: "x", code_challenge_method: "plain" }));
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(store.authorize({ client_id: CLIENT, redirect_uri: "https://x.extensions.allizom.org/oauth", code_challenge: "x", code_challenge_method: "S256" })).toContain("code=");
  });

  it("gives no refresh token without offline_access", () => {
    expect(exchange(authorize(undefined, "openid sync")).refresh_token).toBeUndefined();
  });

  it("rotates refresh tokens; reusing a spent one revokes the family", () => {
    const first = exchange(authorize());
    const second = refresh(first.refresh_token!);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    const third = refresh(second.refresh_token!);

    expect(() => refresh(first.refresh_token!)).toThrow(/invalid_grant/);
    // the whole family is gone, including the newest tokens
    expect(() => refresh(third.refresh_token!)).toThrow(/invalid_grant/);
    expect(() => store.userinfo(third.access_token)).toThrow(/invalid_token/);
  });

  it("expires access tokens", () => {
    const tokens = exchange(authorize());
    store.setNow(NOW + 3600 * 1000);
    expect(() => store.userinfo(tokens.access_token)).toThrow(/invalid_token/);
    store.setNow(NOW);
    const fresh = refresh(tokens.refresh_token!);
    store.expireAccessTokens();
    expect(() => store.userinfo(fresh.access_token)).toThrow(/invalid_token/);
  });

  it("revokes a refresh token and its access tokens", () => {
    const tokens = exchange(authorize());
    store.revoke(tokens.refresh_token!);
    expect(() => store.userinfo(tokens.access_token)).toThrow(/invalid_token/);
    expect(() => refresh(tokens.refresh_token!)).toThrow(/invalid_grant/);
  });
});

describe("http dispatch", () => {
  let access: string;
  const headers = (device = DEV_A) => ({
    authorization: `Bearer ${access}`,
    "x-proxyverse-device": device,
    "x-proxyverse-version": "2.3.0",
    "content-type": "application/json",
  });
  const api = (path: string, init: RequestInit = {}, device = DEV_A) =>
    store.fetch(`${ORIGIN}/api/proxyverse/v1${path}`, { ...init, headers: { ...headers(device), ...init.headers } });

  beforeEach(() => {
    access = store.issueTokens().access_token;
  });

  it("serves discovery metadata", async () => {
    const res = await store.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    expect(await res.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("runs the authorize → token flow over HTTP", async () => {
    const verifier = "a".repeat(64);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      scope: "openid email offline_access sync",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state: "xyz",
    });
    const auth = await store.fetch(`${ORIGIN}/api/auth/oauth2/authorize?${q}`, { redirect: "manual" });
    expect(auth.status).toBe(302);
    const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
    const tok = await store.fetch(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier }),
    });
    expect(tok.status).toBe(200);
    const bad = await store.fetch(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("requires auth and headers", async () => {
    let res = await store.fetch(`${ORIGIN}/api/proxyverse/v1/changes?since=0`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ status: 401, code: "invalid_token", type: expect.stringContaining("#invalid_token") });

    res = await api("/changes", { headers: { "x-proxyverse-device": "nope" } });
    expect(res.status).toBe(400);

    access = store.issueTokens(["openid"]).access_token;
    expect((await api("/changes")).status).toBe(403);
  });

  it("pushes and pulls", async () => {
    const res = await api("/records", { method: "POST", body: JSON.stringify({ records: [profile("a")] }) });
    expect(await res.json()).toEqual({ accepted: [{ id: "profile:a", rev: 1 }], rejected: [] });
    const changes = await (await api("/changes?since=0")).json();
    expect(changes).toMatchObject({ cursor: 1, hasMore: false, records: [{ id: "profile:a", deviceID: DEV_A }] });
    expect(store.requests("/records", "POST")).toHaveLength(1);
  });

  it("registers devices implicitly and revokes them", async () => {
    await api("/changes?since=0", {}, DEV_B);
    const put = await api(`/devices/${DEV_A}`, { method: "PUT", body: JSON.stringify({ name: "Chrome" }) });
    expect(await put.json()).toMatchObject({ id: DEV_A, name: "Chrome", browser: null });
    const list = await (await api("/devices")).json();
    expect(list.map((d: { id: string }) => d.id).sort()).toEqual([DEV_A, DEV_B]);

    expect((await api(`/devices/${DEV_B}`, { method: "DELETE" })).status).toBe(204);
    const revoked = await api("/changes?since=0", {}, DEV_B);
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ code: "device_revoked" });
  });

  it("creates snapshots (201) and restores them", async () => {
    store.seed([{ id: "profile:a", data: { profileID: "a", proxyType: "direct" } }]);
    const created = await api("/snapshots", { method: "POST", body: JSON.stringify({ reason: "before-overwrite" }) });
    expect(created.status).toBe(201);
    const meta = await created.json();
    expect(meta).toMatchObject({ reason: "before-overwrite", recordCount: 1, createdBy: DEV_A });
    expect(await (await api(`/snapshots/${meta.id}`)).json()).toMatchObject({ records: [{ id: "profile:a" }] });
    const restored = await api(`/snapshots/${meta.id}/restore`, { method: "POST" });
    expect(await restored.json()).toEqual({ rev: 2, written: 1 });
    expect((await (await api("/snapshots")).json())[0].reason).toBe("before-restore");
  });

  it("fails the next matching request once, with Retry-After", async () => {
    store.failNext({ status: 429, code: "rate_limited", retryAfter: 7, path: "/changes" });
    expect((await api("/devices")).status).toBe(200);
    const res = await api("/changes?since=0");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toMatchObject({ code: "rate_limited", status: 429 });
    expect((await api("/changes?since=0")).status).toBe(200);
  });

  it("answers 410 over HTTP", async () => {
    store.seed([{ id: "profile:a", deleted: true }, { id: "profile:b", data: {} }]);
    store.purgeTombstones();
    expect(store.changes(0).records).toHaveLength(1);
    store.seed([{ id: "profile:c", deleted: true }]);
    store.purgeTombstones();
    const res = await api("/changes?since=2");
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: "cursor_expired" });
  });
});
