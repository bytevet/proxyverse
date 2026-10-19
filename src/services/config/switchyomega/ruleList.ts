import { decodeBase64 } from "@/services/utils";
import type { Condition } from "./conditions";

// Ports of SwitchyOmega's rule list parsers (omega-pac/src/rule_list.coffee).

export type ListRule = { condition: Condition; profileName: string };

const ABBREVIATIONS: Record<string, string[]> = {
  TrueCondition: ["True"],
  FalseCondition: ["False", "Disabled"],
  UrlRegexCondition: ["UR", "URegex", "UrlR", "UrlRegex"],
  UrlWildcardCondition: [
    "U", "UW", "Url", "UrlW", "UWild", "UWildcard", "UrlWild", "UrlWildcard",
  ],
  HostRegexCondition: ["R", "HR", "Regex", "HostR", "HRegex", "HostRegex"],
  HostWildcardCondition: [
    "", "H", "W", "HW", "Wild", "Wildcard", "Host", "HostW", "HWild",
    "HWildcard", "HostWild", "HostWildcard",
  ],
  BypassCondition: ["B", "Bypass"],
  KeywordCondition: ["K", "KW", "Keyword"],
  IpCondition: ["Ip"],
  HostLevelsCondition: [
    "Lv", "Level", "Levels", "HL", "HLv", "HLevel", "HLevels", "HostL",
    "HostLv", "HostLevel", "HostLevels",
  ],
  WeekdayCondition: ["WD", "Week", "Day", "Weekday"],
  TimeCondition: ["T", "Time", "Hour"],
};

const TYPE_BY_ABBR = new Map(
  Object.entries(ABBREVIATIONS).flatMap(([type, abbrs]) =>
    [type, ...abbrs].map((a) => [a.toUpperCase(), type] as const)
  )
);

/** A condition in SwitchyOmega's text syntax: `Type: pattern` or a host wildcard. */
export function conditionFromString(str: string): Condition | undefined {
  str = str.trim();
  let i = str.indexOf(" ");
  if (i < 0) i = str.length;
  let abbr = "";
  if (str[i - 1] === ":") {
    abbr = str.substring(0, i - 1);
    str = str.substring(i + 1).trim();
  }

  const conditionType = TYPE_BY_ABBR.get(abbr.toUpperCase());
  if (!conditionType) return;
  switch (conditionType) {
    case "TrueCondition":
      return { conditionType };
    case "IpCondition": {
      const [ip, prefix] = str.split("/");
      const prefixLength = prefix
        ? parseInt(prefix, 10)
        : ip.includes(":")
          ? 128
          : 32;
      return { conditionType, ip, prefixLength };
    }
    default:
      return { conditionType, pattern: str };
  }
}

const lines = (text: string) =>
  text
    .split(/\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l);

function autoProxyCondition(line: string): Condition {
  if (line[0] === "/") {
    return {
      conditionType: "UrlRegexCondition",
      pattern: line.substring(1, line.length - 1),
    };
  }
  if (line.startsWith("||")) {
    return {
      conditionType: "HostWildcardCondition",
      pattern: "*." + line.substring(2),
    };
  }
  if (line[0] === "|") {
    return {
      conditionType: "UrlWildcardCondition",
      pattern: line.substring(1) + "*",
    };
  }
  // no wildcard: a substring of plain http URLs
  if (!line.includes("*")) {
    return { conditionType: "KeywordCondition", pattern: line };
  }
  return { conditionType: "UrlWildcardCondition", pattern: `http://*${line}*` };
}

// A rule of the AutoProxy or legacy syntax: exceptions route to the default
// profile and take precedence over the other rules.
type Entry = { exception: boolean; condition: Condition };

function exceptionsFirst(
  entries: Entry[],
  matchProfileName: string,
  defaultProfileName: string
): ListRule[] {
  const rule = ({ exception, condition }: Entry) => ({
    condition,
    profileName: exception ? defaultProfileName : matchProfileName,
  });
  return [
    ...entries.filter((e) => e.exception).map(rule),
    ...entries.filter((e) => !e.exception).map(rule),
  ];
}

/** AutoProxy (gfwlist) syntax; `@@` marks exceptions. */
function parseAutoProxy(text: string): Entry[] {
  return lines(text)
    .filter((line) => line[0] !== "!" && line[0] !== "[")
    .map((line) => {
      const exception = line.startsWith("@@");
      return {
        exception,
        condition: autoProxyCondition(exception ? line.substring(2) : line),
      };
    });
}

const legacyWildcard = (pattern: string): Condition => {
  if (pattern[0] === "@") {
    pattern = pattern.substring(1);
  } else {
    if (pattern.indexOf("://") <= 0 && pattern[0] !== "*") pattern = "*" + pattern;
    if (!pattern.endsWith("*")) pattern += "*";
  }
  const host = /^\*:\/\/((?:\w|[?*._-])+)\/\*$/.exec(pattern)?.[1];
  return host
    ? { conditionType: "HostWildcardCondition", pattern: host }
    : { conditionType: "UrlWildcardCondition", pattern };
};

/** Switchy's legacy `#BEGIN` ... `#END` syntax; `!` marks exceptions. */
function parseLegacy(text: string): Entry[] {
  const entries: Entry[] = [];
  let begin = false;
  let section = "WILDCARD";
  for (let line of lines(text)) {
    if (line[0] === ";") continue;
    if (!begin) {
      begin = line.toUpperCase() === "#BEGIN";
      continue;
    }
    if (line.toUpperCase() === "#END") break;
    if (line[0] === "[" && line.endsWith("]")) {
      section = line.substring(1, line.length - 1).toUpperCase();
      continue;
    }

    const exception = line[0] === "!";
    if (exception) line = line.substring(1);
    if (section === "WILDCARD") {
      entries.push({ exception, condition: legacyWildcard(line) });
    } else if (section === "REGEXP") {
      entries.push({
        exception,
        condition: { conditionType: "UrlRegexCondition", pattern: line },
      });
    }
  }
  return entries;
}

/**
 * SwitchyOmega's own syntax (`[SwitchyOmega Conditions]`). With
 * `@with result`, each line ends in ` +Profile`, `* +Profile` is the
 * catch-all, and `!` lines go to the catch-all's profile.
 */
function parseOmega(
  text: string,
  matchProfileName: string,
  defaultProfileName: string
): ListRule[] {
  const rules: ListRule[] = [];
  const toCatchAll: ListRule[] = [];
  let withResult = false;
  let catchAll: string | undefined;

  for (let line of lines(text)) {
    if (line[0] === "[" || line[0] === ";") continue;
    if (line[0] === "@") {
      let i = line.indexOf(" ");
      if (i < 0) i = line.length;
      const directive = line.substring(1, i).toUpperCase();
      const feature = line.substring(i + 1).trim().toUpperCase();
      if (directive === "WITH" && (feature === "RESULT" || feature === "RESULTS"))
        withResult = true;
      continue;
    }

    let profileName: string | undefined;
    if (line[0] === "!") {
      profileName = withResult ? undefined : defaultProfileName;
      line = line.substring(1);
    } else if (withResult) {
      const i = line.lastIndexOf(" +");
      if (i < 0) continue;
      profileName = line.substring(i + 2).trim();
      line = line.substring(0, i).trim();
      if (line === "*") catchAll = profileName;
    } else {
      profileName = matchProfileName;
    }

    const condition = conditionFromString(line);
    if (!condition) continue;
    const rule = { condition, profileName: profileName ?? "" };
    rules.push(rule);
    if (profileName === undefined) toCatchAll.push(rule);
  }

  if (withResult) {
    const fallback = catchAll ?? (defaultProfileName || "direct");
    toCatchAll.forEach((r) => (r.profileName = fallback));
  }
  return rules;
}

const AUTOPROXY_BASE64_PREFIX = "W0F1dG9Qcm94"; // "[AutoProxy"

/**
 * The rules of a rule list, in evaluation order. `autoProxy` is whether the
 * profile says the list is in AutoProxy syntax; AutoProxy text is
 * recognised either way.
 */
export function parseRuleList(
  text: string,
  autoProxy: boolean,
  matchProfileName: string,
  defaultProfileName: string
): ListRule[] {
  text = text.trim();
  if (text.startsWith(AUTOPROXY_BASE64_PREFIX)) text = decodeBase64(text);

  if (autoProxy || text.startsWith("[AutoProxy")) {
    return exceptionsFirst(parseAutoProxy(text), matchProfileName, defaultProfileName);
  }
  if (
    !text.startsWith("[SwitchyOmega Conditions") &&
    (text[0] === "#" || text.includes("\n#"))
  ) {
    return exceptionsFirst(parseLegacy(text), matchProfileName, defaultProfileName);
  }
  return parseOmega(text, matchProfileName, defaultProfileName);
}
