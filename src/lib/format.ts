import type { CurrencyDef } from "@/data/mock";

/** YYYY-MM-DD → DD/MM/YYYY (תצוגה אחידה) */
export function formatDateDDMMYYYY(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Shekel display: up to 2 fraction digits, no integer rounding (history, dashboard, etc.). */
export function formatIls(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `₪${formatted}`;
}

/** Headline net worth: whole shekels only, rounded up (compact layout). */
export function formatIlsWholeCeil(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const whole = Math.ceil(n);
  const formatted = whole.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  return `₪${formatted}`;
}

export function formatIlsCompact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(n);
  if (abs < 1000) return formatIls(n);
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(n);
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
  const n = Number.isFinite(amount) ? amount : 0;
  const c = currencies.find((x) => x.code === code);
  const sym = c?.symbol ?? code;
  const locale = code === "ILS" ? "he-IL" : "en-US";
  const formatted = n.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

/** Shekel in any common stored form — hide redundant “original currency” line when this is true. */
export function isShekelCurrency(
  code: string | undefined | null,
  currencies: CurrencyDef[],
): boolean {
  const raw = typeof code === "string" ? code.trim() : "";
  if (!raw) return true;
  const upper = raw.toUpperCase();
  if (upper === "ILS" || upper === "NIS") return true;
  if (raw === "₪" || raw === "שקל" || raw === 'ש"ח' || raw === "שח") return true;
  const c = currencies.find((x) => x.code === raw || x.code.toUpperCase() === upper);
  if (c) {
    if (c.code.toUpperCase() === "ILS") return true;
    if (c.symbol.trim() === "₪") return true;
    const lh = c.labelHe.trim();
    if (lh === "שקל" || lh.startsWith("שקל ")) return true;
  }
  return false;
}

/**
 * Single canonical code for Select, FX, and persistence (₪ / שקל / NIS / ILS → "ILS"; $ / USD → "USD"; etc.).
 */
export function canonicalCurrencyCode(
  raw: string | undefined | null,
  currencies: CurrencyDef[],
): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "ILS";

  if (isShekelCurrency(t, currencies)) return "ILS";

  const upper = t.toUpperCase();

  for (const c of currencies) {
    const codeTrim = c.code.trim();
    const codeU = codeTrim.toUpperCase();
    if (codeU === upper || codeTrim === t) {
      return /^[A-Za-z]{3}$/.test(codeTrim) ? codeU : codeTrim;
    }
    const sym = c.symbol.trim();
    if (sym && sym === t) {
      return /^[A-Za-z]{3}$/.test(codeTrim) ? codeU : codeTrim;
    }
    const lh = c.labelHe.trim();
    if (lh && lh === t) {
      return /^[A-Za-z]{3}$/.test(codeTrim) ? codeU : codeTrim;
    }
  }

  if (/^[A-Za-z]{3}$/.test(t)) return upper;

  return "ILS";
}
