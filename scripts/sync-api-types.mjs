// Regenerates src/services/sync/api.gen.ts from the vendored sync API
// contract (docs/sync-api.openapi.yaml), and stamps it with the contract's
// SHA-256 so a unit test notices when the two drift apart.
//
// openapi-typescript runs through npx rather than as a dependency: its
// TypeScript peer is 5.x and this repo is on 6.x.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SPEC = "docs/sync-api.openapi.yaml";
const OUT = "src/services/sync/api.gen.ts";

execFileSync(
  "npx",
  ["-y", "openapi-typescript@7.13.0", SPEC, "-o", OUT],
  { cwd: root, stdio: "inherit" }
);

const hash = createHash("sha256")
  .update(readFileSync(`${root}/${SPEC}`))
  .digest("hex");
const generated = readFileSync(`${root}/${OUT}`, "utf8");
writeFileSync(
  `${root}/${OUT}`,
  `// Generated from ${SPEC} by \`npm run sync:api-types\`.\n` +
    `// openapi-sha256: ${hash}\n` +
    generated
);
