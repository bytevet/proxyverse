import type { ProxyAuthInfo, ProxyProfile } from "../profile";
import type { ProfileLoader } from "./profile2config";

// Browsers report the challenger host lower-cased, while profiles keep it as
// typed. IPv6 hosts may come with or without brackets.
const normalizeHost = (host: string) =>
  host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");

/**
 * Credentials a profile gets at runtime rather than from storage (e.g. True
 * Privacy Proxy's token), for the servers it has no stored ones for. One per
 * attempt so far: the browser asks again when the last ones were refused.
 */
export type DynamicAuth = (
  profile: ProxyProfile,
  attempt: number
) => Promise<ProxyAuthInfo[]>;

export class ProfileAuthProvider {
  private searchedProfiles: Set<string> = new Set();
  private attempt = 0;

  constructor(
    private profile: ProxyProfile,
    private profileLoader?: ProfileLoader,
    private dynamicAuth?: DynamicAuth
  ) {}

  async getAuthInfos(
    host: string,
    port: number,
    attempt = 0
  ): Promise<ProxyAuthInfo[]> {
    this.searchedProfiles.clear();
    this.attempt = attempt;
    return this.getAuthInfosForProfile(host, port, this.profile);
  }

  private async getAuthInfosForProfile(
    host: string,
    port: number,
    profile: ProxyProfile
  ): Promise<ProxyAuthInfo[]> {
    // avoid infinite loop
    if (this.searchedProfiles.has(profile.profileID)) {
      return [];
    }
    this.searchedProfiles.add(profile.profileID);

    switch (profile.proxyType) {
      case "proxy":
        return this.getAuthInfosForProxyProfile(host, port, profile);
      case "auto":
        return this.getAuthInfosForAutoProfile(host, port, profile);

      default:
        return [];
    }
  }

  private async getAuthInfosForProxyProfile(
    host: string,
    port: number,
    profile: ProxyProfile & { proxyType: "proxy" }
  ): Promise<ProxyAuthInfo[]> {
    const ret: ProxyAuthInfo[] = [];
    const auths = [
      profile.proxyRules.default,
      profile.proxyRules.ftp,
      profile.proxyRules.http,
      profile.proxyRules.https,
      ...(profile.failover ?? []),
    ];

    // check if there's any matching host and port
    const challenger = normalizeHost(host);
    let needsDynamic = false;
    auths.forEach((item) => {
      if (!item) return;
      if (
        normalizeHost(item.host) != challenger ||
        (item.port !== undefined && item.port != port)
      ) {
        return;
      }
      if (item.auth) ret.push(item.auth);
      else needsDynamic = true;
    });

    if (needsDynamic && this.dynamicAuth) {
      ret.push(...(await this.dynamicAuth(profile, this.attempt)));
    }
    return ret;
  }

  private async getAuthInfosForAutoProfile(
    host: string,
    port: number,
    profile: ProxyProfile & { proxyType: "auto" }
  ): Promise<ProxyAuthInfo[]> {
    const ret: ProxyAuthInfo[] = [];

    for (const rule of profile.rules) {
      if (rule.type == "disabled") {
        continue;
      }

      const profile = await this.loadProfile(rule.profileID);
      if (!profile) {
        continue;
      }

      const authInfos = await this.getAuthInfosForProfile(host, port, profile);
      authInfos && ret.push(...authInfos);
    }

    // don't forget the default profile
    const defaultProfile = await this.loadProfile(profile.defaultProfileID);
    if (defaultProfile) {
      const authInfos = await this.getAuthInfosForProfile(
        host,
        port,
        defaultProfile
      );
      authInfos && ret.push(...authInfos);
    }

    return ret;
  }

  private async loadProfile(
    profileID: string
  ): Promise<ProxyProfile | undefined> {
    if (!this.profileLoader) {
      return;
    }

    return await this.profileLoader(profileID);
  }
}
