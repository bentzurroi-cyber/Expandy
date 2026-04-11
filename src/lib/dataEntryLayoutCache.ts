import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";

/** localStorage key for optimistic Data Entry layout (order + visible count) before app_state loads. */
export const EXPANDY_CACHED_LAYOUT = "expandy-cached-data-entry-layout-v1";

export type CachedDataEntryLayout = {
  expense: string[];
  income: string[];
  categoryDisplayLimit?: number;
};

type CacheRoot = Record<string, Record<string, CachedDataEntryLayout>>;

function parseRoot(raw: unknown): CacheRoot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as CacheRoot;
}

export function readDataEntryLayoutCache(
  userId: string,
  householdId: string,
): CachedDataEntryLayout {
  const uid = userId?.trim();
  const hh = normalizeHouseholdCode(householdId);
  if (!uid || !isValidHouseholdCode(hh)) {
    return { expense: [], income: [] };
  }
  try {
    const raw = localStorage.getItem(EXPANDY_CACHED_LAYOUT);
    if (!raw) return { expense: [], income: [] };
    const root = parseRoot(JSON.parse(raw) as unknown);
    const row = root[uid]?.[hh];
    if (!row || typeof row !== "object") return { expense: [], income: [] };
    const expense = Array.isArray(row.expense)
      ? row.expense.filter((x): x is string => typeof x === "string")
      : [];
    const income = Array.isArray(row.income)
      ? row.income.filter((x): x is string => typeof x === "string")
      : [];
    const categoryDisplayLimit =
      typeof row.categoryDisplayLimit === "number" &&
      Number.isFinite(row.categoryDisplayLimit)
        ? row.categoryDisplayLimit
        : undefined;
    return { expense, income, categoryDisplayLimit };
  } catch {
    return { expense: [], income: [] };
  }
}

/**
 * Merge `patch` into the cached layout for this user + household and write the full document back.
 */
export function writeDataEntryLayoutCache(
  userId: string,
  householdId: string,
  patch: Partial<CachedDataEntryLayout>,
): void {
  const uid = userId?.trim();
  const hh = normalizeHouseholdCode(householdId);
  if (!uid || !isValidHouseholdCode(hh)) return;
  try {
    const raw = localStorage.getItem(EXPANDY_CACHED_LAYOUT);
    const root = raw ? parseRoot(JSON.parse(raw) as unknown) : {};
    if (!root[uid] || typeof root[uid] !== "object") root[uid] = {};
    const prev = root[uid][hh] ?? { expense: [], income: [] };
    const next: CachedDataEntryLayout = {
      expense: patch.expense ?? prev.expense ?? [],
      income: patch.income ?? prev.income ?? [],
      categoryDisplayLimit:
        patch.categoryDisplayLimit ?? prev.categoryDisplayLimit,
    };
    root[uid][hh] = next;
    localStorage.setItem(EXPANDY_CACHED_LAYOUT, JSON.stringify(root));
  } catch {
    /* ignore quota / private mode */
  }
}
