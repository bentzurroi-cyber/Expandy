import type { YearMonth } from "@/lib/month";

/**
 * Logical asset id from a DB row id.
 * Supports `base__YYYY-MM-DD` (first-of-month rows) and `base__YYYY-MM`.
 */
export function assetBaseId(rowId: string): string {
  const trimmed = rowId.trim();
  const fullDay = /^(.+)__(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (fullDay) return fullDay[1]!;
  const ym = /^(.+)__(\d{4}-\d{2})$/.exec(trimmed);
  if (ym) return ym[1]!;
  return trimmed;
}

/** Calendar month encoded as `base__YYYY-MM` on the row id, if present. */
export function ymFromAssetRowId(rowId: string): YearMonth | null {
  const u = rowId.indexOf("__");
  if (u === -1) return null;
  const suf = rowId.slice(u + 2);
  return /^\d{4}-\d{2}$/.test(suf) ? (suf as YearMonth) : null;
}
