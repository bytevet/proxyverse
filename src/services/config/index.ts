import {
  ProfilesStorage,
  ProxyProfile,
  lookupProfile,
} from "@/services/profile";
import { decodeBase64 } from "@/services/utils";
import {
  decodeConfig,
  encodeConfig,
  exportableProfile,
  isProxyverseConfig,
} from "./proxyverse";
import { convertSwitchyOmega, isSwitchyOmegaBackup } from "./switchyomega";
import type { ImportResult, ImportWarning } from "./types";

export type { ImportResult, ImportWarning } from "./types";

/**
 * Read an import file: a Proxyverse config file, or a SwitchyOmega /
 * ZeroOmega backup (JSON, possibly base64-encoded). Throws if the file is
 * neither; anything inside it that can't be imported as is is reported in
 * `warnings`. `existing` are the stored profiles, which imported rules may
 * refer to.
 */
export async function importConfig(
  text: string,
  existing: ProfilesStorage
): Promise<ImportResult> {
  const obj = parseJSON(text);

  let result: ImportResult;
  if (isProxyverseConfig(obj)) {
    result = decodeConfig(obj);
  } else if (isSwitchyOmegaBackup(obj)) {
    result = await convertSwitchyOmega(obj);
  } else {
    throw Error("Unrecognized config file");
  }

  result.warnings.push(...missingReferences(result.profiles, existing));
  return result;
}

function parseJSON(text: string): unknown {
  text = text.trim();
  try {
    // SwitchyOmega accepts its backups base64-encoded too
    return JSON.parse(text.startsWith("{") ? text : decodeBase64(text));
  } catch {
    throw Error("Invalid config data");
  }
}

/** Rules routing to a profile that is neither imported nor stored. */
function missingReferences(
  profiles: ProxyProfile[],
  existing: ProfilesStorage
): ImportWarning[] {
  const imported = new Set(profiles.map((p) => p.profileID));
  const known = (id: string) =>
    imported.has(id) || lookupProfile(existing, id) !== undefined;

  return profiles.flatMap((p) => {
    if (p.proxyType !== "auto") return [];
    const missing = new Set(
      [p.defaultProfileID, ...p.rules.map((r) => r.profileID)].filter(
        (id) => !known(id)
      )
    );
    return [...missing].map((id) => ({
      profileName: p.profileName,
      key: "import_warn_unknown_reference",
      args: [id],
    }));
  });
}

/**
 * The config file of the stored profiles. Profiles that aren't valid are
 * left out and named in `skipped`.
 */
export function exportConfig(stored: ProfilesStorage): {
  json: string;
  count: number;
  skipped: string[];
} {
  const exported = [];
  const skipped = [];
  for (const p of Object.values(stored)) {
    const e = exportableProfile(p);
    if (e) exported.push(e);
    else skipped.push(p.profileName || p.profileID);
  }
  return { json: encodeConfig(exported), count: exported.length, skipped };
}
