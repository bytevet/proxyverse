import type { AutoSwitchType } from "@/services/profile";
import { cidrNetMask, urlRegExp } from "@/services/proxy/pacSimulator";
import { regexToWildcards } from "./regex";

/** A SwitchyOmega condition, as stored in a backup or parsed from a rule list. */
export type Condition = {
  conditionType: string;
  pattern?: string;
  ip?: string;
  prefixLength?: number;
  minValue?: number;
  maxValue?: number;
  days?: string;
  startDay?: number;
  endDay?: number;
  startHour?: number;
  endHour?: number;
};

type RuleCondition = { type: AutoSwitchType; condition: string };

type ConvertedCondition = {
  rules: RuleCondition[];
  /** i18n key and args of a warning about the conversion, if any. */
  warning?: { key: string; args: string[] };
};

// Literal text that `shExpMatch` reads differently across browsers (Firefox
// builds a regex escaping only `.`), so a wildcard holding it can't be kept.
// TODO: compile wildcards to fully escaped regexes in the generated PAC
// script and the simulator, so every browser matches alike; then drop this.
const UNSAFE_WILDCARD = /[+()[\]{}^$\\|]/;

/** The condition as SwitchyOmega writes it in a rule list. */
function describeCondition(c: Condition): string {
  const type = c.conditionType.replace(/Condition$/, "");
  const arg = (() => {
    switch (c.conditionType) {
      case "IpCondition":
        return c.ip !== undefined ? `${c.ip}/${c.prefixLength}` : c.pattern;
      case "HostLevelsCondition":
        return c.minValue !== undefined
          ? `${c.minValue}~${c.maxValue}`
          : c.pattern;
      case "WeekdayCondition":
        return (
          c.days ??
          (c.startDay !== undefined ? `${c.startDay}~${c.endDay}` : c.pattern)
        );
      case "TimeCondition":
        return c.startHour !== undefined
          ? `${c.startHour}~${c.endHour}`
          : c.pattern;
      default:
        return c.pattern;
    }
  })();
  return arg ? `${type}: ${arg}` : type;
}

const unsupported = (c: Condition): ConvertedCondition => {
  const text = describeCondition(c);
  return {
    rules: [{ type: "disabled", condition: text }],
    warning: { key: "import_warn_unsupported_condition", args: [text] },
  };
};

// An empty pattern matches everything, as SwitchyOmega's empty regex does.
const alternatives = (pattern: string) => {
  const ret = pattern.split("|").filter((p) => p);
  return ret.length ? ret : ["*"];
};

/** `HostWildcard`: `*.x` and `.x` cover x and its subdomains, `**.x` only subdomains. */
function hostWildcard(pattern: string): string[] {
  return alternatives(pattern).flatMap((p) => {
    if (p.startsWith(".")) p = "*" + p;
    if (p.startsWith("**.")) return [p.substring(1)];
    if (p.startsWith("*.")) return [p.substring(2), p];
    return [p];
  });
}

/**
 * A bypass list entry in our syntax (`<local>`, CIDR or host pattern), or
 * undefined for entries matching on scheme or port, which ours can't.
 */
export function convertBypass(pattern: string): string | undefined {
  pattern = pattern.trim();
  if (pattern === "<local>") return pattern;
  if (pattern.includes("://")) return;

  if (pattern.includes("/")) {
    const cidr = pattern.replace(/^\[(.*)\](\/\d+)$/, "$1$2");
    return cidrNetMask(cidr) ? cidr : undefined;
  }

  // `[v6]`, `[v6]:port`, `host:port`
  const v6 = /^\[(.*)\](:\d+)?$/.exec(pattern);
  if (v6) return v6[2] ? undefined : v6[1];
  if (/^[^:]*:\d+$/.test(pattern)) return;

  if (UNSAFE_WILDCARD.test(pattern)) return;
  // Chrome bypass syntax: `.x` is subdomains of x, like `*.x`
  return pattern.startsWith(".") ? "*" + pattern : pattern;
}

/** Convert a SwitchyOmega condition into rule conditions of ours. */
export function convertCondition(c: Condition): ConvertedCondition {
  const pattern = c.pattern ?? "";
  const rules = (type: AutoSwitchType, conditions: string[]) => ({
    rules: [...new Set(conditions)].map((condition) => ({ type, condition })),
  });

  switch (c.conditionType) {
    case "HostWildcardCondition":
      if (UNSAFE_WILDCARD.test(pattern.replace(/\|/g, ""))) break;
      return rules("domain", hostWildcard(pattern));

    case "UrlWildcardCondition":
      if (UNSAFE_WILDCARD.test(pattern.replace(/\|/g, ""))) break;
      return rules("url", alternatives(pattern));

    // plain http only, substring match; `?` widens to any char like `\?`
    case "KeywordCondition":
      if (!pattern || pattern.includes("*") || UNSAFE_WILDCARD.test(pattern))
        break;
      return rules("url", [`http://*${pattern}*`]);

    // our regex rules match URLs; host regexes only when they're wildcards
    case "HostRegexCondition": {
      const wildcards = regexToWildcards(pattern);
      if (!wildcards) break;
      return rules("domain", wildcards);
    }

    // an invalid regex never matches in SwitchyOmega
    case "UrlRegexCondition":
      if (!urlRegExp(pattern)) break;
      return rules("regex", [pattern]);

    case "IpCondition": {
      const ip = (c.ip ?? "").replace(/^\[(.*)\]$/, "$1");
      const cidr = `${ip}/${c.prefixLength}`;
      if (!cidrNetMask(cidr)) break;
      return {
        ...rules("cidr", [cidr]),
        warning: { key: "import_warn_ip_condition", args: [cidr] },
      };
    }

    case "BypassCondition": {
      const entry = convertBypass(pattern);
      if (!entry || entry === "<local>") break;
      return rules(cidrNetMask(entry) ? "cidr" : "domain", [entry]);
    }

    case "TrueCondition":
      return rules("domain", ["*"]);

    case "FalseCondition":
      return rules("disabled", [pattern]);
  }

  return unsupported(c);
}
