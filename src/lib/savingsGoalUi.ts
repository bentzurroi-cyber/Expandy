import { CATEGORY_ICON_KEYS } from "@/components/settings/IconPicker";

const ICON_SET = new Set<string>(CATEGORY_ICON_KEYS as unknown as string[]);

export const SAVINGS_GOAL_DEFAULT_COLOR = "#10b981";
export const SAVINGS_GOAL_DEFAULT_COLOR_INVESTMENT = "#0ea5e9";

export function parseHexColor6(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

export function defaultSavingsGoalColor(isInvestmentPortfolio: boolean): string {
  return isInvestmentPortfolio
    ? SAVINGS_GOAL_DEFAULT_COLOR_INVESTMENT
    : SAVINGS_GOAL_DEFAULT_COLOR;
}

export function normalizeSavingsGoalIconKey(
  raw: unknown,
  fallback: string,
): string {
  if (typeof raw === "string" && ICON_SET.has(raw)) return raw;
  return ICON_SET.has(fallback) ? fallback : "piggy-bank";
}

/** Darken a #RRGGBB color for nested progress segments (returns original if invalid). */
export function darkenHex6(hex: string, factor = 0.42): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const k = 1 - factor;
  const dr = Math.round(r * k);
  const dg = Math.round(g * k);
  const db = Math.round(b * k);
  return `#${((1 << 24) + (dr << 16) + (dg << 8) + db).toString(16).slice(1)}`;
}
