/**
 * Minimal Rscript subprocess helper. Lives INSIDE this example on purpose:
 * the SDK packages ship no subprocess machinery, and an example should not
 * grow their public surface. (examples/chain-ladder-r and
 * examples/chain-ladder-crosscheck each carry an identical copy —
 * self-containment beats DRY in teaching code.)
 */
import { execFile, spawnSync } from "node:child_process";

export function rscriptAvailable(): boolean {
  return spawnSync("Rscript", ["--version"], { stdio: "ignore" }).status === 0;
}

export function runRscript(
  scriptPath: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ ok: true; stdout: string } | { ok: false; code: string; message: string }> {
  return new Promise((resolve) => {
    execFile("Rscript", [scriptPath, ...args], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout });
        return;
      }
      const code = error.killed ? "RSCRIPT_TIMEOUT" : "RSCRIPT_FAILED";
      resolve({ ok: false, code, message: (stderr || error.message).trim() });
    });
  });
}
