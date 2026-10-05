/** Explicit review scope. Historical retrieval labels, graders and pins remain immutable. */
export const CF49_REVIEW_IDS = [
  "exact-pc-plan", "para-pc-thinking", "para-pc-plan", "morph-pc-last-decision",
  "morph-pc-card-accusative", "order-pc-inverted", "multi-pc-card-and-ram",
  "tr-pc-capitals", "tr-pc-punctuation", "tr-pc-typo",
  "heldout-pc-card-want", "heldout-pc-switch",
] as const;

/** New independent negative controls, defined before the scope repair. */
export const CF49_REJECTED_DECISIONS = [
  "Laptop kullanırken bir bisiklet almaya karar verdim",
  "Bilgisayar için yeni bir ekran kartı almaya karar verdim",
  "Laptop almaya karar verdim?",
  "Laptop almaya karar verdim mi",
  "Eğer indirim olursa laptop almaya karar verdim",
  'Komşum "laptop almaya karar verdim" dedi',
  '"Laptop almaya karar verdim"',
  "Laptop almaya karar vermedim",
  "Bilgisayar hakkında konuşurken telefon almaya karar verdim",
  "Laptop almaya karar verdim; bilgisayar almaya karar verdim",
] as const;
