import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAttestation, workspaces } from "./release-evidence.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// Verify all packages before the first registry write. Publish the exact tested
// archives, not a new pack that could run a mutating lifecycle hook.
const attestation = verifyAttestation(root);
for (const workspace of workspaces) {
  const name = `@actuarial-ts/${workspace}`;
  verifyAttestation(root, name);
  execFileSync(
    "npm",
    [
      "publish",
      path.join(root, ".release/tarballs", attestation.packages[name].filename),
      "--ignore-scripts",
      "--access",
      "public",
    ],
    { cwd: root, stdio: "inherit" },
  );
}
