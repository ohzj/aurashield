// content/shield.js can't import shared/categories.js (static content_scripts
// can't use ES modules), so BUILTIN_CATEGORIES is duplicated by hand between
// the two files. Nothing else keeps them honest, and the failure mode if
// they drift is silent and hard to debug: the popup/options UI would show
// one category set while the content script actually filters on another.
// This test is the guard against that.
//
// Deliberately a structural comparison, not a text diff - the two copies are
// formatted differently (single-line vs multi-line arrays), so a naive diff
// would report a mismatch even when the data is identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES as SHARED_CATEGORIES } from "../shared/categories.js";
import { SHIELD_SRC, between } from "./_extract.mjs";

test("content/shield.js's inlined BUILTIN_CATEGORIES matches shared/categories.js exactly", () => {
  const literalSrc = between(SHIELD_SRC, "const BUILTIN_CATEGORIES = [", "// ---- shared/storage.js");
  const scope = {};
  new Function("scope", `${literalSrc}\nscope.BUILTIN_CATEGORIES = BUILTIN_CATEGORIES;`)(scope);

  assert.deepEqual(
    scope.BUILTIN_CATEGORIES,
    SHARED_CATEGORIES,
    "content/shield.js has drifted from shared/categories.js - update the inlined " +
      "copy in content/shield.js to match (see the comment at the top of that file " +
      "for why the duplication exists)."
  );
});
