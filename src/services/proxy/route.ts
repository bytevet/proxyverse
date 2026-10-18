import { IPv4, IPv6, isValid as isIP, isValidCIDR, parse, parseCIDR } from "ipaddr.js";
import {
  listProfiles,
  ProfileSimple,
  ProfilesStorage,
  ProxyProfile,
  ProxyServer,
  SystemProfile,
} from "../profile";
import { createProfileFinder, profileTreeIDs, type ResolvedProfile } from "./index";
import { isInNet, isPlainHostName, shExpMatch, UNKNOWN } from "./pacSimulator";

/**
 * What the browser reported about the route of a request: it went direct, or
 * through one of `servers` (server keys, see `serverKey`). Chrome only tells
 * the proxy's IP, which several servers may share (e.g. local proxies on
 * 127.0.0.1 with different ports).
 */
export type Observation = { direct: true } | { servers: string[] };

type ProxyProfileSimple = ProfileSimple & { proxyType: "proxy" };

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  socks4: 1080,
  socks5: 1080,
};

/** "host:port" of a proxy server, with the browser's default port if unset. */
export function serverKey(server: ProxyServer): string {
  const port = server.port ?? DEFAULT_PORTS[server.scheme ?? "http"] ?? 80;
  return `${server.host.toLowerCase()}:${port}`;
}

/** The proxy servers a proxy profile uses. */
function serversOf(profile: ProxyProfile): ProxyServer[] {
  if (profile.proxyType !== "proxy") return [];
  const { default: d, http, https, ftp } = profile.proxyRules;
  return [d, http, https, ftp].filter(
    (s): s is ProxyServer => !!s && s.scheme !== "direct" && !!s.host
  );
}

export type ServerChoice =
  | { server: ProxyServer }
  | { direct: true }
  | { uncertain: true };

/**
 * The server a proxy profile uses for `url`, mirroring its generated PAC
 * script: the bypass list first, then the per-scheme servers, then the
 * default one.
 */
export function serverFor(profile: ProxyProfileSimple, url: URL): ServerChoice {
  const host = url.hostname;
  for (const item of profile.proxyRules.bypassList) {
    if (item === "<local>") {
      if (isPlainHostName(host)) return { direct: true };
    } else if (isValidCIDR(item)) {
      const [ip, prefix] = parseCIDR(item);
      const mask = (ip.kind() === "ipv4" ? IPv4 : IPv6)
        .subnetMaskFromPrefixLength(prefix)
        .toNormalizedString();
      const inNet = isInNet(host, ip.toString(), mask);
      if (inNet === UNKNOWN) return { uncertain: true };
      if (inNet) return { direct: true };
    } else if (shExpMatch(host, item)) {
      return { direct: true };
    }
  }

  // websockets are resolved like http(s)
  const scheme = url.protocol.replace(/^ws(s?):$/, "http$1:").slice(0, -1);
  const { proxyRules } = profile;
  const server =
    (scheme === "ftp" && proxyRules.ftp) ||
    (scheme === "https" && proxyRules.https) ||
    (scheme === "http" && proxyRules.http) ||
    proxyRules.default;
  return server.scheme === "direct" ? { direct: true } : { server };
}

const normalizeIP = (ip: string) => {
  try {
    return parse(ip.replace(/^\[|\]$/g, "")).toNormalizedString();
  } catch {
    return ip;
  }
};

const isIPLiteral = (host: string) => isIP(host.replace(/^\[|\]$/g, ""));

const isLoopback = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  (isIPLiteral(host) &&
    parse(host.replace(/^\[|\]$/g, "")).range() === "loopback");

/** The parts of webRequest details telling the route of a request. */
export type RouteDetails = {
  url: string;
  ip?: string;
  fromCache?: boolean;
  // Firefox only: the proxy used, null when direct
  proxyInfo?: { host: string; port: number; type: string } | null;
};

/**
 * Turns what the browser reports about requests into observations of their
 * route. Runs in the background.
 */
export class RouteObserver {
  private context?: Promise<{
    find?: (url: string) => Promise<ResolvedProfile>;
    servers: ProxyServer[];
  }>;

  constructor(private activeProfile: () => Promise<ProxyProfile | undefined>) {}

  /** Forget the cached profiles, e.g. after they changed. */
  invalidate() {
    this.context = undefined;
  }

  async observe(details: RouteDetails): Promise<Observation | undefined> {
    // Firefox reports the proxy used
    if (details.proxyInfo !== undefined) {
      const info = details.proxyInfo;
      return !info || info.type === "direct"
        ? { direct: true }
        : { servers: [`${info.host.toLowerCase()}:${info.port}`] };
    }

    // Chrome reports the IP of the first hop, stale for cached responses.
    // Only proxies set by IP can be matched: extensions can't resolve hosts
    if (!details.ip || details.fromCache) return;
    // the browser never proxies loopback hosts
    if (isLoopback(new URL(details.url).hostname)) return { direct: true };
    const ip = normalizeIP(details.ip);
    const { find, servers } = await this.getContext();

    const matches = servers
      .filter((s) => isIPLiteral(s.host) && normalizeIP(s.host) === ip)
      .map(serverKey);
    if (matches.length) return { servers: [...new Set(matches)] };

    const predicted = find ? await find(details.url) : undefined;
    const choice =
      predicted?.profile?.proxyType === "proxy" && !predicted.uncertain
        ? serverFor(predicted.profile, new URL(details.url))
        : undefined;

    // not a known proxy IP: certainly direct when the expected route was
    // direct, or a proxy whose IP is known (a fallback to DIRECT)
    const expectedDirect =
      (predicted?.profile?.proxyType === "direct" && !predicted.uncertain) ||
      (choice && "direct" in choice) ||
      (choice && "server" in choice && isIPLiteral(choice.server.host));
    return expectedDirect ? { direct: true } : undefined;
  }

  private getContext() {
    this.context ??= (async () => {
      const [active, profiles] = await Promise.all([
        this.activeProfile(),
        listProfiles(),
      ]);
      return {
        find: active ? await createProfileFinder(active) : undefined,
        servers: Object.values(profiles).flatMap(serversOf),
      };
    })();
    return this.context;
  }
}

/**
 * Build a resolver telling which profile `active` uses for a URL: what the
 * browser observed when known, else what the rules say.
 */
export async function createRouteResolver(active: ProxyProfile) {
  const [profiles, find] = await Promise.all([
    listProfiles(),
    createProfileFinder(active),
  ]);
  const byServer = profilesByServer(profiles);
  const tree = profileTreeIDs(active.profileID, profiles);

  return async (
    url: string,
    observed?: Observation
  ): Promise<ResolvedProfile> => {
    const predicted = await find(url);
    if (!observed) return predicted;
    if ("direct" in observed) {
      return { profile: SystemProfile.DIRECT, uncertain: false };
    }

    // the profiles that may have been used, preferring those the active
    // profile routes to
    const candidates = observed.servers.flatMap((key) => byServer.get(key) ?? []);
    const inTree = candidates.filter((p) => tree.has(p.profileID));
    const pool = [...new Set(inTree.length ? inTree : candidates)];
    if (pool.length === 0) return predicted; // a server no profile uses
    if (pool.length === 1) return { profile: pool[0], uncertain: false };

    // ambiguous: confirmed only as far as the prediction is among them
    return pool.some((p) => p.profileID === predicted.profile?.profileID)
      ? predicted
      : { profile: predicted.profile, uncertain: true };
  };
}

function profilesByServer(profiles: ProfilesStorage) {
  const ret = new Map<string, ProxyProfile[]>();
  for (const p of Object.values(profiles)) {
    for (const key of new Set(serversOf(p).map(serverKey))) {
      ret.set(key, [...(ret.get(key) ?? []), p]);
    }
  }
  return ret;
}
