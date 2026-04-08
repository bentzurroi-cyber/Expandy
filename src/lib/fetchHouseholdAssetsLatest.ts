import { supabase } from "@/lib/supabase";
import { assetBaseId } from "@/lib/assetRowId";
import { normalizeOptionName } from "@/lib/normalize";
import type { YearMonth } from "@/lib/month";

export type ReviewAssetRow = {
  baseId: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  color?: string;
};

type RowWithDate = ReviewAssetRow & { _sortDate: string };

/**
 * Collapse rows that share the same display name + type (duplicate UUIDs / imports).
 * Keeps the row with the latest `date`, then higher balance.
 */
function dedupeByNameType(rows: RowWithDate[]): ReviewAssetRow[] {
  const byKey = new Map<string, RowWithDate>();
  for (const r of rows) {
    const k = `${normalizeOptionName(r.name)}\n${r.type.trim().toLowerCase()}`;
    const prev = byKey.get(k);
    if (
      !prev ||
      r._sortDate > prev._sortDate ||
      (r._sortDate === prev._sortDate && r.balance > prev.balance)
    ) {
      byKey.set(k, r);
    }
  }
  return [...byKey.values()]
    .map((r) => ({
      baseId: r.baseId,
      name: r.name,
      type: r.type,
      balance: r.balance,
      currency: r.currency,
      ...(r.color !== undefined ? { color: r.color } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/**
 * Latest balance per logical asset for a household (max `date` wins per base id),
 * then dedupe by normalized name + type.
 */
export async function fetchLatestHouseholdAssets(
  householdId: string,
): Promise<ReviewAssetRow[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, type, balance, date, color, currency")
    .eq("household_id", householdId);
  if (error || !Array.isArray(data)) {
    if (error) console.error("[fetchLatestHouseholdAssets]", error);
    return [];
  }
  const byBase = new Map<string, { row: Record<string, unknown>; date: string }>();
  for (const row of data as Record<string, unknown>[]) {
    const id = String(row.id ?? "");
    const date = String(row.date ?? "");
    const base = assetBaseId(id);
    const prev = byBase.get(base);
    if (!prev || date > prev.date) {
      byBase.set(base, { row, date });
    }
  }
  const withDates: RowWithDate[] = [];
  for (const { row, date } of byBase.values()) {
    withDates.push({
      baseId: assetBaseId(String(row.id ?? "")),
      name: String(row.name ?? ""),
      type: String(row.type ?? ""),
      balance: Number(row.balance) || 0,
      currency: typeof row.currency === "string" && row.currency.trim() ? row.currency : "ILS",
      color: typeof row.color === "string" && row.color.trim() ? row.color : undefined,
      _sortDate: date,
    });
  }
  return dedupeByNameType(withDates);
}

const ymSuffixRe = (ym: YearMonth) => new RegExp(`__${ym.replace(/-/g, "\\-")}$`);

/**
 * One row per logical asset for a specific calendar month (`date` in that month or id suffix `__YYYY-MM`).
 */
export async function fetchHouseholdAssetsForMonth(
  householdId: string,
  ym: YearMonth,
): Promise<ReviewAssetRow[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, type, balance, date, color, currency")
    .eq("household_id", householdId);
  if (error || !Array.isArray(data)) {
    if (error) console.error("[fetchHouseholdAssetsForMonth]", error);
    return [];
  }
  const suf = ymSuffixRe(ym);
  const byBase = new Map<string, { row: Record<string, unknown>; date: string }>();
  for (const row of data as Record<string, unknown>[]) {
    const id = String(row.id ?? "");
    const date = String(row.date ?? "");
    if (!date.startsWith(ym) && !suf.test(id)) continue;
    const base = assetBaseId(id);
    const prev = byBase.get(base);
    if (!prev || date > prev.date) {
      byBase.set(base, { row, date });
    }
  }
  const withDates: RowWithDate[] = [];
  for (const { row, date } of byBase.values()) {
    withDates.push({
      baseId: assetBaseId(String(row.id ?? "")),
      name: String(row.name ?? ""),
      type: String(row.type ?? ""),
      balance: Number(row.balance) || 0,
      currency: typeof row.currency === "string" && row.currency.trim() ? row.currency : "ILS",
      color: typeof row.color === "string" && row.color.trim() ? row.color : undefined,
      _sortDate: date,
    });
  }
  return dedupeByNameType(withDates);
}
