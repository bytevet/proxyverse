import http from "node:http";
import net from "node:net";
import os from "node:os";
import { createHttpProxy } from "./httpProxy";
import { ContentStore, RequestLog, respond } from "./routeServer";
import { createSocks5Server } from "./socks5";

export { ContentStore, RequestLog } from "./routeServer";
export type { LogEntry, Route } from "./routeServer";

export const AUTH = { username: "e2e-user", password: "e2e-pass" };

async function listen(server: net.Server, host = "127.0.0.1"): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return (server.address() as net.AddressInfo).port;
}

/**
 * This machine's LAN IPv4 address, if any. Fake sites resolve to it, so the
 * IP Chrome reports tells direct requests from those through the proxies,
 * which listen on 127.0.0.1.
 */
export const LAN_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i?.family === "IPv4" && !i.internal)?.address;

/** A port nothing listens on, for requests that must fail to connect. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export type Servers = Awaited<ReturnType<typeof startServers>>;

/**
 * Start the servers used by one test worker:
 * - `direct`: answers *.test (mapped to 127.0.0.1) and 127.0.0.1 itself
 * - `proxyA`, `proxyB`: HTTP proxies
 * - `auth`: HTTP proxy requiring Basic auth (`AUTH`)
 * - `socks`: SOCKS5 proxy
 */
export async function startServers() {
  const log = new RequestLog();
  const store = new ContentStore();

  const direct = http.createServer((req, res) =>
    respond("direct", log, store, req, res)
  );
  const proxyA = createHttpProxy("proxyA", log, store);
  const proxyB = createHttpProxy("proxyB", log, store);
  const auth = createHttpProxy("auth", log, store, AUTH);
  const socks = createSocks5Server("socks", log, store);
  const all: net.Server[] = [direct, proxyA, proxyB, auth, socks];

  const ports = {
    // on all interfaces: fake sites (LAN IP) and loopback URLs
    direct: await listen(direct, "0.0.0.0"),
    proxyA: await listen(proxyA),
    proxyB: await listen(proxyB),
    auth: await listen(auth),
    socks: await listen(socks),
    closed: await closedPort(),
  };

  return {
    ports,
    log,
    store,
    /** URL of a fake site; *.test hosts resolve to the `direct` server. */
    url: (host: string, path = "/") => `http://${host}:${ports.direct}${path}`,
    /** URL served by the `direct` server on loopback, never proxied. */
    localURL: (path: string) => `http://127.0.0.1:${ports.direct}${path}`,
    reset() {
      log.clear();
      store.clear();
    },
    async close() {
      all.forEach((s) => {
        if (s instanceof http.Server) s.closeAllConnections();
      });
      await Promise.all(all.map((s) => new Promise((r) => s.close(r))));
    },
  };
}
