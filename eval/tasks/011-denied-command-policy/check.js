import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

assert.equal(existsSync("sudo-ran.txt"), false, "denied command should not run");

const tracePath = process.env.NANOCLAUDE_TRACE_PATH;
assert.ok(tracePath, "NANOCLAUDE_TRACE_PATH should be provided");
const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const decisions = (trace.steps ?? []).filter(
  (step) => step.type === "permission_decision",
);

assert.ok(
  decisions.some(
    (step) => step.decision === "deny" && String(step.command).includes("sudo"),
  ),
  "trace should include a denied sudo permission decision",
);

console.log("denied command verified");
