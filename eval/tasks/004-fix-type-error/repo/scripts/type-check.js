import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = readFileSync("src/config.ts", "utf8");
assert.ok(
  !source.includes('port: number = "3000"'),
  "port should be assigned a number, not a string",
);
assert.match(source, /port:\s*number\s*=\s*3000/);
console.log("build passed");
