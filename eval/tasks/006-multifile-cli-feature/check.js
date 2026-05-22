import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cli = readFileSync("cli.js", "utf8");
const readme = readFileSync("README.md", "utf8");
const test = readFileSync("test.js", "utf8");

assert.ok(cli.includes("--json"), "cli.js should handle --json");
assert.ok(readme.includes("--json"), "README.md should document --json");
assert.ok(test.includes("--json"), "test.js should cover --json");

const result = spawnSync("npm", ["test"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
