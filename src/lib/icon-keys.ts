const CATEGORY_KEYS = new Set([
  "shopping-cart",
  "shopping-basket",
  "receipt",
  "credit-card",
  "wallet",
  "banknote",
  "home",
  "building",
  "coffee",
  "car",
  "bus",
  "train",
  "bike",
  "plane",
  "fuel",
  "utensils",
  "zap",
  "phone",
  "wifi",
  "tv",
  "gamepad-2",
  "film",
  "music",
  "heart-pulse",
  "pill",
  "stethoscope",
  "baby",
  "paw-print",
  "shirt",
  "gift",
  "book",
  "graduation-cap",
  "clapperboard",
  "briefcase",
  "dumbbell",
  "laptop",
  "tag",
  "piggy-bank",
  "trending-up",
]);

function looksLikeEmoji(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

export function normalizeCategoryIconKey(
  iconKey: unknown,
  legacyIcon?: unknown,
): string {
  if (typeof iconKey === "string" && CATEGORY_KEYS.has(iconKey)) return iconKey;
  if (typeof legacyIcon === "string" && legacyIcon && !looksLikeEmoji(legacyIcon)) {
    if (CATEGORY_KEYS.has(legacyIcon)) return legacyIcon;
  }
  return "tag";
}

const CURRENCY_KEYS = new Set([
  "ils",
  "coins",
  "dollar-sign",
  "euro",
  "badge-cent",
  "generic",
]);

export function normalizeCurrencyIconKey(iconKey: unknown): string {
  if (typeof iconKey === "string" && CURRENCY_KEYS.has(iconKey)) return iconKey;
  return "generic";
}
