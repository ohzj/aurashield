// todayKey() previously used toISOString().slice(0,10), which is UTC - a
// US-Eastern user's "day" rolled over at 8pm local time. This guards against
// regressing back to a UTC-based implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

const fnSrc = between(SHIELD_SRC, "const todayKey", "const DEFAULT_SETTINGS");

test("todayKey does not use toISOString (UTC) and uses local date getters", () => {
  assert.ok(!fnSrc.includes("toISOString"), "todayKey should not derive its value from toISOString(), which is UTC");
  assert.match(fnSrc, /getFullYear/);
  assert.match(fnSrc, /getMonth/);
  assert.match(fnSrc, /getDate\(\)/);
});

test("todayKey produces a zero-padded YYYY-MM-DD string", () => {
  const scope = {};
  new Function("scope", `${fnSrc}\nscope.todayKey = todayKey;`)(scope);
  assert.match(scope.todayKey(), /^\d{4}-\d{2}-\d{2}$/);
});
