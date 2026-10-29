import { describe, expect, test, vi } from "vitest";
import { SyncApi, SyncApiError } from "@/services/sync/api";
import { jsonResponse } from "../../helpers";

const ORIGIN = "https://sync.example";
const DEVICE = "7b1e0000-0000-4000-8000-000000000001";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

/** A fake fetch answering from a queue, recording each call. */
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const next = responses.shift();
    if (!next) throw Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = jsonResponse;

const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: code, status, code, detail: `${code} happened` }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } }
  );

function client(f: ReturnType<typeof fakeFetch>, tokens = ["t1", "t2"]) {
  const refresh = vi.fn(async () => tokens[1]);
  const api = new SyncApi({
    origin: ORIGIN,
    deviceID: DEVICE,
    version: "2.3.0",
    getAccessToken: async () => tokens[0],
    refreshAccessToken: refresh,
    fetch: f.fetch,
  });
  return { api, refresh };
}

const record = {
  id: "pref:ui.language",
  rev: 3,
  hlc: `001730023456789:0000:${DEVICE}`,
  deviceID: DEVICE,
  deleted: false,
  schema: "2025-01",
  encoding: "json",
  data: { value: "en" },
};

describe("SyncApi requests", () => {
  test("sends auth, device and version headers", async () => {
    const f = fakeFetch(json({ records: [record], cursor: 3, hasMore: false }));
    const { api } = client(f);
    expect(await api.changes(0)).toEqual({ records: [record], cursor: 3, hasMore: false });
    expect(f.calls[0]).toEqual({
      url: `${ORIGIN}/api/proxyverse/v1/changes?since=0`,
      method: "GET",
      headers: {
        Authorization: "Bearer t1",
        "X-Proxyverse-Device": DEVICE,
        "X-Proxyverse-Version": "2.3.0",
      },
      body: undefined,
    });
  });

  test("maps each method to its endpoint", async () => {
    const meta = { id: "s1", createdAt: 1, reason: "manual", rev: 3, recordCount: 1, createdBy: DEVICE };
    const device = { id: DEVICE, name: "Chrome", browser: "chrome", extVersion: "2.3.0", createdAt: 1, lastSeen: 2 };
    const f = fakeFetch(
      json(device),
      json({ records: [], cursor: 9, hasMore: false }),
      json({ accepted: [{ id: record.id, rev: 4 }], rejected: [] }),
      json([meta]),
      json(meta, 201),
      json(meta, 201),
      json({ rev: 10, written: 1 })
    );
    const { api } = client(f);
    const { rev: _, deviceID: __, ...push } = record;

    await api.putDevice({ name: "Chrome" });
    await api.changes(5);
    expect(await api.push([push])).toEqual({ accepted: [{ id: record.id, rev: 4 }], rejected: [] });
    expect(await api.listSnapshots()).toEqual([meta]);
    await api.createSnapshot();
    await api.createSnapshot("before-overwrite");
    expect(await api.restoreSnapshot("s/1")).toEqual({ rev: 10, written: 1 });

    const base = `${ORIGIN}/api/proxyverse/v1`;
    expect(f.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["PUT", `${base}/devices/${DEVICE}`, { name: "Chrome" }],
      ["GET", `${base}/changes?since=5`, undefined],
      ["POST", `${base}/records`, { records: [push] }],
      ["GET", `${base}/snapshots`, undefined],
      ["POST", `${base}/snapshots`, undefined],
      ["POST", `${base}/snapshots`, { reason: "before-overwrite" }],
      ["POST", `${base}/snapshots/s%2F1/restore`, undefined],
    ]);
    expect(f.calls[0].headers["Content-Type"]).toBe("application/json");
    expect(f.calls[1].headers).not.toHaveProperty("Content-Type");
  });

});

describe("SyncApi errors", () => {
  test("throws problem details with their code", async () => {
    const { api } = client(fakeFetch(problem(410, "cursor_expired")));
    const err = await api.changes(1).catch((e) => e);
    expect(err).toBeInstanceOf(SyncApiError);
    expect(err).toMatchObject({ status: 410, code: "cursor_expired", detail: "cursor_expired happened" });
    expect(err.retryAfter).toBeUndefined();
  });

  test("exposes Retry-After in seconds, without retrying", async () => {
    const f = fakeFetch(
      problem(429, "rate_limited", { "Retry-After": "120" }),
      problem(503, "unavailable", { "Retry-After": new Date(Date.now() + 30_000).toUTCString() })
    );
    const { api } = client(f);
    await expect(api.changes(0)).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 120 });
    const err = await api.changes(0).catch((e) => e);
    expect(err.code).toBe("unavailable");
    expect(err.retryAfter).toBeGreaterThan(25);
    expect(err.retryAfter).toBeLessThanOrEqual(30);
    expect(f.calls).toHaveLength(2);
  });

  test("a network failure is code network, status 0", async () => {
    const { api } = client(fakeFetch(new TypeError("Failed to fetch")));
    await expect(api.listSnapshots()).rejects.toMatchObject({ status: 0, code: "network" });
  });

  test("an unreadable body is code invalid_response", async () => {
    const f = fakeFetch(
      new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
      new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    const { api } = client(f);
    await expect(api.changes(0)).rejects.toMatchObject({ status: 502, code: "invalid_response" });
    await expect(api.changes(0)).rejects.toMatchObject({ status: 200, code: "invalid_response" });
  });
});

describe("SyncApi token refresh", () => {
  test("refreshes once on 401 invalid_token and retries", async () => {
    const f = fakeFetch(problem(401, "invalid_token"), json([]));
    const { api, refresh } = client(f);
    expect(await api.listSnapshots()).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(f.calls.map((c) => c.headers.Authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  test("gives up when the retry is refused too", async () => {
    const f = fakeFetch(problem(401, "invalid_token"), problem(401, "invalid_token"));
    const { api, refresh } = client(f);
    await expect(api.listSnapshots()).rejects.toMatchObject({ status: 401, code: "invalid_token" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(f.calls).toHaveLength(2);
  });

  test("resends the body on retry", async () => {
    const f = fakeFetch(problem(401, "invalid_token"), json({ accepted: [], rejected: [] }));
    const { api } = client(f);
    await api.push([]);
    expect(f.calls[1].body).toEqual({ records: [] });
  });

  test("doesn't refresh on 403 invalid_token", async () => {
    const f = fakeFetch(problem(403, "invalid_token"));
    const { api, refresh } = client(f);
    await expect(api.listSnapshots()).rejects.toMatchObject({ status: 403, code: "invalid_token" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a refresh failure propagates", async () => {
    const f = fakeFetch(problem(401, "invalid_token"));
    const { api, refresh } = client(f);
    refresh.mockRejectedValueOnce(Error("invalid_grant"));
    await expect(api.listSnapshots()).rejects.toThrow("invalid_grant");
  });
});
