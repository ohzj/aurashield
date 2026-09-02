// Availability check for Chrome's on-device Prompt API (Gemini Nano).
// Shared by the popup and options pages. The content script keeps its own
// inlined copy of this (see content/shield.js) since static content scripts
// can't use ES module imports.
export async function checkAvailability() {
  if (typeof LanguageModel === "undefined") return "unsupported";
  try {
    return await LanguageModel.availability();
  } catch {
    return "unsupported";
  }
}
