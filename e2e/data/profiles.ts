import type {
  AutoSwitchRule,
  ProfileAutoSwitch,
  ProfileSimple,
  ProxyServer,
} from "@/services/profile";
import type { Servers } from "../servers";

type Meta = { profileID: string; profileName?: string; color?: string };

const meta = ({ profileID, profileName, color }: Meta) => ({
  profileID,
  profileName: profileName ?? profileID,
  color: color ?? "#3370ff",
});

export const server = (
  port: number,
  scheme: ProxyServer["scheme"] = "http",
  auth?: ProxyServer["auth"]
): ProxyServer => ({ scheme, host: "127.0.0.1", port, auth });

type ProxyRules = {
  default: ProxyServer;
  http?: ProxyServer;
  https?: ProxyServer;
  ftp?: ProxyServer;
  bypassList?: string[];
};

export function proxyProfile(m: Meta, rules: ProxyRules): ProfileSimple {
  return {
    ...meta(m),
    proxyType: "proxy",
    proxyRules: { ...rules, bypassList: rules.bypassList ?? [] },
  };
}

export function pacProfile(
  m: Meta,
  pacScript: ProfileSimple["pacScript"] & object
): ProfileSimple {
  return { ...meta(m), proxyType: "pac", pacScript };
}

export function autoProfile(
  m: Meta,
  rules: AutoSwitchRule[],
  defaultProfileID = "direct"
): ProfileAutoSwitch {
  return { ...meta(m), proxyType: "auto", rules, defaultProfileID };
}

export const rule = (
  type: AutoSwitchRule["type"],
  condition: string,
  profileID: string
): AutoSwitchRule => ({ type, condition, profileID });

/** PAC script routing hosts ending with `suffix` through `port`. */
export const pacRouting = (suffix: string, port: number) =>
  `function FindProxyForURL(url, host) {
  if (dnsDomainIs(host, "${suffix}")) return "PROXY 127.0.0.1:${port}";
  return "DIRECT";
}`;

/** The proxy profiles most tests need, pointing at the worker's servers. */
export function standardProfiles(servers: Servers) {
  const { ports } = servers;
  return {
    proxyA: proxyProfile(
      { profileID: "proxyA", profileName: "Proxy A", color: "#e8a33d" },
      { default: server(ports.proxyA) }
    ),
    proxyB: proxyProfile(
      { profileID: "proxyB", profileName: "Proxy B", color: "#5b8def" },
      { default: server(ports.proxyB) }
    ),
    socks: proxyProfile(
      { profileID: "socks", profileName: "Socks", color: "#7ad39e" },
      { default: server(ports.socks, "socks5") }
    ),
  };
}
