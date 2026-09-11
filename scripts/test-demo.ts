import assert from "node:assert/strict";
import { DEMO_DASHBOARD, DEMO_MAX_CHARS, DEMO_MODEL, DEMO_SYSTEM_PROMPT, demoMessage } from "../src/lib/demo";

assert.equal(DEMO_MODEL.endsWith(":free"), true);
assert.equal(DEMO_DASHBOARD.stats.sessions, 4);
assert.equal(DEMO_DASHBOARD.tasks.length, 3);
assert.equal(demoMessage("  hello  "), "hello");
assert.equal(demoMessage(null), "");
assert.equal(demoMessage("x".repeat(DEMO_MAX_CHARS + 50)).length, DEMO_MAX_CHARS);
assert.match(DEMO_SYSTEM_PROMPT, /public portfolio demo/i);
assert.match(DEMO_SYSTEM_PROMPT, /no tools/i);
assert.match(DEMO_SYSTEM_PROMPT, /no access to a user's account/i);
console.log(`Demo policy tests passed (model: ${DEMO_MODEL})`);
