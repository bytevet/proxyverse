import http from "node:http";
import { ContentStore, RequestLog, respond, type Route } from "./routeServer";

export type ProxyAuth = { username: string; password: string };

/**
 * An HTTP proxy that answers requests itself instead of forwarding them.
 * CONNECT tunnels are only logged, as tests just need to know which proxy
 * was picked for HTTPS URLs.
 */
export function createHttpProxy(
  route: Route,
  log: RequestLog,
  store: ContentStore,
  auth?: ProxyAuth
) {
  const expected =
    auth &&
    "Basic " +
      Buffer.from(`${auth.username}:${auth.password}`).toString("base64");

  const checkAuth = (header?: string) => {
    if (!expected) return undefined;
    if (!header) return "none" as const;
    return header === expected ? ("ok" as const) : ("bad" as const);
  };

  const server = http.createServer((req, res) => {
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
  });

  server.on("connect", (req, socket) => {
    const [host] = (req.url ?? "").split(":");
    log.add({ route, method: "CONNECT", host, url: req.url ?? "" });
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });

  return server;
}
