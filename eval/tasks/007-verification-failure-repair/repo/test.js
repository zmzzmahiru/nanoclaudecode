import assert from "node:assert/strict";
import { slugify } from "./src/slug.js";

assert.equal(slugify("Hello, Nano Claude!"), "hello-nano-claude");
assert.equal(slugify("  Two   Spaces  "), "two-spaces");
console.log("test passed");
