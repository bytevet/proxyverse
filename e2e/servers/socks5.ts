import http from "node:http";
import net from "node:net";
import { ContentStore, RequestLog, respond, type Route } from "./routeServer";

/**
 * A minimal SOCKS5 server (no auth, CONNECT only). After the handshake the
 * connection is handed to an in-process HTTP server that answers as `route`,
 * so nothing is forwarded to the real destination.
 */
export function createSocks5Server(
  route: Route,
  log: RequestLog,
  store: ContentStore
) {
  const httpServer = http.createServer((req, res) =>
    respond(route, log, store, req, res)
  );

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let stage: "greeting" | "request" = "greeting";
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === "greeting") {
        // VER, NMETHODS, METHODS...
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        buffer = buffer.subarray(2 + buffer[1]);
        socket.write(Buffer.from([0x05, 0x00])); // no authentication
        stage = "request";
      }

      // VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT
      if (buffer.length < 5) return;
      const atyp = buffer[3];
      const addrLen =
        atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? 1 + buffer[4] : -1;
      if (addrLen < 0) return socket.destroy();
      const total = 4 + addrLen + 2;
      if (buffer.length < total) return;

      const rest = buffer.subarray(total);
      socket.off("data", onData);
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      if (rest.length) socket.unshift(rest);
      httpServer.emit("connection", socket);
    };

    socket.on("data", onData);
    socket.on("error", () => socket.destroy());
  });

  // keep-alive connections would otherwise keep close() pending
  const close = server.close.bind(server);
  server.close = (callback) => {
    sockets.forEach((s) => s.destroy());
    return close(callback);
  };
  return server;
}
