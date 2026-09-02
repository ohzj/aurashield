import { getSettings, saveSettings } from "../shared/storage.js";
import { BUILTIN_CATEGORIES, INTENSITIES } from "../shared/categories.js";
import { checkAvailability } from "../shared/ai-status.js";

const tbody = document.getElementById("category-tbody");
const form = document.getElementById("custom-form");
const resetBtn = document.getElementById("reset-btn");

function intensitySelect(current) {
  const select = document.createElement("select");
  for (const level of INTENSITIES) {
    const opt = document.createElement("option");
    opt.value = level;
    opt.textContent = level[0].toUpperCase() + level.slice(1);
    if (level === current) opt.selected = true;
    select.append(opt);
  }
  return select;
}

async function render() {
  const settings = await getSettings();
  tbody.innerHTML = "";

  const rows = [
    ...settings.categories.map((c) => ({ ...c, custom: false })),
    ...settings.customCategories.map((c) => ({ ...c, custom: true })),
  ];

  for (const cat of rows) {
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = cat.enabled;
    checkbox.setAttribute("aria-label", `Enable ${cat.label}`);
    checkbox.addEventListener("change", () => updateCategory(cat, cat.custom, { enabled: checkbox.checked }));
    tdCheck.append(checkbox);

    const tdName = document.createElement("th");
    tdName.scope = "row";
    tdName.textContent = cat.label;
    if (cat.custom) {
      const tag = document.createElement("span");
      tag.className = "tag-custom";
      tag.textContent = "Custom";
      tdName.append(tag);
    }

    const tdIntensity = document.createElement("td");
    const select = intensitySelect(cat.intensity);
    select.setAttribute("aria-label", `Intensity for ${cat.label}`);
    select.addEventListener("change", () => updateCategory(cat, cat.custom, { intensity: select.value }));
    tdIntensity.append(select);

    const tdActions = document.createElement("td");
    if (cat.custom) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-remove";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${cat.label}`);
      removeBtn.addEventListener("click", () => removeCustomCategory(cat.id));
      tdActions.append(removeBtn);
    }

    tr.append(tdCheck, tdName, tdIntensity, tdActions);
    tbody.append(tr);
  }
}

async function updateCategory(cat, isCustom, patch) {
  const settings = await getSettings();
  if (isCustom) {
    const customCategories = settings.customCategories.map((c) => (c.id === cat.id ? { ...c, ...patch } : c));
    await saveSettings({ customCategories });
  } else {
    const categories = settings.categories.map((c) => (c.id === cat.id ? { ...c, ...patch } : c));
    await saveSettings({ categories });
  }
}

async function removeCustomCategory(id) {
  const settings = await getSettings();
  const customCategories = settings.customCategories.filter((c) => c.id !== id);
  await saveSettings({ customCategories });
  render();
}

function slugify(label) {
  return (
    "custom-" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    Date.now().toString(36)
  );
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const label = document.getElementById("custom-label").value.trim();
  const keywordsRaw = document.getElementById("custom-keywords").value.trim();
  const intensity = document.getElementById("custom-intensity").value;
  if (!label || !keywordsRaw) return;

  const keywords = keywordsRaw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const newCategory = {
    id: slugify(label),
    label,
    aiHint: label,
    keywords,
    enabled: true,
    intensity,
    builtin: false,
  };

  const settings = await getSettings();
  await saveSettings({ customCategories: [...settings.customCategories, newCategory] });
  form.reset();
  document.getElementById("custom-intensity").value = "balanced";
  render();
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("Reset all categories to defaults? Custom categories you added will be removed.")) return;
  await saveSettings({ categories: BUILTIN_CATEGORIES, customCategories: [] });
  render();
});

// ---- AI status (same behavior as the popup) ----
const aiStatusEl = document.getElementById("ai-status");
const aiStatusText = document.getElementById("ai-status-text");
const aiEnableBtn = document.getElementById("ai-enable-btn");
const aiProgress = document.getElementById("ai-progress");

async function renderAiStatus() {
  const status = await checkAvailability();
  aiStatusEl.classList.remove("unsupported", "unavailable");

  const copy = {
    available: "Active. Topic understanding runs locally via Gemini Nano — nothing leaves this device.",
    downloadable: "Ready to set up (one-time download, stays on this device).",
    downloading: "Downloading the on-device model…",
    unavailable: "Not available on this device right now. Running in keyword-only mode.",
    unsupported: "This browser doesn't support on-device AI yet. Running in keyword-only mode.",
  };
  aiStatusText.textContent = copy[status] || copy.unsupported;

  if (status === "unavailable" || status === "unsupported") aiStatusEl.classList.add(status);
  aiEnableBtn.hidden = status !== "downloadable";
  aiProgress.hidden = status !== "downloading";
}

aiEnableBtn.addEventListener("click", async () => {
  aiEnableBtn.hidden = true;
  aiProgress.hidden = false;
  aiStatusText.textContent = "Downloading the on-device model… this can take a few minutes.";
  try {
    await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          aiProgress.value = Math.round((e.loaded || 0) * 100);
        });
      },
    });
    aiStatusText.textContent = "Active. Topic understanding runs locally via Gemini Nano — nothing leaves this device.";
    aiProgress.hidden = true;
  } catch (err) {
    aiStatusEl.classList.add("unavailable");
    aiStatusText.textContent = `Couldn't enable on-device AI: ${err.message}`;
    aiProgress.hidden = true;
  }
});

render();
renderAiStatus();
