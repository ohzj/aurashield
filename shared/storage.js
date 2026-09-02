import { BUILTIN_CATEGORIES } from "./categories.js";

// Local date, not UTC - toISOString().slice(0,10) rolls the "day" over at
// UTC midnight, which is 8pm Eastern. Every "today" claim in the UI was
// wrong for most of the world for most of the day.
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const DEFAULT_SETTINGS = {
  enabled: true,
  categories: BUILTIN_CATEGORIES,
  customCategories: [],
  disabledSites: [],
  stats: { date: todayKey(), count: 0 },
};

// Caps how many shield events are remembered for the insights view - old
// entries are dropped once this is exceeded rather than growing forever.
// Never stores the shielded text itself, only category/site/time metadata.
const MAX_HISTORY_ENTRIES = 2000;

// chrome.storage.local persists whatever was written on first install
// forever - a code change to a builtin category's keywords/label/aiHint
// would otherwise be silently shadowed by the stale stored copy. Builtin
// category *content* always comes from the current code; only the user's
// own enabled/intensity choices are read back from storage.
function reconcileCategories(storedCategories, currentDefs) {
  const stored = storedCategories || [];
  return currentDefs.map((def) => {
    const existing = stored.find((c) => c.id === def.id);
    return existing ? { ...def, enabled: existing.enabled, intensity: existing.intensity } : def;
  });
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  stored.categories = reconcileCategories(stored.categories, BUILTIN_CATEGORIES);
  // Roll stats over to a fresh day without losing the rest of the settings.
  if (stored.stats?.date !== todayKey()) {
    stored.stats = { date: todayKey(), count: 0 };
    await chrome.storage.local.set({ stats: stored.stats });
  }
  return stored;
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

// Every mutating storage operation below is a read-modify-write against the
// same chrome.storage.local keys. Two of these firing concurrently (e.g. a
// burst of shields in a busy feed, each sending its own runtime message)
// would otherwise interleave: both read the same starting value, and
// whichever writes last wins, silently losing the other's update. Routing
// every write through one promise chain makes them run one at a time.
let writeQueue = Promise.resolve();
function serializeWrite(fn) {
  const run = writeQueue.then(fn);
  writeQueue = run.catch(() => {});
  return run;
}

export async function incrementShieldedCount() {
  return serializeWrite(async () => {
    const { stats } = await getSettings();
    const next = { date: todayKey(), count: stats.count + 1 };
    await chrome.storage.local.set({ stats: next });
    return next;
  });
}

export async function getHistory() {
  const { history } = await chrome.storage.local.get({ history: [] });
  return history;
}

// entry: { id, ts, categoryId, hostname, source, revealed }. Deliberately
// never includes the shielded text or URL - see the comment on
// MAX_HISTORY_ENTRIES above.
export async function appendHistoryEntry(entry) {
  return serializeWrite(async () => {
    const history = await getHistory();
    history.push(entry);
    if (history.length > MAX_HISTORY_ENTRIES) history.splice(0, history.length - MAX_HISTORY_ENTRIES);
    await chrome.storage.local.set({ history });
    return history;
  });
}

export async function markRevealed(id) {
  return serializeWrite(async () => {
    const history = await getHistory();
    const idx = history.findIndex((e) => e.id === id);
    if (idx !== -1) {
      history[idx] = { ...history[idx], revealed: true };
      await chrome.storage.local.set({ history });
    }
    return history;
  });
}

export async function clearHistory() {
  return serializeWrite(async () => {
    await chrome.storage.local.set({ history: [] });
  });
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") callback(changes);
  });
}
