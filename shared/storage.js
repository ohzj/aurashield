import { BUILTIN_CATEGORIES } from "./categories.js";

const todayKey = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_SETTINGS = {
  enabled: true,
  categories: BUILTIN_CATEGORIES,
  customCategories: [],
  disabledSites: [],
  stats: { date: todayKey(), count: 0 },
};

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

export async function incrementShieldedCount() {
  const { stats } = await getSettings();
  const next = { date: todayKey(), count: stats.count + 1 };
  await chrome.storage.local.set({ stats: next });
  return next;
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") callback(changes);
  });
}
