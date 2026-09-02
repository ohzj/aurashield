import { DEFAULT_SETTINGS, incrementShieldedCount, getSettings } from "../shared/storage.js";

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    const existing = await chrome.storage.local.get(null);
    const merged = { ...DEFAULT_SETTINGS, ...existing };
    await chrome.storage.local.set(merged);
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  }
  refreshBadge();
});

chrome.runtime.onStartup?.addListener(refreshBadge);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHIELD_INCREMENT") {
    incrementShieldedCount().then((stats) => {
      setBadge(stats.count);
      sendResponse({ ok: true, count: stats.count });
    });
    return true; // async response
  }
});

async function refreshBadge() {
  const { stats } = await getSettings();
  setBadge(stats.count);
}

function setBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2F6B5E" });
}

refreshBadge();
