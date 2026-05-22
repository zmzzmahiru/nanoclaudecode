import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const items = readFileSync("items.txt", "utf8");
assert.ok(items.includes("first: status: pending"));
assert.ok(items.includes("second: status: done"));
console.log("test passed");
