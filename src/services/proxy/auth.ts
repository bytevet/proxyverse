import type { ProxyAuthInfo, ProxyProfile } from "../profile";
import type { ProfileLoader } from "./profile2config";

export class ProfileAuthProvider {
  private searchedProfiles: Set<string> = new Set();

  constructor(
    private profile: ProxyProfile,
    private profileLoader?: ProfileLoader
  ) {}

  async getAuthInfos(host: string, port: number): Promise<ProxyAuthInfo[]> {
    this.searchedProfiles.clear();
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
    ];

    // check if there's any matching host and port
    auths.map((item) => {
      if (!item) return;

      if (
        item.host == host &&
        (item.port === undefined || item.port == port) &&
        item.auth
      ) {
        ret.push(item.auth);
      }
    });

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
