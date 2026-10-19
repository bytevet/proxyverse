import * as z from "zod/mini";
import { en } from "zod/locales";
import type * as inner from "@/services/profile";

// zod/mini ships no messages; import warnings quote them
z.config(en());

// The Proxyverse config file, format "2025-01". Unknown keys are stripped,
// so runtime-only fields never reach a file and newer files stay readable.

const Port = z.number().check(z.int(), z.gte(0), z.lte(65535));

const HexColor = z
  .string()
  .check(z.regex(/^#([0-9a-f]{6}|[0-9a-f]{3,4})$/i, "not a hex color"));

const ProxyServer = z.object({
  scheme: z.enum(["direct", "http", "https", "socks4", "socks5"]),
  host: z.string(),
  port: z.optional(Port),
  auth: z.optional(z.object({ username: z.string(), password: z.string() })),
});

// Only what defines the script: `data` (inline or the last fetch of
// `sourceURL`) and the refresh cadence. Fetch bookkeeping stays local.
const PacScript = z.object({
  data: z.optional(z.string()),
  sourceURL: z.optional(z.string()),
  refreshIntervalMinutes: z.optional(z.number().check(z.gte(0))),
});

const ProxyRules = z.object({
  default: ProxyServer,
  http: z.optional(ProxyServer),
  https: z.optional(ProxyServer),
  ftp: z.optional(ProxyServer),
  bypassList: z.array(z.string()),
});

const Meta = {
  profileID: z.string().check(z.minLength(1)),
  color: HexColor,
  profileName: z.string(),
};

const ProfileProxy = z.object({
  ...Meta,
  proxyType: z.literal("proxy"),
  proxyRules: ProxyRules,
});

const ProfilePac = z.object({
  ...Meta,
  proxyType: z.literal("pac"),
  pacScript: PacScript,
});

const ProfileAutoSwitch = z.object({
  ...Meta,
  proxyType: z.literal("auto"),
  rules: z.array(
    z.object({
      type: z.enum(["domain", "cidr", "url", "regex", "disabled"]),
      condition: z.string(),
      profileID: z.string(),
    })
  ),
  defaultProfileID: z.string(),
});

// Preset profiles (direct / system) are built in and never in a file.
export const ProxyProfile = z.discriminatedUnion("proxyType", [
  ProfileProxy,
  ProfilePac,
  ProfileAutoSwitch,
]);
export type ProxyProfile = z.infer<typeof ProxyProfile>;

export const FORMAT_VERSION = "2025-01";

export const ConfigFile = z.object({
  version: z.literal(FORMAT_VERSION),
  // validated one by one, so a bad profile doesn't sink the whole file
  profiles: z.array(z.unknown()),
});

// Compile-time check: a profile read from a file is a valid stored profile.
type Assert<T extends true> = T;
export type FileProfileIsStorable = Assert<
  ProxyProfile extends inner.ProxyProfile ? true : false
>;
