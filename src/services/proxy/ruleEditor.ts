import { getDomain } from "tldts";
import { ProfileAutoSwitch, getProfile, saveProfile } from "../profile";
import { deepClone } from "../utils";
import { getCurrentProxySetting, refreshProxy } from "./index";

/** What a new rule covers: the exact host, or its whole site. */
export type RuleScope = "host" | "site";

/**
 * The registrable domain of `host` (e.g. "example.co.uk" for
 * "a.b.example.co.uk"), or undefined when it has none: IP addresses,
 * "localhost", single-label names and public suffixes like "github.io".
 */
export function siteDomain(host: string): string | undefined {
  return getDomain(host, { allowPrivateDomains: true }) ?? undefined;
}

/**
 * The domain rule conditions covering `host` in `scope`. A site needs two:
 * "*.example.com" doesn't match "example.com" itself.
 */
export function ruleConditions(host: string, scope: RuleScope): string[] {
  const domain = scope === "site" ? siteDomain(host) : undefined;
  return domain ? [domain, `*.${domain}`] : [host];
}

/**
 * Route `condition` to `profileID` in an auto-switch profile.
 *
 * An existing `domain` rule with exactly the same condition is updated,
 * otherwise a new one is created. Either way, the rule is moved to the top so
 * it takes precedence over broader rules. The input profile is not mutated.
 */
export function upsertDomainRule(
  profile: ProfileAutoSwitch,
  condition: string,
  profileID: string
): ProfileAutoSwitch {
  if (profileID === profile.profileID) {
    throw new Error("an auto switch profile cannot route to itself");
  }

  const ret = deepClone(profile);
  const idx = ret.rules.findIndex(
    (r) => r.type === "domain" && r.condition === condition
  );
  const [rule] =
    idx >= 0
      ? ret.rules.splice(idx, 1)
      : [{ type: "domain" as const, condition, profileID }];

  rule.profileID = profileID;
  ret.rules.unshift(rule);
  return ret;
}

/** Upsert several domain rules, keeping them in the given order at the top. */
export function upsertDomainRules(
  profile: ProfileAutoSwitch,
  conditions: string[],
  profileID: string
): ProfileAutoSwitch {
  return conditions.reduceRight(
    (p, condition) => upsertDomainRule(p, condition, profileID),
    profile
  );
}

/**
 * Route `host` (or its whole site) to `profileID` in the active auto-switch
 * profile, save it and apply the new proxy config.
 */
export async function switchHostProxy(
  host: string,
  profileID: string,
  scope: RuleScope
) {
  const { activeProfile } = await getCurrentProxySetting();
  if (activeProfile?.proxyType !== "auto") {
    throw new Error("the active profile is not an auto switch profile");
  }

  // the active profile kept in storage is a snapshot; use the latest version
  const latest = await getProfile(activeProfile.profileID, true);
  if (latest?.proxyType !== "auto") {
    throw new Error("the active auto switch profile no longer exists");
  }

  const updated = upsertDomainRules(
    latest,
    ruleConditions(host, scope),
    profileID
  );
  await saveProfile(updated);
  await refreshProxy();
  return updated;
}
