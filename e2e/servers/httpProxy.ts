import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { ContentStore, RequestLog, respond, type Route } from "./routeServer";

export type ProxyAuth = { username: string; password: string };
/** Checks Basic credentials itself, e.g. tokens the fake byte.vet issued. */
export type ProxyAuthCheck = (username: string, password: string) => boolean;

/** A self-signed certificate for `*.proxy.internal` (test fixture). */
const TLS = {
  key: fs.readFileSync(path.join(import.meta.dirname, "certs/proxy.key")),
  cert: fs.readFileSync(path.join(import.meta.dirname, "certs/proxy.crt")),
};

/**
 * An HTTP proxy that answers requests itself instead of forwarding them.
 * CONNECT tunnels are only logged, as tests just need to know which proxy
 * was picked for HTTPS URLs.
 */
export function createHttpProxy(
  route: Route,
  log: RequestLog,
  store: ContentStore,
  auth?: ProxyAuth | ProxyAuthCheck,
  { tls = false } = {}
) {
  const check: ProxyAuthCheck | undefined =
    typeof auth === "function"
      ? auth
      : auth &&
        ((u, p) => u === auth.username && p === auth.password);

  const checkAuth = (header?: string) => {
    if (!check) return undefined;
    if (!header) return "none" as const;
    const m = /^Basic\s+(\S+)$/i.exec(header);
    const [u, ...rest] = m ? Buffer.from(m[1], "base64").toString().split(":") : [];
    return m && check(u, rest.join(":")) ? ("ok" as const) : ("bad" as const);
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const result = checkAuth(req.headers["proxy-authorization"]);
    if (result && result !== "ok") {
      log.add({
        route,
        method: req.method ?? "GET",
        host: new URL(req.url ?? "http://unknown/").hostname,
        url: req.url ?? "",
        auth: result,
      });
      res.writeHead(407, {
        "proxy-authenticate": 'Basic realm="e2e"',
        "content-type": "text/plain",
      });
      res.end("proxy authentication required");
      return;
    }
    respond(route, log, store, req, res, result);
  };
  // an HTTPS proxy: the browser talks TLS to the proxy itself
  const server = tls
    ? https.createServer(TLS, handler)
    : http.createServer(handler);

  server.on("connect", (req, socket) => {
    const [host] = (req.url ?? "").split(":");
    log.add({ route, method: "CONNECT", host, url: req.url ?? "" });
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });

  return server;
}
