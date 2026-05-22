import assert from "node:assert/strict";
import { message } from "./src/message.js";

assert.equal(message, "trace-ready");
console.log("test passed");
