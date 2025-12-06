import { generate as generateJS } from "escodegen";
import type { Program, Statement } from "acorn";
import {
  AutoSwitchRule,
  ProfileAutoSwitch,
  ProxyProfile,
  ProxyServer,
  SystemProfile,
} from "../profile";
import { IPv4, IPv6, isValidCIDR, parseCIDR } from "ipaddr.js";
import {
  newProxyString,
  PACScriptHelper,
  parsePACScript,
} from "./scriptHelper";
import { ProxyConfig } from "@/adapters";
import { isInNet, shExpMatch, UNKNOWN } from "./pacSimulator";

export type ProfileLoader = (
  profileID: string
) => Promise<ProxyProfile | undefined>;

export class ProfileConverter {
  constructor(
    public readonly profile: ProxyProfile,
    private profileLoader?: ProfileLoader
  ) {}

  async toProxyConfig(): Promise<ProxyConfig> {
    switch (this.profile.proxyType) {
      case "direct":
      case "system":
        return { mode: this.profile.proxyType };

      case "pac":
        return {
          mode: "pac_script",
          pacScript: this.profile.pacScript,
        };

      default:
        return {
          mode: "pac_script",
          pacScript: {
            data: await this.toPAC(),
          },
        };
    }
  }

  async findProfile(
    url: URL
  ): Promise<{ profile: ProfileConverter | undefined; isConfident: boolean }> {
    switch (this.profile.proxyType) {
      case "auto":
        return await this.findProfileForAutoProfile(url);

      default:
        return { profile: this, isConfident: true };
    }
  }

  /**
   * Convert the `auto` profile to a PAC script
   * @returns the PAC script
   */
  async toPAC() {
    const astProgram: Program = {
      type: "Program",
      sourceType: "script",
      body: await this.genStatements(),
      start: 0, // dummy
      end: 0, // dummy
    };

    return generateJS(astProgram);
  }

  /**
   * Convert the profile to a closure, which can be used for auto profiles
   * (function() {
   *  // the definition of FindProxyForURL
   *  return FindProxyForURL;
   * })()
   * @returns
   */
  async toClosure() {
    const stmts = await this.genStatements();
    stmts.push(
      PACScriptHelper.newReturnStatement(
        PACScriptHelper.newIdentifier("FindProxyForURL")
      )
    );

    return PACScriptHelper.newCallExpression(
      PACScriptHelper.newFunctionExpression([], stmts),
      []
    );
  }

  /**
   * genStatements that returns a list of statements, containing the main function `FindProxyForURL`
   * @returns
   */
  private async genStatements() {
    switch (this.profile.proxyType) {
      case "system":
      case "direct":
      case "proxy":
        return this.genFindProxyForURLFunction();
      case "pac":
        return this.genFindProxyForURLFunctionForPAC();
      case "auto":
        return await this.genFindProxyForURLFunctionForAutoProfile();
    }
  }
  private genFindProxyForURLFunctionForPAC(): Statement[] {
    if (this.profile.proxyType != "pac") {
      throw new Error("this function should only be called for pac profile");
    }

    if (!this.profile.pacScript.data) {
      return [];
    }

    return parsePACScript(this.profile.pacScript.data);
  }

  /**
   * genFindProxyForURLFunction for `ProxySimple` and `ProxyPreset`
   * @returns
   */
  private genFindProxyForURLFunction(): Statement[] {
    const body: Statement[] = [];

    switch (this.profile.proxyType) {
      case "direct":
        body.push(
          PACScriptHelper.newReturnStatement(
            PACScriptHelper.newSimpleLiteral("DIRECT")
          )
        );
        break;
      case "proxy":
        body.push(
          ...this.genBypassList(),
          ...this.genAdvancedRules(),
          PACScriptHelper.newReturnStatement(
            newProxyString(this.profile.proxyRules.default)
          )
        );
        break;

      default:
        throw new Error("unexpected proxy type");
    }

    return [
      PACScriptHelper.newFunctionDeclaration(
        "FindProxyForURL",
        ["url", "host"],
        body
      ),
    ];
  }

  private async genFindProxyForURLFunctionForAutoProfile() {
    if (this.profile.proxyType != "auto") {
      throw new Error("this function should only be called for auto profile");
    }

    const { stmt, loadedProfiles } = await this.prepareAutoProfilePrecedence(
      this.profile
    );
    const body: Statement[] = [];

    // rules
    this.profile.rules.forEach((rule) => {
      switch (rule.type) {
        case "disabled":
          return; // skipped
        default:
          if (loadedProfiles.has(rule.profileID)) {
            return body.push(this.genAutoProfileRule(rule));
          }
      }

      // if a dependent profile is not loaded, skip it, and add some alerts
      body.push(this.genAutoProfileMissingProfileAlert(rule.profileID));
    });

    // default profile
    if (loadedProfiles.has(this.profile.defaultProfileID)) {
      body.push(
        PACScriptHelper.newReturnStatement(
          this.genAutoProfileCallExpression(this.profile.defaultProfileID)
        )
      );
    } else {
      body.push(
        this.genAutoProfileMissingProfileAlert(this.profile.defaultProfileID),
        PACScriptHelper.newReturnStatement(
          PACScriptHelper.newSimpleLiteral("DIRECT") // fallback to direct
        )
      );
    }

    stmt.push(
      PACScriptHelper.newFunctionDeclaration(
        "FindProxyForURL",
        ["url", "host"],
        body
      )
    );

    return stmt;
  }

  private async findProfileForAutoProfile(
    url: URL
  ): Promise<{ profile: ProfileConverter | undefined; isConfident: boolean }> {
    if (this.profile.proxyType != "auto") {
      throw new Error("this function should only be called for auto profile");
    }

    for (let rule of this.profile.rules) {
      if (rule.type == "disabled") {
        continue;
      }

      const profile = await this.loadProfile(rule.profileID);
      if (!profile) {
        continue;
      }

      const ret = await profile.findProfileForAutoProfileRule(
        url,
        rule,
        profile
      );
      if (ret.profile) {
        return ret;
      }
    }

    const defaultProfile =
      (await this.loadProfile(this.profile.defaultProfileID)) ||
      new ProfileConverter(SystemProfile.DIRECT);

    return await defaultProfile.findProfile(url);
  }

  private genAutoProfileRule(rule: AutoSwitchRule): Statement {
    switch (rule.type) {
      case "domain":
        return PACScriptHelper.newIfStatement(
          PACScriptHelper.newCallExpression(
            PACScriptHelper.newIdentifier("shExpMatch"),
            [
              PACScriptHelper.newIdentifier("host"),
              PACScriptHelper.newSimpleLiteral(rule.condition),
            ]
          ),
          [
            PACScriptHelper.newReturnStatement(
              this.genAutoProfileCallExpression(rule.profileID)
            ),
          ]
        );

      case "url":
        return PACScriptHelper.newIfStatement(
          PACScriptHelper.newCallExpression(
            PACScriptHelper.newIdentifier("shExpMatch"),
            [
              PACScriptHelper.newIdentifier("url"),
              PACScriptHelper.newSimpleLiteral(rule.condition),
            ]
          ),
          [
            PACScriptHelper.newReturnStatement(
              this.genAutoProfileCallExpression(rule.profileID)
            ),
          ]
        );

      case "cidr":
        // if it's a CIDR
        if (isValidCIDR(rule.condition)) {
          try {
            const [ip, maskPrefixLen] = parseCIDR(rule.condition);
            let mask = (
              ip.kind() == "ipv4" ? IPv4 : IPv6
            ).subnetMaskFromPrefixLength(maskPrefixLen);

            return PACScriptHelper.newIfStatement(
              PACScriptHelper.newCallExpression(
                PACScriptHelper.newIdentifier("isInNet"),
                [
                  PACScriptHelper.newIdentifier("host"),
                  PACScriptHelper.newSimpleLiteral(ip.toString()),
                  PACScriptHelper.newSimpleLiteral(mask.toNormalizedString()),
                ]
              ),
              [
                PACScriptHelper.newReturnStatement(
                  this.genAutoProfileCallExpression(rule.profileID)
                ),
              ]
            );
          } catch (e) {
            console.error(e);
          }
        }
    }

    return PACScriptHelper.newExpressionStatement(
      PACScriptHelper.newCallExpression(
        PACScriptHelper.newIdentifier("alert"),
        [
          PACScriptHelper.newSimpleLiteral(
            `Invalid condition ${rule.type}: ${rule.condition}, skipped`
          ),
        ]
      )
    );
  }

  private async findProfileForAutoProfileRule(
    url: URL,
    rule: AutoSwitchRule,
    profile: ProfileConverter
  ): Promise<{ profile: ProfileConverter | undefined; isConfident: boolean }> {
    switch (rule.type) {
      case "domain":
        if (shExpMatch(url.hostname, rule.condition)) {
          return profile.findProfile(url);
        }

        break;
      case "url":
        if (shExpMatch(url.href, rule.condition)) {
          return profile.findProfile(url);
        }

        break;
      case "cidr":
        // if it's a CIDR
        if (isValidCIDR(rule.condition)) {
          try {
            const [ip, maskPrefixLen] = parseCIDR(rule.condition);
            let mask = (
              ip.kind() == "ipv4" ? IPv4 : IPv6
            ).subnetMaskFromPrefixLength(maskPrefixLen);

            switch (
              isInNet(url.hostname, ip.toString(), mask.toNormalizedString())
            ) {
              case true:
                return profile.findProfile(url);
              case false:
                break; // not in the CIDR
              case UNKNOWN:
                return { profile: profile, isConfident: false }; // unknown
            }
          } catch (e) {
            console.error(e);
          }
        }

        break;
    }

    return { profile: undefined, isConfident: true };
  }

  private genAutoProfileCallExpression(profileID: string) {
    return PACScriptHelper.newCallExpression(
      PACScriptHelper.newMemberExpression(
        PACScriptHelper.newIdentifier("profiles"),
        PACScriptHelper.newSimpleLiteral(profileID),
        true
      ),
      [
        PACScriptHelper.newIdentifier("url"),
        PACScriptHelper.newIdentifier("host"),
      ]
    );
  }

  private genAutoProfileMissingProfileAlert(profileID: string) {
    return PACScriptHelper.newExpressionStatement(
      PACScriptHelper.newCallExpression(
        PACScriptHelper.newIdentifier("alert"),
        [
          PACScriptHelper.newSimpleLiteral(
            `Profile ${profileID} not found, skipped`
          ),
        ]
      )
    );
  }

  private async prepareAutoProfilePrecedence(profile: ProfileAutoSwitch) {
    const loadedProfiles = new Set<string>();
    const stmt: Statement[] = [
      // var profiles = profiles || {};
      PACScriptHelper.newVariableDeclaration(
        "profiles",
        PACScriptHelper.newLogicalExpression(
          "||",
          PACScriptHelper.newIdentifier("profiles"),
          PACScriptHelper.newObjectExpression([])
        )
      ),

      /**
       * function register(profileID, funcFindProxyForURL) {
       *    profiles[profileID] = funcFindProxyForURL;
       * }
       */
      PACScriptHelper.newFunctionDeclaration(
        "register",
        ["profileID", "funcFindProxyForURL"],
        [
          PACScriptHelper.newExpressionStatement(
            PACScriptHelper.newAssignmentExpression(
              "=",
              PACScriptHelper.newMemberExpression(
                PACScriptHelper.newIdentifier("profiles"),
                PACScriptHelper.newIdentifier("profileID"),
                true
              ),
              PACScriptHelper.newIdentifier("funcFindProxyForURL")
            )
          ),
        ]
      ),
    ];

    // register all profiles
    const profileIDs = [
      profile.defaultProfileID,
      ...profile.rules.map((r) => r.profileID),
    ];
    for (let profileID of profileIDs) {
      if (loadedProfiles.has(profileID)) {
        continue;
      }

      const profile = await this.loadProfile(profileID);
      if (!profile) {
        continue;
      }

      loadedProfiles.add(profileID);

      stmt.push(
        PACScriptHelper.newExpressionStatement(
          PACScriptHelper.newCallExpression(
            PACScriptHelper.newIdentifier("register"),
            [
              PACScriptHelper.newSimpleLiteral(profileID),
              await profile.toClosure(),
            ]
          )
        )
      );
    }

    return { stmt, loadedProfiles };
  }

  private async loadProfile(
    profileID: string
  ): Promise<ProfileConverter | undefined> {
    if (!this.profileLoader) {
      return;
    }

    const profile = await this.profileLoader(profileID);
    if (!profile) {
      return;
    }

    return new ProfileConverter(profile, this.profileLoader);
  }

  private genBypassList() {
    if (this.profile.proxyType != "proxy") {
      throw new Error("Only proxy profile can have bypass list");
    }

    const directExpr = PACScriptHelper.newReturnStatement(
      PACScriptHelper.newSimpleLiteral("DIRECT")
    );
    return this.profile.proxyRules.bypassList.map((item) => {
      if (item == "<local>") {
        return PACScriptHelper.newIfStatement(
          PACScriptHelper.newCallExpression(
            PACScriptHelper.newIdentifier("isPlainHostName"),
            [PACScriptHelper.newIdentifier("host")]
          ),
          [directExpr]
        );
      }

      // if it's a CIDR
      if (isValidCIDR(item)) {
        try {
          const [ip, maskPrefixLen] = parseCIDR(item);
          let mask = (
            ip.kind() == "ipv4" ? IPv4 : IPv6
          ).subnetMaskFromPrefixLength(maskPrefixLen);

          return PACScriptHelper.newIfStatement(
            PACScriptHelper.newCallExpression(
              PACScriptHelper.newIdentifier("isInNet"),
              [
                PACScriptHelper.newIdentifier("host"),
                PACScriptHelper.newSimpleLiteral(ip.toString()),
                PACScriptHelper.newSimpleLiteral(mask.toNormalizedString()),
              ]
            ),
            [directExpr]
          );
        } catch (e) {
          console.error(e);
        }
      }

      return PACScriptHelper.newIfStatement(
        PACScriptHelper.newCallExpression(
          PACScriptHelper.newIdentifier("shExpMatch"),
          [
            PACScriptHelper.newIdentifier("host"),
            PACScriptHelper.newSimpleLiteral(item),
          ]
        ),
        [directExpr]
      );
    });
  }

  private genAdvancedRules() {
    if (this.profile.proxyType != "proxy") {
      throw new Error("Only proxy profile can have bypass list");
    }

    const ret = [];

    type KeyVal = "ftp" | "https" | "http";
    const keys: KeyVal[] = ["ftp", "https", "http"];
    const rules = this.profile.proxyRules as Record<
      KeyVal,
      ProxyServer | undefined
    >;

    for (let item of keys) {
      const cfg = rules[item];
      if (!cfg) {
        continue;
      }

      ret.push(
        PACScriptHelper.newIfStatement(
          PACScriptHelper.newCallExpression(
            PACScriptHelper.newMemberExpression(
              PACScriptHelper.newIdentifier("url"),
              PACScriptHelper.newIdentifier("startsWith")
            ),
            [PACScriptHelper.newSimpleLiteral(`${item}:`)]
          ),
          [PACScriptHelper.newReturnStatement(newProxyString(cfg))]
        )
      );
    }
    return ret;
  }
}
