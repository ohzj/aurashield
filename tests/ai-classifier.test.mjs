// Stress-tests AIClassifier's session reuse, call serialization, pending-work
// cap, and periodic session reset against a mock LanguageModel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHIELD_SRC, between } from "./_extract.mjs";

// Starts at the constants, not "class AIClassifier" - the class body
// references MAX_PENDING_CLASSIFICATIONS and SESSION_RESET_AFTER as free
// variables declared just above it, so both need to be in the sandboxed
// scope for the class's methods to run at all.
const classSrc = between(SHIELD_SRC, "const MAX_PENDING_CLASSIFICATIONS", "// ---- content/site-adapters.js");

function installMockLanguageModel() {
  const state = {
    createCallCount: 0,
    promptCallCount: 0,
    concurrentPrompts: 0,
    maxConcurrentPrompts: 0,
    shouldFailNext: false,
  };
  globalThis.LanguageModel = {
    async create() {
      state.createCallCount++;
      return {
        destroy() {},
        async prompt(promptText, { responseConstraint }) {
          state.promptCallCount++;
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

function loadModule() {
  const scope = { LanguageModel: globalThis.LanguageModel };
  new Function(
    "scope",
    `${classSrc}\n` +
      "scope.AIClassifier = AIClassifier; " +
      "scope.MAX_PENDING_CLASSIFICATIONS = MAX_PENDING_CLASSIFICATIONS; " +
      "scope.SESSION_RESET_AFTER = SESSION_RESET_AFTER;"
  )(scope);
  return scope;
}

const categories = [
  { id: "politics", label: "Politics", aiHint: "politics" },
  { id: "health-anxiety", label: "Health anxiety", aiHint: "health anxiety" },
];

test("a session is created once and reused across calls", async () => {
  const state = installMockLanguageModel();
  const { AIClassifier } = loadModule();
  const classifier = new AIClassifier();

  await classifier.classify("a politics story", categories);
  await classifier.classify("a health anxiety story", categories);

  assert.equal(state.createCallCount, 1);
});

test("concurrent classify() calls are serialized and each gets the right result", async () => {
  const state = installMockLanguageModel();
  const { AIClassifier } = loadModule();
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
  const { AIClassifier } = loadModule();
  const classifier = new AIClassifier();

  state.shouldFailNext = true;
  // classify() propagates a rejection - its only caller, handleCandidate() in
  // content/shield.js, always wraps the call in try/catch, so mirror that here.
  await assert.rejects(() => classifier.classify("a politics story", categories));

  const recovered = await classifier.classify("a health anxiety story", categories);
  assert.equal(recovered, "health-anxiety");
});

test("concurrent session creation does not race", async () => {
  const state = installMockLanguageModel();
  const { AIClassifier } = loadModule();
  const classifier = new AIClassifier();

  // If ensureSession() is awaited before joining the serial queue (the bug
  // this guards against), every one of these sees a null session and each
  // starts its own LanguageModel.create().
  await Promise.all([
    classifier.classify("a politics story", categories),
    classifier.classify("a health anxiety story", categories),
    classifier.classify("something unrelated", categories),
  ]);

  assert.equal(state.createCallCount, 1);
});

test("excess concurrent work beyond the pending cap is dropped, not queued unboundedly", async () => {
  const state = installMockLanguageModel();
  const { AIClassifier, MAX_PENDING_CLASSIFICATIONS } = loadModule();
  const classifier = new AIClassifier();

  const overCap = MAX_PENDING_CLASSIFICATIONS + 3;
  await Promise.all(
    Array.from({ length: overCap }, (_, i) => classifier.classify(`item ${i}, unrelated content`, categories))
  );

  assert.equal(
    state.promptCallCount,
    MAX_PENDING_CLASSIFICATIONS,
    `expected exactly ${MAX_PENDING_CLASSIFICATIONS} prompts to run despite ${overCap} concurrent classify() calls`
  );
});

test("the session is recreated after SESSION_RESET_AFTER calls", async () => {
  const state = installMockLanguageModel();
  const { AIClassifier, SESSION_RESET_AFTER } = loadModule();
  const classifier = new AIClassifier();

  for (let i = 0; i < SESSION_RESET_AFTER + 1; i++) {
    await classifier.classify(`item ${i}, unrelated content`, categories);
  }

  assert.equal(state.createCallCount, 2, "expected exactly one session reset after SESSION_RESET_AFTER calls");
});
