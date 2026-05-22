import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const testSource = readFileSync("test.js", "utf8");
assert.ok(testSource.includes("isEven(0)"), "test.js should cover isEven(0)");

const result = spawnSync("npm", ["test"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
