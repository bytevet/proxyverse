import http from "node:http";
import { SyncStore, type SyncStoreOptions } from "./syncStore";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, X-Proxyverse-Device, X-Proxyverse-Version",
  "access-control-expose-headers": "Retry-After, WWW-Authenticate, Location",
  "access-control-max-age": "600",
};

/**
 * The fake byte.vet (OAuth + Proxyverse sync API) over HTTP, at the real
 * paths. All logic lives in `SyncStore`; this only adapts node:http to it and
 * adds CORS.
 */
export function createSyncServer(options?: SyncStoreOptions) {
  const store = new SyncStore(options);
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers))
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      const body = Buffer.concat(chunks).toString("utf8");
      const out = store.handle({
        method: req.method ?? "GET",
        url: `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`,
        headers,
        body: body || undefined,
      });
      res.writeHead(out.status, { ...CORS_HEADERS, ...out.headers });
      res.end(out.body);
    });
  });
  return { server, store };
}
