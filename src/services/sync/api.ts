import type { components } from "./api.gen";

/**
 * Client of the byte.vet sync API (spec §4, `docs/sync-api.openapi.yaml`).
 * It only speaks HTTP: retrying after rate limits or outages is up to the
 * caller, which gets `retryAfter` on the error.
 */

type Schemas = components["schemas"];
export type SyncRecord = Schemas["SyncRecord"];
export type PushRecord = Schemas["PushRecord"];
export type PushResult = Schemas["PushResult"];
export type ChangesResult = Schemas["ChangesResult"];
export type Device = Schemas["Device"];
export type DeviceInput = Schemas["DeviceInput"];
export type SnapshotMeta = Schemas["SnapshotMeta"];
export type RejectReason = Schemas["RejectReason"];
export type RestoreResult = { rev: number; written: number };

/** A problem `code` (spec §4.5), or one of the client's own. */
export type SyncErrorCode =
  | Schemas["Problem"]["code"]
  | "network" // no response at all
  | "invalid_response"; // a body we can't read, e.g. an error page

export class SyncApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: SyncErrorCode,
    readonly detail?: string,
    /** Seconds to wait before retrying, from `Retry-After`. */
    readonly retryAfter?: number
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SyncApiError";
  }
}

export type SyncApiOptions = {
  origin: string;
  deviceID: string;
  /** The extension version, sent as `X-Proxyverse-Version`. */
  version: string;
  getAccessToken(): Promise<string>;
  /** A new access token; called when the server rejects the current one. */
  refreshAccessToken(): Promise<string>;
  fetch?: typeof fetch;
};

export class SyncApi {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: SyncApiOptions) {
    this.base = `${opts.origin}/api/proxyverse/v1`;
    // unbound `fetch` throws "Illegal invocation" in browsers
    this.fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  putDevice(input: DeviceInput): Promise<Device> {
    const id = encodeURIComponent(this.opts.deviceID);
    return this.request("PUT", `/devices/${id}`, input);
  }

  async listDevices(): Promise<Device[]> {
    const devices = await this.request<unknown>("GET", "/devices");
    if (!Array.isArray(devices)) {
      throw new SyncApiError(200, "invalid_response", "no device list");
    }
    return devices as Device[];
  }

  changes(since: number, limit?: number): Promise<ChangesResult> {
    const query = new URLSearchParams({ since: String(since) });
    if (limit !== undefined) query.set("limit", String(limit));
    return this.request("GET", `/changes?${query}`);
  }

  push(records: PushRecord[]): Promise<PushResult> {
    return this.request("POST", "/records", { records });
  }

  listSnapshots(): Promise<SnapshotMeta[]> {
    return this.request("GET", "/snapshots");
  }

  createSnapshot(reason?: "before-overwrite"): Promise<SnapshotMeta> {
    return this.request("POST", "/snapshots", reason ? { reason } : undefined);
  }

  getSnapshot(id: string): Promise<{ records: SyncRecord[] }> {
    return this.request("GET", `/snapshots/${encodeURIComponent(id)}`);
  }

  restoreSnapshot(id: string): Promise<RestoreResult> {
    const path = `/snapshots/${encodeURIComponent(id)}/restore`;
    return this.request("POST", path);
  }

  /**
   * One API call. An expired access token (401 `invalid_token`) is refreshed
   * and the call retried once; a 403 `invalid_token` (wrong scope or client)
   * isn't, since a new token wouldn't help.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let res = await this.send(method, path, body, this.opts.getAccessToken);
    if (res.status === 401 && (await problemCode(res)) === "invalid_token") {
      res = await this.send(method, path, body, this.opts.refreshAccessToken);
    }
    if (!res.ok) throw await errorOf(res);
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new SyncApiError(res.status, "invalid_response", "not JSON");
    }
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    token: () => Promise<string>
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
      "X-Proxyverse-Device": this.opts.deviceID,
      "X-Proxyverse-Version": this.opts.version,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    try {
      return await this.fetch(`${this.base}${path}`, {
        // bearer auth only: no byte.vet cookies (see NO_COOKIES in auth.ts)
        credentials: "omit",
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new SyncApiError(0, "network", String(e));
    }
  }
}

type Problem = { code?: unknown; detail?: unknown };

// The problem body of an error response, read from a clone so the response
// can still be read by `errorOf`.
async function readProblem(res: Response): Promise<Problem | undefined> {
  const type = res.headers.get("Content-Type") ?? "";
  if (!/^application\/(problem\+)?json\b/i.test(type)) return undefined;
  try {
    const body: unknown = await res.clone().json();
    return typeof body === "object" && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
}

async function problemCode(res: Response): Promise<unknown> {
  return (await readProblem(res))?.code;
}

async function errorOf(res: Response): Promise<SyncApiError> {
  const problem = await readProblem(res);
  // e.g. a proxy's error page: the status still tells what happened
  const code =
    typeof problem?.code === "string"
      ? (problem.code as SyncErrorCode)
      : "invalid_response";
  const detail =
    typeof problem?.detail === "string" ? problem.detail : res.statusText;
  return new SyncApiError(
    res.status,
    code,
    detail || undefined,
    retryAfterSeconds(res.headers.get("Retry-After"))
  );
}

// `Retry-After` is either seconds or an HTTP date (RFC 9110 §10.2.3)
function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
