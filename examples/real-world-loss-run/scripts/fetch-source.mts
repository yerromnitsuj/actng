import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE } from "../src/sourceManifest.js";

const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(exampleRoot, ".cache/freclaimset2motor.rda");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function existingSourceIsValid(): Promise<boolean> {
  try {
    return sha256(await readFile(destination)) === SOURCE.sourceSha256;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

if (await existingSourceIsValid()) {
  console.log(`Verified cached source: ${destination}`);
} else {
  const response = await fetch(SOURCE.pinnedUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Source download failed: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualHash = sha256(bytes);
  if (actualHash !== SOURCE.sourceSha256) {
    throw new Error(
      `Source integrity mismatch: expected ${SOURCE.sourceSha256}, received ${actualHash}; nothing was written`,
    );
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  console.log(`Downloaded and verified ${bytes.length.toLocaleString("en-US")} bytes: ${destination}`);
}
