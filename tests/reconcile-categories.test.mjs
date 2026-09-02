// reconcileCategories keeps builtin category *content* (keywords, labels,
// hints) coming from the current code on every load, while preserving only
// the user's own enabled/intensity choices from storage - otherwise a stale
// stored copy from an old install would silently shadow keyword updates
// shipped in a later version. See the comment above it in content/shield.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

const fnSrc = between(SHIELD_SRC, "function reconcileCategories", "async function getSettings");
const scope = {};
new Function("scope", `${fnSrc}\nscope.reconcileCategories = reconcileCategories;`)(scope);
const { reconcileCategories } = scope;

// Simulates: extension installed long ago with old category defs and some
// user customization, then the code shipped new keyword lists and a new
// category.
const staleStored = [
  { id: "doomscrolling-news", label: "Doomscrolling news", keywords: ["war", "disaster"], enabled: true, intensity: "balanced" },
  { id: "politics", label: "Politics & divisive content", keywords: ["election"], enabled: true, intensity: "gentle" },
  { id: "health-anxiety", label: "Health-anxiety spirals", keywords: ["symptom"], enabled: false, intensity: "gentle" },
];

const currentCode = [
  { id: "doomscrolling-news", label: "Doomscrolling news", keywords: ["war", "disaster", "deported"], enabled: true, intensity: "balanced" },
  { id: "politics", label: "Politics & divisive content", keywords: ["election", "senate"], enabled: true, intensity: "balanced" },
  { id: "health-anxiety", label: "Health-anxiety spirals", keywords: ["symptom", "tumor"], enabled: true, intensity: "gentle" },
  { id: "spoilers", label: "Spoilers", keywords: ["spoiler"], enabled: false, intensity: "strict" },
];

const result = reconcileCategories(staleStored, currentCode);
const byId = (id) => result.find((c) => c.id === id);

test("a newly shipped keyword reaches a user who installed an older version", () => {
  assert.ok(byId("doomscrolling-news").keywords.includes("deported"));
  assert.ok(byId("politics").keywords.includes("senate"));
});

test("the user's own intensity choice is preserved across a code update", () => {
  assert.equal(byId("politics").intensity, "gentle");
});

test("the user's own enabled=false choice is preserved across a code update", () => {
  assert.equal(byId("health-anxiety").enabled, false);
});

test("a brand-new category ships even though it isn't in old storage", () => {
  assert.ok(result.some((c) => c.id === "spoilers"));
});

test("the result reflects current code's category count, not stale storage's", () => {
  assert.equal(result.length, currentCode.length);
});
