import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const tracePath = process.env.NANOCLAUDE_TRACE_PATH;
assert.ok(tracePath, "NANOCLAUDE_TRACE_PATH should be provided");

const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const stepTypes = new Set((trace.steps ?? []).map((step) => step.type));

for (const type of ["tool_call", "tool_result", "edit_applied", "verification", "final"]) {
  assert.ok(stepTypes.has(type), `trace should include ${type}`);
}

const result = spawnSync("npm", ["test"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
