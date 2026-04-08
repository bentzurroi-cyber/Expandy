import * as Papa from "papaparse";
import type { EntryType } from "@/data/mock";

/**
 * Canonical round-trip CSV headers (Hebrew + emoji). Export must match exactly for re-import.
 */
export const CSV_ROUNDTRIP_HEADERS = [
  "תאריך 🗓️",
  "סוג 📋",
  "סכום 💵",
  "מטבע 💱",
  "קטגוריה 📂",
  "שיטת תשלום 💳",
  "תשלומים",
  "מספר תשלום",
  "הערות 📝",
] as const;

/** @deprecated Use CSV_ROUNDTRIP_HEADERS */
export const EXPANDY_IMPORT_CSV_HEADERS = CSV_ROUNDTRIP_HEADERS;

export type RawImportedEntry = {
  date: string;
  typeLabel: string;
  amount: string;
  currency: string;
  category: string;
  paymentMethodOrAccount: string;
  note: string;
};

/** Map fuzzy Hebrew (+emoji) column titles to row fields. */
function resolveCsvColumns(keys: string[]): {
  date: string | null;
  type: string | null;
  amount: string | null;
  currency: string | null;
  category: string | null;
  payment: string | null;
  note: string | null;
} {
  const date =
    keys.find((k) => k.includes("תאריך")) ??
    keys.find((k) => k.trim().startsWith("תאריך")) ??
    null;

  const type =
    keys.find(
      (k) =>
        k.includes("סוג") &&
        !k.includes("מספר") &&
        !k.includes("תשלומים"),
    ) ?? null;

  const amount = keys.find((k) => k.includes("סכום")) ?? null;

  const currency = keys.find((k) => k.includes("מטבע")) ?? null;

  const category = keys.find((k) => k.includes("קטגוריה")) ?? null;

  let payment: string | null = null;
  for (const k of keys) {
    if (k.includes("מספר") && k.includes("תשלום")) continue;
    if (k.includes("תשלומים") && !k.includes("שיטת")) continue;
    if (
      k.includes("תשלום") &&
      !k.includes("מספר") &&
      (k.includes("שיטת") ||
        k.includes("אמצעי") ||
        k.includes("חשבון") ||
        k.includes("יעד"))
    ) {
      payment = k;
      break;
    }
  }
  if (!payment) {
    payment =
      keys.find(
        (k) =>
          k.includes("אמצעי תשלום") ||
          k.includes("חשבון/אמצעי") ||
          k.includes("אמצעי תשלום / חשבון יעד"),
      ) ?? null;
  }

  const note =
    keys.find((k) => k.includes("הערות")) ??
    keys.find((k) => k.includes("הערה")) ??
    null;

  return { date, type, amount, currency, category, payment, note };
}

export function parseDDMMYYYYToIso(date: string): string | null {
  const s = date.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return iso;
}

export function parseImportDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const isoM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoM) {
    const yyyy = Number(isoM[1]);
    const mm = Number(isoM[2]);
    const dd = Number(isoM[3]);
    if (!yyyy || !mm || !dd) return null;
    const dt = new Date(yyyy, mm - 1, dd);
    if (dt.getFullYear() !== yyyy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd)
      return null;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return parseDDMMYYYYToIso(s);
}

export function parseEntryTypeLabel(label: string): EntryType | null {
  const s = label.trim();
  if (s === "הוצאה") return "expense";
  if (s === "הכנסה") return "income";
  return null;
}

export function parseAmountToNumber(s: string): number | null {
  const raw = s.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseExpensesCsv(csvText: string): {
  rows: RawImportedEntry[];
  missingHeaders: string[];
  errors: string[];
} {
  const errors: string[] = [];

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: unknown) => String(h ?? "").trim(),
  });

  if (parsed.errors?.length) {
    errors.push(
      ...(parsed.errors as Array<{ message?: unknown }>).map(
        (e) => String(e.message ?? "Unknown CSV parse error"),
      ),
    );
  }

  const keys =
    parsed.meta?.fields && Array.isArray(parsed.meta.fields)
      ? parsed.meta.fields
      : [];

  const cols = resolveCsvColumns(keys);

  const required: { label: string; ok: boolean }[] = [
    { label: "תאריך", ok: cols.date != null },
    { label: "סוג", ok: cols.type != null },
    { label: "סכום", ok: cols.amount != null },
    { label: "מטבע", ok: cols.currency != null },
    { label: "קטגוריה", ok: cols.category != null },
    { label: "שיטת תשלום / אמצעי תשלום", ok: cols.payment != null },
  ];
  const missingHeaders = required.filter((g) => !g.ok).map((g) => g.label);

  if (missingHeaders.length) {
    return { rows: [], missingHeaders, errors };
  }

  const dateCol = cols.date!;
  const typeCol = cols.type!;
  const amountCol = cols.amount!;
  const currencyCol = cols.currency!;
  const categoryCol = cols.category!;
  const paymentCol = cols.payment!;
  const noteCol = cols.note;

  const rows: RawImportedEntry[] = [];
  for (const row of parsed.data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r[dateCol] ?? "").trim();
    const typeLabel = String(r[typeCol] ?? "").trim();
    const amount = String(r[amountCol] ?? "").trim();
    const currency = String(r[currencyCol] ?? "").trim();
    const category = String(r[categoryCol] ?? "").trim();
    const paymentMethodOrAccount = String(r[paymentCol] ?? "").trim();
    const note = noteCol ? String(r[noteCol] ?? "").trim() : "";

    rows.push({
      date,
      typeLabel,
      amount,
      currency,
      category,
      paymentMethodOrAccount,
      note,
    });
  }

  return { rows, missingHeaders: [], errors };
}

export function downloadEmptyImportCsvTemplate(filename = "expandy-import-template.csv"): void {
  const bom = "\uFEFF";
  const sampleRows = [
    [
      "2026-03-25",
      "הוצאה",
      "150",
      "₪",
      "אוכל בסיסי",
      "אשראי",
      "1",
      "TRUE",
      "קניות",
    ],
    [
      "2026-03-10",
      "הכנסה",
      "5000",
      "₪",
      "משכורת",
      "בנק",
      "1",
      "FALSE",
      "משכורת מרץ",
    ],
  ];
  const csv =
    bom +
    `${CSV_ROUNDTRIP_HEADERS.join(",")}\r\n` +
    sampleRows.map((r) => r.join(",")).join("\r\n") +
    "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
