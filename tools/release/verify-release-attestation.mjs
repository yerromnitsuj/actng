import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAttestation } from "./release-evidence.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const name = process.argv[2] ?? process.env.npm_package_name;
const attestation = verifyAttestation(
  root,
  name?.startsWith("@actuarial-ts/") ? name : undefined,
);
console.log(
  `release attestation verified for ${name ?? "all five packages"}@${attestation.version}`,
);
