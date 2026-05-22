import assert from "node:assert/strict";
import { validateName } from "./src/validate.js";

assert.equal(validateName("Ada"), "ok");
assert.equal(validateName(""), "NanoClaude: missing name");
console.log("test passed");
