import { execFileSync } from "node:child_process";

const packages = ["core", "interchange", "data", "compliance", "agents"];
for (const workspace of packages) {
  const name = `@actuarial-ts/${workspace}`;
  execFileSync(
    process.execPath,
    ["tools/release/verify-release-attestation.mjs", name],
    { stdio: "inherit" },
  );
}
for (const workspace of packages) {
  execFileSync(
    "npm",
    [
      "publish",
      "--workspace",
      `@actuarial-ts/${workspace}`,
      "--access",
      "public",
    ],
    { stdio: "inherit" },
  );
}
