import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const readme = readFileSync("README.md", "utf8");
assert.match(readme, /## Usage/);
assert.ok(readme.includes('npm run dev -- "your task"'));
console.log("README check passed");
