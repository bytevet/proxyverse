import * as inner from "@/services/profile";
import {
  ConfigFile,
  HexedColor,
  Port,
  ProfileAuthSwitch,
  ProfileSimple,
  ProxyProfile,
  ProxyServer,
} from "./definition";

/**
 * Convert the raw profiles to JSON string.
 *
 * @param rawProfiles - The raw profiles
 * @returns JSON string
 */
export const config2json = (rawProfiles: inner.ProfilesStorage): string => {
  const encoded = ConfigFile.encode({
    version: "2025-01",
    profiles: Object.values(rawProfiles)
      .map(exportProfile)
      .filter((p) => p !== undefined),
  });

  return JSON.stringify(encoded, null, 2);
};

const exportProfile = (p: inner.ProxyProfile): ProxyProfile | undefined => {
  let ret: ProxyProfile | undefined = undefined;
  const hexedColor = p.color as HexedColor;
  switch (p.proxyType) {
    case "pac":
      ret = {
        ...p,
        color: hexedColor,
        proxyType: "pac",
        pacScript: {
          data: p.pacScript.data || "",
        },
      } as ProfileSimple;
      break;
    case "proxy":
      ret = {
        ...p,
        color: hexedColor,
        proxyType: "proxy",
        proxyRules: {
          bypassList: p.proxyRules.bypassList,
          default: exportProxyServer(p.proxyRules.default),

          http: p.proxyRules.http && exportProxyServer(p.proxyRules.http),
          https: p.proxyRules.https && exportProxyServer(p.proxyRules.https),
          ftp: p.proxyRules.ftp && exportProxyServer(p.proxyRules.ftp),
        },
      } as ProfileSimple;
      break;

    case "auto":
      ret = {
        ...p,
        color: hexedColor,
        proxyType: "auto",
        rules: p.rules.map((r) => ({
          type: r.type,
          condition: r.condition,
          profileID: r.profileID,
        })),
        defaultProfileID: p.defaultProfileID,
      } as ProfileAuthSwitch;
      break;

    default:
    // not supported, just ignore
  }

  return ret;
};

const exportProxyServer = (p: inner.ProxyServer): ProxyServer => {
  const ret: ProxyServer = {
    host: p.host,
    scheme: p.scheme,
  };

  if (p.port) {
    ret.port = p.port as Port;
  }
  if (p.auth) {
    ret.auth = {
      username: p.auth.username,
      password: p.auth.password,
    };
  }

  return ret;
};
