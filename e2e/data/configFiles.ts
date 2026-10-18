import { readFileSync } from "node:fs";
import path from "node:path";
import type { ProxyProfile } from "@/services/profile";

export type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** An import file (format "2025-01") holding `profiles`. */
export function configFile(profiles: ProxyProfile[]): FilePayload {
  return jsonFile({ version: "2025-01", profiles });
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
