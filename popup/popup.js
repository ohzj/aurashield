import { getSettings, saveSettings } from "../shared/storage.js";
import { checkAvailability } from "../shared/ai-status.js";

const els = {
  masterToggle: document.getElementById("master-toggle"),
  statCount: document.getElementById("stat-count"),
  siteRow: document.getElementById("site-row"),
  siteHost: document.getElementById("site-host"),
  siteToggle: document.getElementById("site-toggle"),
  aiStatus: document.getElementById("ai-status"),
  aiStatusText: document.getElementById("ai-status-text"),
  aiEnableBtn: document.getElementById("ai-enable-btn"),
  aiProgress: document.getElementById("ai-progress"),
  categoryList: document.getElementById("category-list"),
  openOptions: document.getElementById("open-options"),
};

async function currentTabHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

async function render() {
  const settings = await getSettings();
  els.masterToggle.checked = settings.enabled;
  els.statCount.textContent = settings.stats.count;

  const host = await currentTabHost();
  if (host) {
    els.siteRow.hidden = false;
    els.siteHost.textContent = host;
    els.siteToggle.checked = !settings.disabledSites.includes(host);
    els.siteToggle.onchange = () => setSiteEnabled(host, els.siteToggle.checked);
  } else {
    els.siteRow.hidden = true;
  }

  els.categoryList.innerHTML = "";
  for (const cat of settings.categories) {
    const li = document.createElement("li");
    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = cat.enabled;
    checkbox.addEventListener("change", () => setCategoryEnabled(cat.id, checkbox.checked));

    const name = document.createElement("span");
    name.className = "cat-name";
    name.textContent = cat.label;

    const intensity = document.createElement("span");
    intensity.className = "cat-intensity";
    intensity.textContent = cat.intensity;

    label.append(checkbox, name, intensity);
    li.append(label);
    els.categoryList.append(li);
  }
}

async function setCategoryEnabled(id, isEnabled) {
  const settings = await getSettings();
  const categories = settings.categories.map((c) => (c.id === id ? { ...c, enabled: isEnabled } : c));
  await saveSettings({ categories });
}

async function setSiteEnabled(host, isEnabled) {
  const settings = await getSettings();
  const disabledSites = isEnabled
    ? settings.disabledSites.filter((h) => h !== host)
    : [...settings.disabledSites, host];
  await saveSettings({ disabledSites });
}

els.masterToggle.addEventListener("change", async () => {
  await saveSettings({ enabled: els.masterToggle.checked });
});

els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function renderAiStatus() {
  const status = await checkAvailability();
  els.aiStatus.classList.remove("unsupported", "unavailable");

  const copy = {
    available: "On-device AI is active. Topic understanding runs locally via Gemini Nano.",
    downloadable: "On-device AI is ready to set up (one-time download, stays on this device).",
    downloading: "Downloading the on-device model…",
    unavailable: "On-device AI isn't available on this device right now. Running in keyword-only mode.",
    unsupported: "This browser doesn't support on-device AI yet. Running in keyword-only mode.",
  };
  els.aiStatusText.textContent = copy[status] || copy.unsupported;

  if (status === "unavailable" || status === "unsupported") {
    els.aiStatus.classList.add(status);
  }

  els.aiEnableBtn.hidden = status !== "downloadable";
  els.aiProgress.hidden = status !== "downloading";
}

els.aiEnableBtn.addEventListener("click", async () => {
  els.aiEnableBtn.hidden = true;
  els.aiProgress.hidden = false;
  els.aiStatusText.textContent = "Downloading the on-device model… this can take a few minutes.";
  try {
    await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          els.aiProgress.value = Math.round((e.loaded || 0) * 100);
        });
      },
    });
    els.aiStatusText.textContent = "On-device AI is active. Topic understanding runs locally via Gemini Nano.";
    els.aiProgress.hidden = true;
  } catch (err) {
    els.aiStatus.classList.add("unavailable");
    els.aiStatusText.textContent = `Couldn't enable on-device AI: ${err.message}`;
    els.aiProgress.hidden = true;
  }
});

render();
renderAiStatus();
