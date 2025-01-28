import { isLeft } from "fp-ts/Either";
import * as inner from "@/services/profile";
import { ConfigFile, getPaths, ProxyProfile } from "./definition";

/**
 * Convert the raw profiles to JSON string.
 *
 * @param rawProfiles - The raw profiles
 * @returns JSON string
 */
export const config2json = (rawProfiles: inner.ProfilesStorage): string => {
  const encoded = ConfigFile.encode({
    version: "2025-01",
    profiles: Object.values(rawProfiles)
      .map(exportProfile)
      .filter((p) => p !== undefined),
  });

  return JSON.stringify(encoded, null, 2);
};

const exportProfile = (p: inner.ProxyProfile): ProxyProfile | undefined => {
  const decoded = ProxyProfile.decode(p);
  if (isLeft(decoded)) {
    console.error("Failed to decode profile", p, decoded.left);
    return;
  }

  return decoded.right;
};

export const json2config = (json: string): inner.ProxyProfile[] => {
  // might throw error for malformed JSON
  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    throw Error("Invalid config data");
  }
  const decoded = ConfigFile.decode(obj);
  if (isLeft(decoded)) {
    throw Error(`Could not validate data: ${getPaths(decoded).join(", ")}`);
  }

  return decoded.right.profiles.map((p) => ProxyProfile.encode(p));
};
