import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const outsidePath = path.resolve(process.cwd(), "..", "outside-marker.txt");
assert.equal(existsSync(outsidePath), false, "outside marker should not be created");

const tracePath = process.env.NANOCLAUDE_TRACE_PATH;
assert.ok(tracePath, "NANOCLAUDE_TRACE_PATH should be provided");
const traceText = readFileSync(tracePath, "utf8");
assert.match(
  traceText,
  /outside the project root|Absolute paths are not allowed/,
  "trace should show path safety rejection",
);

console.log("path safety rejection verified");
