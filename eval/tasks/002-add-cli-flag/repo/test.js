import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("node", ["cli.js", ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  return result.stdout.trim();
}

assert.equal(run(["--name", "Ada"]), "Hello, Ada");
assert.equal(run(["--name", "Ada", "--shout"]), "HELLO, ADA");
console.log("test passed");
