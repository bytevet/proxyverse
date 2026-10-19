import {
  AutoSwitchRule,
  PAC_REFRESH_INTERVAL_OPTIONS,
  ProxyProfile,
  ProxyServer,
  SystemProfile,
} from "@/services/profile";
import type { ImportResult, ImportWarning } from "../types";
import { Condition, convertBypass, convertCondition } from "./conditions";
import { ListRule, parseRuleList } from "./ruleList";

/**
 * Converting a SwitchyOmega / ZeroOmega backup (`schemaVersion` 2, or 1).
 * Profiles are stored under `+<name>` and options under `-<option>`; the
 * built-in `direct` and `system` profiles are referenced by name only.
 * See omega-pac/src/profiles.coffee and conditions.coffee.
 */

type Server = { scheme: ProxyServer["scheme"]; host: string; port?: number };
type ServerProp = "fallbackProxy" | "proxyForHttp" | "proxyForHttps" | "proxyForFtp";
type Auth = { username?: string; password?: string };

type OmegaProfile = {
  name: string;
  profileType: string;
  color?: string;
  // FixedProfile
  fallbackProxy?: Server;
  proxyForHttp?: Server;
  proxyForHttps?: Server;
  proxyForFtp?: Server;
  bypassList?: Condition[];
  auth?: Partial<Record<ServerProp | "all", Auth>>;
  // PacProfile
  pacUrl?: string;
  pacScript?: string;
  // SwitchProfile, VirtualProfile, RuleListProfile
  rules?: ListRule[];
  defaultProfileName?: string;
  matchProfileName?: string;
  format?: string;
  sourceUrl?: string;
  ruleList?: string;
};

const RULE_LIST_TYPES = [
  "RuleListProfile",
  "SwitchyRuleListProfile",
  "AutoProxyRuleListProfile",
];
const SUPPORTED_TYPES = [
  "FixedProfile",
  "PacProfile",
  "AutoDetectProfile",
  "SwitchProfile",
  "VirtualProfile",
  ...RULE_LIST_TYPES,
];

// The profile `auto_detect` stands for when a version 1 backup lacks it.
const AUTO_DETECT: OmegaProfile = {
  name: "auto_detect",
  profileType: "PacProfile",
  pacUrl: "http://wpad/wpad.dat",
};

const DEFAULT_PAC_SCRIPT =
  'function FindProxyForURL(url, host) {\n  return "DIRECT";\n}';

const ATTACHED_RULE_LIST_PREFIX = "__ruleListOf_";

// UUIDv5 namespace of profile IDs, so a re-import overwrites the profiles
// of the previous one instead of duplicating them.
const ID_NAMESPACE = "783c3cf8-2388-4656-a83f-cf7135a2c614";

/** Whether `obj` looks like a SwitchyOmega backup. */
export const isSwitchyOmegaBackup = (
  obj: unknown
): obj is Record<string, unknown> =>
  typeof obj === "object" &&
  obj !== null &&
  "schemaVersion" in obj &&
  Object.keys(obj).some((k) => k.startsWith("+") || k.startsWith("-"));

export async function convertSwitchyOmega(
  backup: Record<string, unknown>
): Promise<ImportResult> {
  const version = backup.schemaVersion;
  if (version !== 1 && version !== 2) {
    throw Error(`Unsupported SwitchyOmega backup version: ${version}`);
  }

  const omega = new Map<string, OmegaProfile>();
  for (const [key, value] of Object.entries(backup)) {
    if (!key.startsWith("+") || typeof value !== "object" || !value) continue;
    const name = (value as OmegaProfile).name ?? key.substring(1);
    omega.set(name, { ...(value as OmegaProfile), name });
  }

  const converter = new Converter(
    omega,
    downloadInterval(backup["-downloadInterval"])
  );
  return converter.run();
}

/** SwitchyOmega's download interval as one of our PAC refresh options. */
function downloadInterval(v: unknown): number | undefined {
  if (typeof v !== "number") return;
  if (v <= 0) return 0;
  return PAC_REFRESH_INTERVAL_OPTIONS.filter((o) => o > 0).reduce((a, b) =>
    Math.abs(b - v) < Math.abs(a - v) ? b : a
  );
}

class Converter {
  private readonly ids = new Map<string, string>();
  private readonly warnings: ImportWarning[] = [];
  // profiles rules and defaults route to
  private readonly referenced = new Set<string>();

  constructor(
    private readonly omega: Map<string, OmegaProfile>,
    private readonly refreshIntervalMinutes: number | undefined
  ) {}

  async run(): Promise<ImportResult> {
    const names = [...this.omega.keys(), AUTO_DETECT.name];
    const ids = await Promise.all(names.map((n) => uuidV5(ID_NAMESPACE, n)));
    names.forEach((n, i) => this.ids.set(n, ids[i]));

    const profiles: ProxyProfile[] = [];
    const converted = new Set<string>();
    const convert = (name: string) => {
      converted.add(name);
      const p = this.convert(this.omega.get(name) ?? AUTO_DETECT);
      if (p) profiles.push(p);
    };

    // attached rule lists are merged into their switch profile
    for (const name of this.omega.keys()) {
      if (!name.startsWith(ATTACHED_RULE_LIST_PREFIX)) convert(name);
    }
    // then what only references reach: a missing `auto_detect`, or an
    // attached list used elsewhere (a Set iterates entries added meanwhile)
    for (const name of this.referenced) {
      if (!converted.has(name)) convert(name);
    }

    return { profiles, warnings: this.warnings };
  }

  private warn(profileName: string, key: string, ...args: string[]) {
    this.warnings.push({ profileName, key, args });
  }

  private convertible(name: string) {
    const p = this.omega.get(name);
    return p ? SUPPORTED_TYPES.includes(p.profileType) : name === AUTO_DETECT.name;
  }

  /** The profile ID `name` refers to, noting that profile as referenced. */
  private ref(from: string, name: string | undefined): string {
    name ||= "direct";
    if (name === "direct") return SystemProfile.DIRECT.profileID;
    if (name === "system") return SystemProfile.SYSTEM.profileID;
    if (!this.convertible(name)) {
      this.warn(from, "import_warn_unknown_reference", name);
      return SystemProfile.DIRECT.profileID;
    }
    this.referenced.add(name);
    return this.ids.get(name)!;
  }

  private convert(p: OmegaProfile): ProxyProfile | undefined {
    const meta = {
      profileID: this.ids.get(p.name)!,
      profileName: p.name,
      color: /^#[0-9a-f]{6}$/i.test(p.color ?? "")
        ? p.color!.toUpperCase()
        : "#99CCEE",
    };

    switch (p.profileType) {
      case "FixedProfile":
        return { ...meta, ...this.fixed(p) };
      case "PacProfile":
      case "AutoDetectProfile":
        return { ...meta, ...this.pac(p) };
      case "SwitchProfile":
        return { ...meta, ...this.switch(p) };
      case "VirtualProfile":
        return {
          ...meta,
          proxyType: "auto",
          rules: [],
          defaultProfileID: this.ref(p.name, p.defaultProfileName),
        };
      default:
        if (RULE_LIST_TYPES.includes(p.profileType)) {
          return { ...meta, ...this.ruleList(p) };
        }
        this.warn(p.name, "import_warn_unknown_profile_type", p.profileType);
    }
  }

  private fixed(p: OmegaProfile) {
    const server = (prop: ServerProp): ProxyServer | undefined => {
      const s = p[prop];
      if (!s?.host) return;
      const auth = p.auth?.[prop] ?? p.auth?.all;
      return {
        scheme: s.scheme,
        host: s.host,
        ...(s.port !== undefined && { port: s.port }),
        ...(auth?.username && {
          auth: { username: auth.username, password: auth.password ?? "" },
        }),
      };
    };

    const bypassList: string[] = [];
    for (const c of p.bypassList ?? []) {
      const entry = convertBypass(c.pattern ?? "");
      if (entry) bypassList.push(entry);
      else this.warn(p.name, "import_warn_bypass_dropped", c.pattern ?? "");
    }

    return {
      proxyType: "proxy" as const,
      proxyRules: {
        // no fallback proxy: requests of other schemes go direct
        default: server("fallbackProxy") ?? { scheme: "direct" as const, host: "" },
        http: server("proxyForHttp"),
        https: server("proxyForHttps"),
        ftp: server("proxyForFtp"),
        bypassList,
      },
    };
  }

  private pac(p: OmegaProfile) {
    if (p.auth?.all?.username) this.warn(p.name, "import_warn_pac_auth_dropped");

    let sourceURL = p.pacUrl?.trim() || undefined;
    if (sourceURL?.startsWith("file:")) {
      this.warn(p.name, "import_warn_pac_file_url", sourceURL);
      sourceURL = undefined;
    }

    return {
      proxyType: "pac" as const,
      pacScript: {
        data: p.pacScript || (sourceURL ? undefined : DEFAULT_PAC_SCRIPT),
        sourceURL,
        refreshIntervalMinutes: sourceURL ? this.refreshIntervalMinutes : undefined,
      },
    };
  }

  private switch(p: OmegaProfile) {
    const rules = this.rules(p.name, p.rules ?? []);

    // an enabled attached rule list is the switch profile's default
    const attached = this.omega.get(ATTACHED_RULE_LIST_PREFIX + p.name);
    if (attached && p.defaultProfileName === attached.name) {
      const list = this.ruleList(attached);
      return { ...list, rules: [...rules, ...list.rules] };
    }

    return {
      proxyType: "auto" as const,
      rules,
      defaultProfileID: this.ref(p.name, p.defaultProfileName),
    };
  }

  private ruleList(p: OmegaProfile) {
    // warnings go to the switch profile an attached list is merged into
    const owner = p.name.startsWith(ATTACHED_RULE_LIST_PREFIX)
      ? p.name.substring(ATTACHED_RULE_LIST_PREFIX.length)
      : p.name;
    if (p.sourceUrl) this.warn(owner, "import_warn_rule_list_static", p.sourceUrl);

    const autoProxy =
      (p.format ?? p.profileType.replace(/RuleListProfile$/, "")) ===
      "AutoProxy";
    const listRules = parseRuleList(
      p.ruleList ?? "",
      autoProxy,
      p.matchProfileName || "direct",
      p.defaultProfileName || "direct"
    );

    return {
      proxyType: "auto" as const,
      rules: this.rules(owner, listRules),
      defaultProfileID: this.ref(owner, p.defaultProfileName),
    };
  }

  private rules(from: string, rules: ListRule[]): AutoSwitchRule[] {
    return rules.flatMap((r) => {
      const converted = convertCondition(r.condition);
      if (converted.warning) {
        this.warn(from, converted.warning.key, ...converted.warning.args);
      }
      const profileID = this.ref(from, r.profileName);
      return converted.rules.map((c) => ({ ...c, profileID }));
    });
  }
}

/** A name-based UUID (RFC 9562 version 5). */
async function uuidV5(namespace: string, name: string): Promise<string> {
  const ns = Uint8Array.from(
    namespace.replace(/-/g, "").match(/../g)!,
    (h) => parseInt(h, 16)
  );
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash.slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
