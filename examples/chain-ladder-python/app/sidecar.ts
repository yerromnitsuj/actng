/**
 * Sidecar resolution for the Python app: use a configured sidecar when the
 * environment provides one (CI does), otherwise LAUNCH one as a child that
 * lives and dies with this server. The per-boot token is random and stays in
 * this process — the browser never sees it, and neither does the terminal.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface SidecarHandle {
  url: string;
  token: string;
  launched: boolean;
  pid?: number;
  stop(): void;
}

const LAUNCH_PORT = 18091; // fixed non-default: never collides with a user's own 8091 sidecar

export async function resolveSidecar(repoRoot: string): Promise<SidecarHandle> {
  const envUrl = process.env.SIDECAR_URL;
  const envToken = process.env.SIDECAR_TOKEN;
  if (envUrl !== undefined && envUrl !== "" && envToken !== undefined && envToken !== "") {
    return { url: envUrl, token: envToken, launched: false, stop() {} };
  }
  const python = join(repoRoot, ".venv-interop", "bin", "python");
  if (!existsSync(python)) {
    throw new Error(
      "no sidecar configured and no .venv-interop to launch one from. Set it up once:\n" +
        "  python3.12 -m venv .venv-interop\n" +
        "  .venv-interop/bin/pip install -e interop/python\n" +
        "  .venv-interop/bin/pip install -r interop/sidecar/requirements.txt -r interop/sidecar/requirements-dev.txt",
    );
  }
  const token = randomBytes(24).toString("hex");
  const stderrTail: string[] = [];
  const child = spawn(python, ["-m", "sidecar"], {
    env: {
      ...process.env,
      PYTHONPATH: join(repoRoot, "interop"),
      SIDECAR_TOKEN: token,
      SIDECAR_PORT: String(LAUNCH_PORT),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d: Buffer) => {
    stderrTail.push(d.toString("utf8"));
    if (stderrTail.length > 20) stderrTail.shift();
  });
  const stop = () => {
    process.removeListener("exit", stop);
    if (child.exitCode === null) child.kill();
  };
  // Exit guard: fires on graceful exits so the child never outlives us. Under
  // tsx, SIGINT/SIGTERM are converted to a graceful exit by tsx's own
  // handler, which is what reaches this listener; a non-tsx runtime would
  // need its own signal handling to get the same guarantee.
  process.on("exit", stop);

  const url = `http://127.0.0.1:${LAUNCH_PORT}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`${url}/v1/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null || Date.now() > deadline) {
      stop();
      throw new Error(
        `the launched sidecar did not become healthy within 30s\n${stderrTail.join("").trim()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, token, launched: true, pid: child.pid, stop };
}
