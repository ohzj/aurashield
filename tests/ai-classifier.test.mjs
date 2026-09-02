// Stress-tests AIClassifier's session reuse and call serialization against a
// mock LanguageModel: concurrent classify() calls, and one call's failure
// not poisoning the queue for the next one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

const classSrc = between(SHIELD_SRC, "class AIClassifier", "// ---- content/site-adapters.js");

function installMockLanguageModel() {
  const state = { createCallCount: 0, concurrentPrompts: 0, maxConcurrentPrompts: 0, shouldFailNext: false };
  globalThis.LanguageModel = {
    async create() {
      state.createCallCount++;
      return {
        async prompt(promptText, { responseConstraint }) {
          state.concurrentPrompts++;
          state.maxConcurrentPrompts = Math.max(state.maxConcurrentPrompts, state.concurrentPrompts);
          await new Promise((r) => setTimeout(r, 15)); // simulate inference latency
          state.concurrentPrompts--;

          if (state.shouldFailNext) {
            state.shouldFailNext = false;
            throw new Error("simulated model failure");
          }
          const snippet = (promptText.match(/Snippet: "([^"]*)"/)?.[1] || "").toLowerCase();
          const id = responseConstraint.properties.category.enum.find(
            (candidate) => candidate !== "none" && snippet.includes(candidate.replace(/-/g, " "))
          );
          return JSON.stringify({ category: id || "none" });
        },
      };
    },
  };
  return state;
}

function loadAIClassifier() {
  const scope = { LanguageModel: globalThis.LanguageModel };
  new Function("scope", `${classSrc}\nscope.AIClassifier = AIClassifier;`)(scope);
  return scope.AIClassifier;
}

const categories = [
  { id: "politics", label: "Politics", aiHint: "politics" },
  { id: "health-anxiety", label: "Health anxiety", aiHint: "health anxiety" },
];

test("a session is created once and reused across calls", async () => {
  const state = installMockLanguageModel();
  const AIClassifier = loadAIClassifier();
  const classifier = new AIClassifier();

  await classifier.classify("a politics story", categories);
  await classifier.classify("a health anxiety story", categories);

  assert.equal(state.createCallCount, 1);
});

test("concurrent classify() calls are serialized and each gets the right result", async () => {
  const state = installMockLanguageModel();
  const AIClassifier = loadAIClassifier();
  const classifier = new AIClassifier();

  const results = await Promise.all([
    classifier.classify("a politics story", categories),
    classifier.classify("a health anxiety story", categories),
    classifier.classify("something unrelated", categories),
  ]);

  assert.equal(state.maxConcurrentPrompts, 1, "no more than one prompt should be in flight at a time");
  assert.deepEqual(results, ["politics", "health-anxiety", null]);
});

test("a failed call does not break subsequent calls in the queue", async () => {
  const state = installMockLanguageModel();
  const AIClassifier = loadAIClassifier();
  const classifier = new AIClassifier();

  state.shouldFailNext = true;
  // classify() propagates a rejection - its only caller, handleCandidate() in
  // content/shield.js, always wraps the call in try/catch, so mirror that here.
  await assert.rejects(() => classifier.classify("a politics story", categories));

  const recovered = await classifier.classify("a health anxiety story", categories);
  assert.equal(recovered, "health-anxiety");
});
