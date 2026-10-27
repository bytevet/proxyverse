import { Host } from "@/adapters";
import { SYNC_BUILD } from "./buildEnv";

/** Where sync talks to, and the OAuth endpoints it finds there (spec §2.1). */

// e2e builds only: points the extension at a test server
const keyDevOrigin = "sync.devOrigin";
// session storage: discovery is cheap, but needn't run on every token refresh
const keyDiscovery = "sync.discovery";

/** The byte.vet origin serving OAuth and the sync API, no trailing slash. */
export async function syncOrigin(): Promise<string> {
  if (SYNC_BUILD.allowOriginOverride) {
    const override = await Host.get<string>(keyDevOrigin);
    if (override) return override.replace(/\/+$/, "");
  }
  return SYNC_BUILD.origin;
}

/** The authorization server metadata we use (RFC 8414). */
export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  userinfo_endpoint: string;
  scopes_supported?: string[];
};

const ENDPOINTS = [
  "authorization_endpoint",
  "token_endpoint",
  "revocation_endpoint",
  "userinfo_endpoint",
] as const;

/**
 * The OAuth endpoints of `origin`, from its discovery document. Cached per
 * origin for the browser session. Throws if the document is unreachable or
 * lacks an endpoint, or names an issuer on another origin.
 */
export async function discover(
  origin: string,
  fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)
): Promise<Discovery> {
  const cache = (await Host.getSession<Record<string, Discovery>>(keyDiscovery)) ?? {};
  if (cache[origin]) return cache[origin];

  const url = `${origin}/.well-known/oauth-authorization-server`;
  // no cookies to byte.vet, see NO_COOKIES in auth.ts
  const res = await fetchImpl(url, {
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw Error(`Discovery failed: HTTP ${res.status} from ${url}`);
  const metadata = validateDiscovery(origin, await res.json());

  await Host.setSession(keyDiscovery, { ...cache, [origin]: metadata });
  return metadata;
}

function validateDiscovery(origin: string, doc: unknown): Discovery {
  if (typeof doc !== "object" || doc === null) {
    throw Error("Discovery: not a JSON object");
  }
  const d = doc as Record<string, unknown>;

  // byte.vet's issuer is `<origin>/api/auth`: same origin, not equal to it
  if (typeof d.issuer !== "string" || originOf(d.issuer) !== originOf(origin)) {
    throw Error(`Discovery: issuer ${String(d.issuer)} is not on ${origin}`);
  }
  for (const key of ENDPOINTS) {
    if (typeof d[key] !== "string" || !originOf(d[key])) {
      throw Error(`Discovery: missing ${key}`);
    }
  }

  const metadata: Discovery = {
    issuer: d.issuer,
    authorization_endpoint: d.authorization_endpoint as string,
    token_endpoint: d.token_endpoint as string,
    revocation_endpoint: d.revocation_endpoint as string,
    userinfo_endpoint: d.userinfo_endpoint as string,
  };
  if (Array.isArray(d.scopes_supported)) {
    metadata.scopes_supported = d.scopes_supported.filter(
      (s): s is string => typeof s === "string"
    );
  }
  return metadata;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
