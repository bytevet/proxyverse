import type { IncomingMessage, ServerResponse } from "node:http";

/** Which server handled a request: "direct" or the name of a test proxy. */
export type Route = string;

export type LogEntry = {
  route: Route;
  method: string;
  host: string; // hostname without port
  url: string;
  auth?: "none" | "ok" | "bad"; // proxy auth attempts on auth proxies
  time: number;
};

export class RequestLog {
  entries: LogEntry[] = [];

  add(entry: Omit<LogEntry, "time">) {
    this.entries.push({ ...entry, time: Date.now() });
  }

  forHost(host: string) {
    return this.entries.filter((e) => e.host === host);
  }

  clear() {
    this.entries = [];
  }
}

export type Content = { type: string; body: string; status?: number };

/**
 * Responses shared by all servers, keyed by path. Unknown paths answer with a
 * small HTML page. Tests register pages (e.g. a page with sub-resources) here.
 */
export class ContentStore {
  private content = new Map<string, Content>();

  set(path: string, content: Content) {
    this.content.set(path, content);
  }

  get(path: string) {
    return this.content.get(path);
  }

  clear() {
    this.content.clear();
  }
}

export function hostOf(req: IncomingMessage): { host: string; url: string } {
  // proxies receive absolute URLs, direct servers only a path
  const raw = req.url ?? "/";
  const url = raw.startsWith("http")
    ? new URL(raw)
    : new URL(raw, `http://${req.headers.host ?? "unknown"}`);
  return { host: url.hostname, url: url.href };
}

/**
 * Answer a request on behalf of `route`. Every response carries an `x-route`
 * header, so tests can tell which proxy (or none) served it.
 */
export function respond(
  route: Route,
  log: RequestLog,
  store: ContentStore,
  req: IncomingMessage,
  res: ServerResponse,
  auth?: LogEntry["auth"]
) {
  const { host, url } = hostOf(req);
  log.add({ route, method: req.method ?? "GET", host, url, auth });

  const content = store.get(new URL(url).pathname) ?? {
    type: "text/html",
    body: `<!doctype html><title>${route}</title><p>route:${route} host:${host}</p>`,
  };
  res.writeHead(content.status ?? 200, {
    "content-type": content.type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-route": route,
  });
  res.end(content.body);
}
