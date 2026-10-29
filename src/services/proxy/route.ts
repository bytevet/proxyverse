import { isValid as isIP, parse } from "ipaddr.js";
import type { WithProxyInfo } from "@/adapters/base";
import {
  listProfiles,
  ProfilesStorage,
  ProxyProfile,
  ProxyServer,
  SystemProfile,
} from "../profile";
import { createProfileFinder, profileTreeIDs, type ResolvedProfile } from "./index";
import { ProfileConverter } from "./profile2config";

/**
 * What the browser reported about the route of a request:
 * - Firefox: `proxyInfo`, the proxy used (null when direct);
 * - Chrome: `ip`, the first hop's IP (no port), stale when `fromCache`.
 */
export type RouteFacts = WithProxyInfo & { ip?: string; fromCache?: boolean };

/** The route facts of webRequest details, if any. */
export function routeFactsOf(details: RouteFacts): RouteFacts | undefined {
  const { proxyInfo, ip, fromCache } = details;
  if (proxyInfo !== undefined) return { proxyInfo };
  if (ip) return fromCache ? { ip, fromCache } : { ip };
}

/**
 * The route facts of a request, if they hold for the current rules: requests
 * made before the rules were changed (at `rulesChangedAt`) went by the old
 * ones.
 */
export function currentFacts(
  request: { ts: number; route?: RouteFacts },
  rulesChangedAt: number
): RouteFacts | undefined {
  return request.ts >= rulesChangedAt ? request.route : undefined;
}

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  socks4: 1080,
  socks5: 1080,
};

/** "host:port" of a proxy server, with the browser's default port if unset. */
function serverKey(host: string, port?: number, scheme = "http") {
  return `${host.trim().toLowerCase()}:${port ?? DEFAULT_PORTS[scheme] ?? 80}`;
}

/** The proxy servers a proxy profile uses. */
function serversOf(profile: ProxyProfile): ProxyServer[] {
  if (profile.proxyType !== "proxy") return [];
  const { default: d, http, https, ftp } = profile.proxyRules;
  return [d, http, https, ftp].filter(
    (s): s is ProxyServer => !!s && s.scheme !== "direct" && !!s.host
  );
}

/** An IP literal, possibly in brackets, or undefined for a hostname. */
function parseIP(host: string) {
  const ip = host.replace(/^\[|\]$/g, "");
  return isIP(ip) ? parse(ip) : undefined;
}

const isLoopback = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  parseIP(host)?.range() === "loopback";

/**
 * Build a resolver telling which profile `active` uses for a URL: what the
 * browser reported when it leaves a single possible profile, else what the
 * rules say.
 */
export async function createRouteResolver(active: ProxyProfile) {
  const [profiles, find] = await Promise.all([
    listProfiles(),
    createProfileFinder(active),
  ]);
  const tree = profileTreeIDs(active.profileID, profiles);
  const { byServer, byIP } = indexServers(profiles);

  // the rules don't change for this resolver: predict each URL once
  const predictions = new Map<string, Promise<ResolvedProfile>>();
  const predict = (url: string) => {
    let ret = predictions.get(url);
    if (!ret) {
      ret = find(url);
      predictions.set(url, ret);
    }
    return ret;
  };

  /** The profiles the facts allow: "direct", some profiles, or unknown. */
  const candidatesOf = (
    url: URL,
    facts: RouteFacts,
    predicted: ResolvedProfile
  ): "direct" | ProxyProfile[] | undefined => {
    const { proxyInfo, ip, fromCache } = facts;
    if (proxyInfo !== undefined) {
      if (!proxyInfo || proxyInfo.type === "direct") return "direct";
      return byServer.get(serverKey(proxyInfo.host, proxyInfo.port)) ?? [];
    }

    if (!ip || fromCache) return;
    // the browser never proxies loopback hosts
    if (isLoopback(url.hostname)) return "direct";
    const matches = byIP.get(parseIP(ip)?.toNormalizedString() ?? ip);
    if (matches) return matches;

    // not a proxy IP: certainly direct when the expected route was direct,
    // or a proxy set by IP (a fallback to DIRECT). Proxies set by hostname
    // can't be told, as extensions can't resolve hosts in Chrome
    const profile = predicted.uncertain ? undefined : predicted.profile;
    if (profile?.proxyType === "direct") return "direct";
    if (profile?.proxyType === "proxy") {
      const choice = new ProfileConverter(profile).findServer(url);
      if ("direct" in choice) return "direct";
      if ("server" in choice && parseIP(choice.server.host)) return "direct";
    }
  };

  return async (url: string, facts?: RouteFacts): Promise<ResolvedProfile> => {
    const predicted = await predict(url);
    const candidates = facts && candidatesOf(new URL(url), facts, predicted);
    if (!candidates) return predicted;
    if (candidates === "direct") {
      return { profile: SystemProfile.DIRECT, uncertain: false };
    }

    // prefer the profiles the active profile routes to
    const inTree = candidates.filter((p) => tree.has(p.profileID));
    const pool = [...new Set(inTree.length ? inTree : candidates)];
    if (pool.length === 0) return predicted; // a server no profile uses
    if (pool.length === 1) return { profile: pool[0], uncertain: false };

    // ambiguous (e.g. local proxies sharing 127.0.0.1): the prediction holds
    // only as far as it's among them
    return pool.some((p) => p.profileID === predicted.profile?.profileID)
      ? predicted
      : { profile: predicted.profile, uncertain: true };
  };
}

/** Profiles by server key, and by the IP of servers set by IP. */
function indexServers(profiles: ProfilesStorage) {
  const byServer = new Map<string, ProxyProfile[]>();
  const byIP = new Map<string, ProxyProfile[]>();
  const add = (map: Map<string, ProxyProfile[]>, key: string, p: ProxyProfile) => {
    const list = map.get(key) ?? [];
    if (!list.includes(p)) map.set(key, [...list, p]);
  };

  for (const p of Object.values(profiles)) {
    for (const s of serversOf(p)) {
      add(byServer, serverKey(s.host, s.port, s.scheme), p);
      const ip = parseIP(s.host);
      if (ip) add(byIP, ip.toNormalizedString(), p);
    }
  }
  return { byServer, byIP };
}
