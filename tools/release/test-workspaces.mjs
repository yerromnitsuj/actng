import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scripts = JSON.parse(
  execFileSync("npm", ["pkg", "get", "scripts.test", "--workspaces"], {
    cwd: root,
    encoding: "utf8",
  }),
);
for (const [name, script] of Object.entries(scripts)) {
  if (script !== "vitest run")
    throw new Error(
      `release test runner must be taught the test command for ${name}: ${script}`,
    );
}
execFileSync(
  "npm",
  [
    "run",
    "test",
    "--workspaces",
    "--if-present",
    "--",
    "--reporter=default",
    `--reporter=${path.join(root, "tools/release/no-skips-reporter.mjs")}`,
  ],
  { cwd: root, stdio: "inherit" },
);
