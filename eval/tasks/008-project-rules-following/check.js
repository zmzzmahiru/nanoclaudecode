import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const source = readFileSync("src/validate.js", "utf8");
assert.ok(source.includes("NanoClaude:"), "error message should use NanoClaude prefix");
assert.ok(!source.includes("export default"), "project rules disallow default export");

const result = spawnSync("npm", ["test"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
