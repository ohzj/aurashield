// Turns the raw history log into the numbers that actually matter for a
// wellbeing tool - not just "how many", but "is this helping". Kept as a
// pure function of (history, now) so it's trivial to test without mocking
// chrome.storage or the system clock.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 10pm-2am, local time - the window the AASM sleep finding this product's
// own pitch cites is about. Not a precise clinical boundary, just a
// reasonable "late night" proxy worth surfacing.
const LATE_NIGHT_HOURS = new Set([22, 23, 0, 1]);

export function computeInsights(history, now = new Date()) {
  const cutoff = now.getTime() - WEEK_MS;
  const recent = history.filter((e) => e.ts >= cutoff);

  const byCategory = new Map();
  const byHost = new Map();
  const byHour = new Array(24).fill(0);
  let revealedCount = 0;
  let lateNightCount = 0;

  for (const entry of recent) {
    const cat = byCategory.get(entry.categoryId) || { count: 0, revealed: 0 };
    cat.count++;
    if (entry.revealed) cat.revealed++;
    byCategory.set(entry.categoryId, cat);

    byHost.set(entry.hostname, (byHost.get(entry.hostname) || 0) + 1);

    if (entry.revealed) revealedCount++;

    const hour = new Date(entry.ts).getHours();
    byHour[hour]++;
    if (LATE_NIGHT_HOURS.has(hour)) lateNightCount++;
  }

  const topCategoryEntry = [...byCategory.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const topHostEntry = [...byHost.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    totalThisWeek: recent.length,
    revealedThisWeek: revealedCount,
    revealRate: recent.length > 0 ? revealedCount / recent.length : null,
    topCategory: topCategoryEntry ? { categoryId: topCategoryEntry[0], ...topCategoryEntry[1] } : null,
    topHost: topHostEntry ? { hostname: topHostEntry[0], count: topHostEntry[1] } : null,
    lateNightCount,
    lateNightShare: recent.length > 0 ? lateNightCount / recent.length : null,
    byCategory: Object.fromEntries(byCategory),
  };
}
