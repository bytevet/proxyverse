import * as z from "zod/mini";
import * as inner from "@/services/profile";
import type { ImportResult, ImportWarning } from "../types";
import { ConfigFile, FORMAT_VERSION, ProxyProfile } from "./schema";

/** Validate a stored profile for export; undefined if it isn't valid. */
export const exportableProfile = (
  p: inner.ProxyProfile
): ProxyProfile | undefined => {
  const parsed = ProxyProfile.safeParse(p);
  return parsed.success ? parsed.data : undefined;
};

/** The profiles in a Proxyverse config file. */
export const encodeConfig = (profiles: ProxyProfile[]): string =>
  JSON.stringify({ version: FORMAT_VERSION, profiles }, null, 2);

/** Whether `obj` looks like a Proxyverse config file, of any version. */
export const isProxyverseConfig = (obj: unknown): obj is object =>
  typeof obj === "object" &&
  obj !== null &&
  "version" in obj &&
  "profiles" in obj;

/**
 * Read a Proxyverse config file. A file that isn't one throws; a profile
 * that is invalid, uses a reserved ID or repeats an earlier ID is skipped
 * with a warning.
 */
export const decodeConfig = (obj: unknown): ImportResult => {
  const file = ConfigFile.safeParse(obj);
  if (!file.success) {
    throw Error(`Unsupported config file: ${z.prettifyError(file.error)}`);
  }

  const profiles: inner.ProxyProfile[] = [];
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();

  file.data.profiles.forEach((raw, i) => {
    const profileName = nameOf(raw) ?? `#${i + 1}`;
    const skip = (key: string, arg: string) =>
      warnings.push({ profileName, key, args: [arg] });

    const parsed = ProxyProfile.safeParse(raw);
    if (!parsed.success) {
      skip("import_warn_invalid_profile", issuesOf(parsed.error));
      return;
    }

    const { profileID } = parsed.data;
    if (inner.getSystemProfile(profileID)) {
      skip("import_warn_reserved_id", profileID);
    } else if (seen.has(profileID)) {
      skip("import_warn_duplicate_id", profileID);
    } else {
      seen.add(profileID);
      profiles.push(parsed.data);
    }
  });

  return { profiles, warnings };
};

const nameOf = (raw: unknown): string | undefined => {
  const name = (raw as { profileName?: unknown } | null)?.profileName;
  return typeof name === "string" && name ? name : undefined;
};

// "proxyRules.default.port: Too big: expected number to be <=65535"
const issuesOf = (error: z.core.$ZodError): string =>
  error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
