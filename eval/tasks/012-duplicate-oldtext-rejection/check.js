import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const items = readFileSync("items.txt", "utf8");
assert.ok(items.includes("first: status: pending"), "first item should remain pending");
assert.ok(items.includes("second: status: done"), "second item should be done");

const tracePath = process.env.NANOCLAUDE_TRACE_PATH;
assert.ok(tracePath, "NANOCLAUDE_TRACE_PATH should be provided");
const traceText = readFileSync(tracePath, "utf8");
assert.match(traceText, /oldText appears multiple times/, "trace should record duplicate oldText rejection");

const result = spawnSync("npm", ["test"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
