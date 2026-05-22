import assert from "node:assert/strict";
import { isEven } from "./src/is-even.js";

assert.equal(isEven(2), true);
assert.equal(isEven(3), false);
console.log("test passed");
