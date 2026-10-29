import { expect, test } from "vitest";
import spec from "@/../docs/sync-api.openapi.yaml?raw";
import generated from "@/services/sync/api.gen.ts?raw";

// api.gen.ts is stamped with the SHA-256 of the contract it came from
// (scripts/sync-api-types.mjs); a contract update without regenerating
// fails here.
test("api.gen.ts matches the vendored OpenAPI contract", async () => {
  const stamped = /^\/\/ openapi-sha256: ([0-9a-f]{64})$/m.exec(generated)?.[1];
  const bytes = new TextEncoder().encode(spec);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  expect(stamped === actual, "regenerate: npm run sync:api-types").toBe(true);
});
