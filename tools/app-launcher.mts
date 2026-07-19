#!/usr/bin/env tsx
/**
 * One front door for the three interactive chain-ladder apps. The menu picks
 * an engine; everything after that is the chosen example's own `app` script —
 * this launcher adds no behavior of its own beyond preflight and delegation.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Engine {
  key: "typescript" | "python" | "r";
  pkg: string;
  port: number;
  label: string;
  preflight(): string | null; // remedy text when not runnable, null when fine
}

const ENGINES: Engine[] = [
  {
    key: "typescript",
    pkg: "@actuarial-ts/example-chain-ladder-typescript",
    port: 8791,
    label: "TypeScript — in-process",
    preflight: () => null,
  },
  {
    key: "python",
    pkg: "@actuarial-ts/example-chain-ladder-python",
    port: 8792,
    label: "Python     — chainladder sidecar, auto-boot",
    preflight: () =>
      existsSync(join(REPO_ROOT, ".venv-interop", "bin", "python"))
        ? null
        : "no .venv-interop — set it up once:\n" +
          "  python3.12 -m venv .venv-interop\n" +
          "  .venv-interop/bin/pip install -e interop/python -r interop/sidecar/requirements.txt",
  },
  {
    key: "r",
    pkg: "@actuarial-ts/example-chain-ladder-r",
    port: 8793,
    label: "R          — Rscript subprocess",
    preflight: () =>
      spawnSync("Rscript", ["--version"], { stdio: "ignore" }).status === 0
        ? null
        : "Rscript is not on PATH — install with:\n  brew install r   # then see tools/interop/README.md",
  },
];

const ALIASES: Record<string, Engine["key"]> = {
  "1": "typescript", ts: "typescript", typescript: "typescript",
  "2": "python", py: "python", python: "python",
  "3": "r", r: "r",
};

function menu(): string {
  return (
    "Which engine?\n" +
    ENGINES.map((e, i) => `  ${i + 1}) ${e.label}  http://127.0.0.1:${e.port}`).join("\n")
  );
}

async function choose(): Promise<Engine> {
  const arg = process.argv[2]?.toLowerCase();
  if (arg !== undefined) {
    const key = ALIASES[arg];
    if (key === undefined) {
      console.error(`unknown engine "${arg}"\n${menu()}\n(or: npm run app -- <ts|python|r>)`);
      process.exit(2);
    }
    return ENGINES.find((e) => e.key === key)!;
  }
  if (!process.stdin.isTTY) {
    console.error(`${menu()}\nno TTY: pick one non-interactively with npm run app -- <ts|python|r>`);
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const answer = (await rl.question(`${menu()}\n> `)).trim().toLowerCase();
    const key = ALIASES[answer];
    if (key !== undefined) {
      rl.close();
      return ENGINES.find((e) => e.key === key)!;
    }
    console.log(`didn't catch that — enter 1, 2, 3, ts, python, or r\n`);
  }
}

const engine = await choose();
const remedy = engine.preflight();
if (remedy !== null) {
  console.error(remedy);
  process.exit(2);
}
console.log(
  process.env.ANTHROPIC_API_KEY
    ? "advisor: enabled"
    : "advisor: disabled (export ANTHROPIC_API_KEY=... to enable the chat panel)",
);
console.log(`launching ${engine.key} → http://127.0.0.1:${engine.port}\n`);
const child = spawn("npm", ["run", "app", "-w", engine.pkg], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
