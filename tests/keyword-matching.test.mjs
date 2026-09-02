// Verifies the keyword stage against the actual shipped regex/exclusion
// logic in content/shield.js: the trailing "s?" plural rule, the newly
// widened keyword lists, and the Sigma-style excludeKeywords suppression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

const categoriesSrc = between(SHIELD_SRC, "const BUILTIN_CATEGORIES", "// ---- shared/storage.js");
const buildPatternSrc = between(SHIELD_SRC, "function buildPattern", "function compileCategories");
const compileCategoriesSrc = between(SHIELD_SRC, "function compileCategories", "// Sigma-style detection");
const matchKeywordsSrc = between(SHIELD_SRC, "function matchKeywords", "// ---- content/ai-classifier.js");

const scope = {};
new Function(
  "scope",
  `${categoriesSrc}\n${buildPatternSrc}\n${compileCategoriesSrc}\n${matchKeywordsSrc}\n` +
    "scope.BUILTIN_CATEGORIES = BUILTIN_CATEGORIES; scope.compileCategories = compileCategories; " +
    "scope.matchKeywords = matchKeywords;"
)(scope);

const { BUILTIN_CATEGORIES, compileCategories, matchKeywords } = scope;
// Force every category "on" for these cases - this file is testing whether
// the keyword/exclusion patterns themselves are correct, not which
// categories ship enabled by default (that's a separate, deliberate product
// decision - see the "enabled: false" comment on health-anxiety).
const compiled = compileCategories(BUILTIN_CATEGORIES.map((c) => ({ ...c, enabled: true })));

const cases = [
  ["Democrats shocked after 2 members cross aisle to help Republicans", "politics", "plural forms (Republicans/Democrats) must match singular keywords"],
  ["Cubans living in Florida are being deported to Africa", "doomscrolling-news", "the 'deported' keyword"],
  ["Mitch McConnell Has Been Missing for 75 Days", null, "no keyword overlap - falls through to the AI stage"],
  ["The Legend of Zelda: Moonrise Regalia - F3 2026 Trailer", null, "clearly unrelated content must not false-positive"],
  ["Sinus Tumour 18M", null, "British spelling 'Tumour' does not match 'tumor' (a known gap, not a bug)"],
  ["I have a rare disease and need advice", "health-anxiety", "exact phrase match"],
  ["White House announces new policy on Supreme Court nominees", "politics", "'white house' / 'supreme court' keywords"],
  ["My favorite sandwich recipe", null, "benign content must not match anything"],
  ["Star Wars: new trailer drops today", null, "excludeKeywords suppresses 'war' matching 'Wars' via the plural rule"],
  ["Attack on Titan finale hits different", null, "excludeKeywords suppresses 'attack'"],
  ["Beautiful shooting star over the lake tonight", null, "excludeKeywords suppresses 'shooting'"],
  ["Russia's war on Ukraine enters new phase", "doomscrolling-news", "real war coverage still matches - exclusion is scoped, not a blanket 'war' suppressor"],
];

for (const [text, expected, why] of cases) {
  test(`matchKeywords: ${why}`, () => {
    assert.equal(matchKeywords(text, compiled), expected, `text: "${text}"`);
  });
}
