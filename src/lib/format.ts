import type { CurrencyDef } from "@/data/mock";

/** YYYY-MM-DD → DD/MM/YYYY (תצוגה אחידה) */
export function formatDateDDMMYYYY(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function formatIls(amount: number): string {
  return `₪${Math.round(amount).toLocaleString("he-IL")}`;
}

export function formatIlsCompact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(n);
  if (abs < 1000) return formatIls(n);
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: abs < 10000 ? 1 : 0,
  }).format(Math.round(n));
  return `₪${formatted}`;
}

/** תווית יחידה לרשימת מטבעות — ללא כפילות סימול */
export function currencyOptionLabel(c: CurrencyDef): string {
  return `${c.labelHe} (${c.symbol})`;
}

export function formatCurrencyCompact(
  amount: number,
  code: string,
  currencies: CurrencyDef[],
): string {
  const c = currencies.find((x) => x.code === code);
  const sym = c?.symbol ?? code;
  const locale = code === "ILS" ? "he-IL" : "en-US";
  return `${sym}${Math.round(amount).toLocaleString(locale)}`;
}
