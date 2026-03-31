import type { Category, PaymentMethod } from "@/data/mock";
import {
  parseAmountToNumber,
  parseImportDateToIso,
} from "@/lib/importCsv";
import type { YearMonth } from "@/lib/month";
import { fuzzyMatchId, type FuzzyCandidate } from "@/lib/smartImport/fuzzy";
import {
  missingAssetColumns,
  missingIncomeColumns,
  resolveAssetColumns,
  resolveIncomeColumns,
} from "@/lib/smartImport/columns";
import type { ParsedSheet } from "@/lib/smartImport/parseFile";

export type ImportRowStatus = "ready" | "attention";

export type AssetImportRow = {
  clientId: string;
  raw: Record<string, string>;
  /** YYYY-MM-DD */
  dateIso: string;
  amount: string;
  name: string;
  typeId: string | null;
  typeLabel: string;
  currency: string;
  status: ImportRowStatus;
  issues: string[];
};

export type IncomeImportRow = {
  clientId: string;
  raw: Record<string, string>;
  dateIso: string;
  amount: string;
  currency: string;
  categoryId: string | null;
  categoryLabel: string;
  destinationId: string | null;
  destinationLabel: string;
  note: string;
  status: ImportRowStatus;
  issues: string[];
};

function newClientId(i: number): string {
  return `imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoToYearMonth(iso: string): YearMonth | null {
  if (iso.length < 7) return null;
  const ym = iso.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  return ym as YearMonth;
}

export function buildAssetImportRows(
  sheet: ParsedSheet,
  assetTypes: { id: string; name: string }[],
): { rows: AssetImportRow[]; fatal: string | null } {
  const keys = sheet.headers.length ? sheet.headers : Object.keys(sheet.rows[0] ?? {});
  const cols = resolveAssetColumns(keys);
  const missing = missingAssetColumns(cols);
  if (missing.length) {
    return {
      rows: [],
      fatal: `חסרות עמודות: ${missing.join(", ")}`,
    };
  }

  const typeCands: FuzzyCandidate[] = assetTypes.map((t) => ({
    id: t.id,
    label: t.name,
  }));

  const rows: AssetImportRow[] = [];
  let i = 0;
  for (const r of sheet.rows) {
    const dateRaw = String(r[cols.date!] ?? "").trim();
    const amountRaw = String(r[cols.amount!] ?? "").trim();
    const nameRaw = String(r[cols.name!] ?? "").trim();
    const typeRaw = String(r[cols.type!] ?? "").trim();
    const curRaw = cols.currency ? String(r[cols.currency] ?? "").trim() : "";

    const iso = parseImportDateToIso(dateRaw);
    const amt = parseAmountToNumber(amountRaw);
    const issues: string[] = [];

    let typeId: string | null = null;
    if (typeRaw) {
      const m = fuzzyMatchId(typeRaw, typeCands);
      typeId = m?.id ?? null;
      if (!typeId) issues.push("סוג לא מזוהה");
    } else {
      issues.push("חסר סוג");
    }

    if (!iso) issues.push("תאריך לא תקין");
    if (amt == null || !Number.isFinite(amt) || amt < 0) issues.push("סכום לא תקין");
    if (!nameRaw.trim()) issues.push("חסר שם");

    const finalStatus: ImportRowStatus = issues.length === 0 ? "ready" : "attention";

    rows.push({
      clientId: newClientId(i++),
      raw: r,
      dateIso: iso ?? "",
      amount: amountRaw,
      name: nameRaw,
      typeId,
      typeLabel: typeRaw,
      currency: curRaw || "ILS",
      status: finalStatus,
      issues: finalStatus === "attention" ? issues : [],
    });
  }

  return { rows, fatal: null };
}

export function buildIncomeImportRows(
  sheet: ParsedSheet,
  incomeSources: Category[],
  destinations: PaymentMethod[],
  currencyToCode: (raw: string) => string,
): { rows: IncomeImportRow[]; fatal: string | null } {
  const keys = sheet.headers.length ? sheet.headers : Object.keys(sheet.rows[0] ?? {});
  const cols = resolveIncomeColumns(keys);
  const missing = missingIncomeColumns(cols);
  if (missing.length) {
    return { rows: [], fatal: `חסרות עמודות: ${missing.join(", ")}` };
  }

  const catCands: FuzzyCandidate[] = incomeSources.map((c) => ({
    id: c.id,
    label: c.name,
  }));
  const destCands: FuzzyCandidate[] = destinations.map((p) => ({
    id: p.id,
    label: p.name,
  }));

  const rows: IncomeImportRow[] = [];
  let i = 0;
  for (const r of sheet.rows) {
    const dateRaw = String(r[cols.date!] ?? "").trim();
    const amountRaw = String(r[cols.amount!] ?? "").trim();
    const curRaw = String(r[cols.currency!] ?? "").trim();
    const catRaw = String(r[cols.category!] ?? "").trim();
    const destRaw = String(r[cols.destination!] ?? "").trim();
    const note = cols.note ? String(r[cols.note] ?? "").trim() : "";

    const iso = parseImportDateToIso(dateRaw);
    const amt = parseAmountToNumber(amountRaw);
    const issues: string[] = [];

    let categoryId: string | null = null;
    if (catRaw) {
      const m = fuzzyMatchId(catRaw, catCands);
      categoryId = m?.id ?? null;
      if (!categoryId) issues.push("קטגוריה לא מזוהה");
    } else {
      issues.push("חסרה קטגוריה");
    }

    let destinationId: string | null = null;
    if (destRaw) {
      const m = fuzzyMatchId(destRaw, destCands);
      destinationId = m?.id ?? null;
      if (!destinationId) issues.push("חשבון יעד לא מזוהה");
    } else {
      issues.push("חסר חשבון יעד");
    }

    if (!iso) issues.push("תאריך לא תקין");
    if (amt == null || !Number.isFinite(amt) || amt <= 0) issues.push("סכום לא תקין");
    if (!curRaw.trim()) issues.push("חסר מטבע");

    const currency = currencyToCode(curRaw);

    const finalStatus: ImportRowStatus =
      issues.length === 0 &&
      iso &&
      categoryId &&
      destinationId &&
      amt != null &&
      amt > 0
        ? "ready"
        : "attention";

    rows.push({
      clientId: newClientId(i++),
      raw: r,
      dateIso: iso ?? "",
      amount: amountRaw,
      currency,
      categoryId,
      categoryLabel: catRaw,
      destinationId,
      destinationLabel: destRaw,
      note,
      status: finalStatus,
      issues: finalStatus === "attention" ? issues : [],
    });
  }

  return { rows, fatal: null };
}

export function assetRowToPayload(row: AssetImportRow): {
  ym: YearMonth;
  name: string;
  type: string;
  balance: number;
  currency: string;
} | null {
  const iso = parseImportDateToIso(row.dateIso) ?? row.dateIso;
  if (!isValidIso(iso)) return null;
  const ym = isoToYearMonth(iso);
  if (!ym) return null;
  const amt = parseAmountToNumber(row.amount);
  if (amt == null || !Number.isFinite(amt) || amt < 0) return null;
  if (!row.typeId || !row.name.trim()) return null;
  return {
    ym,
    name: row.name.trim(),
    type: row.typeId,
    balance: Math.round(amt * 100) / 100,
    currency: row.currency.trim() || "ILS",
  };
}

export function incomeRowToExpenseInput(
  row: IncomeImportRow,
): Omit<
  import("@/data/mock").Expense,
  "id"
> | null {
  const iso = parseImportDateToIso(row.dateIso) ?? row.dateIso;
  if (!isValidIso(iso)) return null;
  const amt = parseAmountToNumber(row.amount);
  if (amt == null || !Number.isFinite(amt) || amt <= 0) return null;
  if (!row.categoryId || !row.destinationId) return null;
  return {
    date: iso,
    amount: Math.round(Math.abs(amt) * 100) / 100,
    currency: row.currency,
    categoryId: row.categoryId,
    paymentMethodId: row.destinationId,
    note: row.note,
    type: "income",
    installments: 1,
    installmentIndex: 1,
    recurringMonthly: false,
  };
}

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Revalidate asset row after inline edits (mutates issues/status). */
export function revalidateAssetRow(
  row: AssetImportRow,
  assetTypes: { id: string; name: string }[],
): AssetImportRow {
  const typeCands: FuzzyCandidate[] = assetTypes.map((t) => ({
    id: t.id,
    label: t.name,
  }));
  const issues: string[] = [];
  const iso = parseImportDateToIso(row.dateIso) ?? row.dateIso;
  if (!isValidIso(iso)) issues.push("תאריך לא תקין");
  const amt = parseAmountToNumber(row.amount);
  if (amt == null || !Number.isFinite(amt) || amt < 0) issues.push("סכום לא תקין");
  if (!row.name.trim()) issues.push("חסר שם");

  let typeId = row.typeId;
  if (!typeId && row.typeLabel.trim()) {
    const m = fuzzyMatchId(row.typeLabel, typeCands);
    if (m) typeId = m.id;
  }
  if (!typeId) issues.push("סוג לא תקין");

  const status: ImportRowStatus =
    issues.length === 0 ? "ready" : "attention";
  return {
    ...row,
    dateIso: iso,
    typeId,
    status,
    issues,
  };
}

export function revalidateIncomeRow(
  row: IncomeImportRow,
  incomeSources: Category[],
  destinations: PaymentMethod[],
  currencyToCode: (raw: string) => string,
): IncomeImportRow {
  const issues: string[] = [];
  const iso = parseImportDateToIso(row.dateIso) ?? row.dateIso;
  if (!isValidIso(iso)) issues.push("תאריך לא תקין");
  const amt = parseAmountToNumber(row.amount);
  if (amt == null || !Number.isFinite(amt) || amt <= 0) issues.push("סכום לא תקין");

  const catCands: FuzzyCandidate[] = incomeSources.map((c) => ({
    id: c.id,
    label: c.name,
  }));
  const destCands: FuzzyCandidate[] = destinations.map((p) => ({
    id: p.id,
    label: p.name,
  }));

  let categoryId = row.categoryId;
  if (!categoryId && row.categoryLabel.trim()) {
    const m = fuzzyMatchId(row.categoryLabel, catCands);
    if (m) categoryId = m.id;
  }
  if (!categoryId) issues.push("קטגוריה לא תקינה");

  let destinationId = row.destinationId;
  if (!destinationId && row.destinationLabel.trim()) {
    const m = fuzzyMatchId(row.destinationLabel, destCands);
    if (m) destinationId = m.id;
  }
  if (!destinationId) issues.push("חשבון יעד לא תקין");

  const currency = currencyToCode(row.currency);

  const status: ImportRowStatus =
    issues.length === 0 ? "ready" : "attention";
  return {
    ...row,
    dateIso: iso,
    currency,
    categoryId,
    destinationId,
    status,
    issues,
  };
}

