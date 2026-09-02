import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInsights } from "../shared/insights.js";

const DAY = 24 * 60 * 60 * 1000;

function entry({ daysAgo, hour, categoryId = "politics", hostname = "www.reddit.com", revealed = false }) {
  const d = new Date(2026, 8, 2, hour, 0, 0, 0); // Sept 2, 2026, local time
  d.setDate(d.getDate() - daysAgo);
  return { id: `${daysAgo}-${hour}-${Math.random()}`, ts: d.getTime(), categoryId, hostname, source: "keyword", revealed };
}

const now = new Date(2026, 8, 2, 12, 0, 0, 0);

test("entries older than a week are excluded", () => {
  const history = [entry({ daysAgo: 6, hour: 10 }), entry({ daysAgo: 8, hour: 10 })];
  const result = computeInsights(history, now);
  assert.equal(result.totalThisWeek, 1);
});

test("empty history produces a null reveal rate, not NaN or a crash", () => {
  const result = computeInsights([], now);
  assert.equal(result.totalThisWeek, 0);
  assert.equal(result.revealRate, null);
  assert.equal(result.topCategory, null);
  assert.equal(result.topHost, null);
});

test("reveal rate reflects how many of this week's shields were actually revealed", () => {
  const history = [
    entry({ daysAgo: 1, hour: 10, revealed: true }),
    entry({ daysAgo: 1, hour: 11, revealed: true }),
    entry({ daysAgo: 1, hour: 12, revealed: false }),
    entry({ daysAgo: 1, hour: 13, revealed: false }),
  ];
  const result = computeInsights(history, now);
  assert.equal(result.revealedThisWeek, 2);
  assert.equal(result.revealRate, 0.5);
});

test("the most frequent category and site are correctly identified", () => {
  const history = [
    entry({ daysAgo: 1, hour: 10, categoryId: "politics", hostname: "www.reddit.com" }),
    entry({ daysAgo: 1, hour: 11, categoryId: "politics", hostname: "www.reddit.com" }),
    entry({ daysAgo: 1, hour: 12, categoryId: "doomscrolling-news", hostname: "news.google.com" }),
  ];
  const result = computeInsights(history, now);
  assert.equal(result.topCategory.categoryId, "politics");
  assert.equal(result.topCategory.count, 2);
  assert.equal(result.topHost.hostname, "www.reddit.com");
  assert.equal(result.topHost.count, 2);
});

test("late-night (10pm-2am) shields are counted separately", () => {
  const history = [
    entry({ daysAgo: 1, hour: 23 }), // late night
    entry({ daysAgo: 1, hour: 1 }), // late night
    entry({ daysAgo: 1, hour: 14 }), // afternoon
  ];
  const result = computeInsights(history, now);
  assert.equal(result.lateNightCount, 2);
  assert.equal(result.lateNightShare, 2 / 3);
});
