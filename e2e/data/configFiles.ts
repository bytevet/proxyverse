import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProxyProfile } from "@/services/profile";

export type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** An import file (format "2025-01") holding `profiles`. */
export function configFile(profiles: ProxyProfile[]): FilePayload {
  return jsonFile({ version: "2025-01", profiles });
}

/** A SwitchyOmega / ZeroOmega backup (`.bak`) holding `profiles`, keyed by name. */
export function switchyOmegaFile(
  profiles: ({ name: string } & Record<string, unknown>)[]
): FilePayload {
  const backup = {
    schemaVersion: 2,
    "-downloadInterval": 1440,
    ...Object.fromEntries(profiles.map((p) => ["+" + p.name, p])),
  };
  return { ...jsonFile(backup, "OmegaOptions.bak"), mimeType: "" };
}

function jsonFile(content: unknown, name = "proxyverse.json"): FilePayload {
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(content, null, 2)),
  };
}

/** A static fixture from e2e/data/files/. */
export function fixtureFile(name: string): FilePayload {
  return {
    name,
    mimeType: "application/json",
    buffer: readFileSync(path.join(import.meta.dirname, "files", name)),
  };
}
