// Built-in shield categories. Each carries the seed keywords used by the
// fast keyword stage, plus a short "aiHint" used to brief the on-device
// classifier on what the category means.
export const BUILTIN_CATEGORIES = [
  {
    id: "doomscrolling-news",
    label: "Doomscrolling news",
    aiHint: "breaking-news alarmism, war, disasters, tragedy, mass casualty events",
    keywords: [
      "breaking news", "war", "disaster", "tragedy", "killed", "dead", "death toll",
      "crisis", "catastrophe", "explosion", "attack", "shooting", "casualties",
      "emergency", "evacuate", "collapse", "wildfire", "earthquake", "flood",
      "deported", "deportation", "hurricane", "tornado", "pandemic", "mass shooting",
    ],
    // High-traffic entertainment titles that would otherwise false-positive
    // on the plain keywords above ("war" matches "Star Wars" via the s?
    // plural rule, "attack"/"shooting" match anime and photography posts).
    excludeKeywords: ["star wars", "attack on titan", "shooting star", "shooting hoops"],
    enabled: true,
    intensity: "balanced",
    builtin: true,
  },
  {
    id: "politics",
    label: "Politics & divisive content",
    aiHint: "electoral politics, partisan debate, political scandal",
    keywords: [
      "election", "senator", "senate", "congress", "republican", "democrat", "politician",
      "partisan", "president", "governor", "campaign trail", "impeach", "midterm",
      "white house", "supreme court", "gop",
    ],
    enabled: true,
    intensity: "balanced",
    builtin: true,
  },
  {
    id: "health-anxiety",
    label: "Health-anxiety spirals",
    aiHint: "symptom-checking content, medical scare stories, disease-risk alarmism",
    keywords: [
      "symptom", "diagnosis", "tumor", "cancer risk", "disease outbreak",
      "you might have", "warning signs of", "could be a sign of", "rare disease",
    ],
    // Off by default: this category's own keywords ("symptom", "diagnosis")
    // are exactly the headings on a patient portal or a medical reference
    // page someone navigated to on purpose. Shielding health information by
    // default, on a health-themed product, is the wrong default even
    // though the category itself is legitimate for someone who wants it.
    enabled: false,
    intensity: "gentle",
    builtin: true,
  },
  {
    id: "body-image",
    label: "Body image & diet culture",
    aiHint: "weight loss content, diet culture, restrictive-eating and body-comparison content",
    keywords: [
      "weight loss", "calorie deficit", "diet plan", "before and after", "thinspo",
      "body fat percentage", "six pack", "shred fat", "cheat day",
    ],
    enabled: false,
    intensity: "balanced",
    builtin: true,
  },
  {
    id: "violence",
    label: "Violence & gore",
    aiHint: "graphic violence, gore, brutal or disturbing imagery described in text",
    keywords: [
      "graphic content", "gore", "brutal attack", "mutilated", "gruesome", "stabbed",
    ],
    enabled: false,
    intensity: "strict",
    builtin: true,
  },
  {
    id: "spoilers",
    label: "Spoilers",
    aiHint: "plot spoilers for movies, TV shows, books, or sports results",
    keywords: [
      "spoiler", "series finale", "season finale", "plot twist", "ending explained",
      "dies in the finale", "final score",
    ],
    enabled: false,
    intensity: "strict",
    builtin: true,
  },
  {
    id: "substance-use",
    label: "Substance-use triggers",
    aiHint: "content about drug or alcohol use, relapse, or addiction that could trigger someone in recovery",
    keywords: [
      "relapse", "overdose", "getting high", "drug use", "addiction story", "bender",
    ],
    enabled: false,
    intensity: "balanced",
    builtin: true,
  },
];

export const INTENSITIES = ["gentle", "balanced", "strict"];

export function allCategories(customCategories) {
  return [...BUILTIN_CATEGORIES.map((c) => ({ ...c })), ...(customCategories || [])];
}
