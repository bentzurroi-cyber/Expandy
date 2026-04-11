import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  MOCK_CATEGORIES,
  MOCK_DESTINATION_ACCOUNTS,
  MOCK_INCOME_SOURCES,
  MOCK_PAYMENT_METHODS,
  type CurrencyDef,
  type Expense,
  type PaymentMethod,
  type Category,
} from "@/data/mock";
import {
  normalizeCategoryIconKey,
  normalizeCurrencyIconKey,
} from "@/lib/icon-keys";
import { addMonthsToIsoDate } from "@/lib/month";
import type { RawImportedEntry } from "@/lib/importCsv";
import {
  parseAmountToNumber,
  parseEntryTypeLabel,
  parseImportDateToIso,
} from "@/lib/importCsv";
import { pickDistinctImportCategoryColor } from "@/lib/categoryColors";
import {
  dedupeCategoriesByName,
  dedupeExpenseRows,
  dedupePaymentMethodsByName,
} from "@/lib/dedupe";
import { normalizeOptionName } from "@/lib/normalize";
import { BUDGET_LOCAL_STORAGE_KEY, useBudgets } from "@/context/BudgetContext";
import { useAuth } from "@/context/AuthContext";
import {
  APP_STATE_KEYS,
  fetchProfileAppState,
  patchProfileAppState,
} from "@/lib/householdAppState";
import { supabase } from "@/lib/supabase";
import {
  EXPANDY_APP_DATA_STORAGE_KEYS,
  removeExpandyAppDataKeys,
} from "@/lib/expandy-storage";
import {
  readDataEntryLayoutCache,
  writeDataEntryLayoutCache,
} from "@/lib/dataEntryLayoutCache";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import {
  isStandardUuid,
  parseProjectedRecurringId,
  projectedRecurringId,
} from "@/lib/expenseIds";
import { capReceiptUrls, MAX_RECEIPT_IMAGES } from "@/lib/receiptConstants";
import { uploadReceiptImagesParallel } from "@/lib/receiptUpload";
import { toast } from "sonner";

// Default categories seeded only when a user explicitly starts a fresh household
// (leave flow with "clean slate"). Never seeded reactively.
const DEFAULT_STARTER_CATEGORIES: ReadonlyArray<{
  name: string;
  color: string;
  iconKey: string;
}> = [
  { name: "אוכל",              color: "#22c55e", iconKey: "utensils"      },
  { name: "תחבורה",            color: "#38bdf8", iconKey: "car"           },
  { name: "מגורים/חשבונות",   color: "#a78bfa", iconKey: "home"          },
  { name: "קניות",             color: "#f59e0b", iconKey: "shopping-bag"  },
  { name: "פנאי",              color: "#f43f5e", iconKey: "party-popper"  },
];

function supabaseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "";
}

type CategoryUpsertRow = {
  id: string;
  user_id: string;
  household_id: string;
  name: string;
  type: string;
  color: string;
  icon: string;
};


/** Avoid unique (household_id, type, name) violations when the batch has duplicate names. */
function dedupeCategoryUpsertRows(rows: CategoryUpsertRow[]): CategoryUpsertRow[] {
  const map = new Map<string, CategoryUpsertRow>();
  for (const r of rows) {
    const k = `${r.household_id}|${r.type}|${normalizeOptionName(r.name)}`;
    const prev = map.get(k);
    if (!prev || r.id < prev.id) map.set(k, r);
  }
  return [...map.values()];
}

async function upsertCategoriesToSupabase(
  rows: CategoryUpsertRow[],
): Promise<{ error: unknown | null }> {
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("categories").upsert(rows, {
    onConflict: "household_id,name,type",
  });
  return { error };
}

const STORAGE_KEY = "expandy-expenses-v1";

export type AddExpenseInput = Omit<Expense, "id"> & { receiptFiles?: File[] };

/** `receiptUrls: null` clears all receipts in DB and local state. Omit the key to leave unchanged. */
export type ExpenseUpdatePatch = Partial<Omit<Expense, "id" | "receiptUrls">> & {
  receiptUrls?: string[] | null;
};
const STORAGE_INCOME_SOURCES = "expandy-income-sources-v1";
const STORAGE_DEST_ACCOUNTS = "expandy-destination-accounts-v1";
const STORAGE_EXPENSE_CATEGORIES = "expandy-expense-categories-v1";
const STORAGE_EXPENSE_CATEGORY_OVERRIDES = "expandy-expense-category-overrides-v1";
const STORAGE_INCOME_CATEGORY_OVERRIDES = "expandy-income-category-overrides-v1";
const STORAGE_RECURRING_INCOME_SKIPS = "expandy-recurring-income-skips-v1";
const STORAGE_CUSTOM_CURRENCIES = "expandy-currencies-v1";
const STORAGE_PAYMENT_METHODS = "expandy-payment-methods-v1";
const STORAGE_DELETED_BUILTIN_EXPENSE_CATS = "expandy-deleted-builtin-expense-cats-v1";
const STORAGE_DELETED_BUILTIN_INCOME_CATS = "expandy-deleted-builtin-income-cats-v1";
const STORAGE_ACTIVE_AUTH_USER = "expandy-active-auth-user-v1";

type DataEntryLayoutBucket = { expense: string[]; income: string[] };

/** Parse `profiles.app_state.data_entry_category_layout_by_hh` (per-household layout). */
function parseDataEntryLayoutByHousehold(
  raw: unknown,
): Record<string, DataEntryLayoutBucket> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, DataEntryLayoutBucket> = {};
  for (const [hk, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeHouseholdCode(hk);
    if (!isValidHouseholdCode(key)) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const vo = v as Record<string, unknown>;
    const expense = Array.isArray(vo.expense)
      ? vo.expense.filter((x): x is string => typeof x === "string")
      : [];
    const income = Array.isArray(vo.income)
      ? vo.income.filter((x): x is string => typeof x === "string")
      : [];
    out[key] = { expense, income };
  }
  return out;
}

/** Keep saved order for ids that still exist; append any new ids at end (stable name sort). */
function mergeSavedCategoryOrder(saved: string[], currentIds: string[]): string[] {
  const allowed = new Set(currentIds);
  const ordered: string[] = [];
  for (const id of saved) {
    if (allowed.has(id)) ordered.push(id);
  }
  const missing = currentIds.filter((id) => !ordered.includes(id));
  missing.sort((a, b) => a.localeCompare(b, "he"));
  return [...ordered, ...missing];
}

/** Apply cached / saved id order to DB-fetched custom category rows (no DB order column). */
function sortCustomCategoryRowsByOrder<
  T extends { id: string; name: string; color: string; iconKey: string },
>(rows: T[], order: string[]): T[] {
  const ids = rows.map((r) => r.id);
  const merged = mergeSavedCategoryOrder(order, ids);
  const m = new Map(rows.map((r) => [r.id, r] as const));
  return merged.map((id) => m.get(id)).filter((x): x is T => x != null);
}

function sameIdOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

const LEGACY_STORAGE_EXPENSE_CATEGORY_ORDER = "expandy-expense-category-order-v1";
const LEGACY_STORAGE_INCOME_CATEGORY_ORDER = "expandy-income-category-order-v1";

function readLegacyCategoryOrderFromLocalStorage(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function readDeletedBuiltinIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function deletedBuiltinListFromCloud(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function mergeDeletedBuiltinIdLists(cloud: unknown, local: Set<string>): string[] {
  const fromCloud = deletedBuiltinListFromCloud(cloud);
  return [...new Set([...fromCloud, ...local])];
}

function deletedBuiltinListsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const bs = new Set(b);
  return a.some((id) => !bs.has(id));
}

function isValidExpenseShape(row: unknown): row is Expense {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  if (
    typeof r.isVerified !== "undefined" &&
    typeof r.isVerified !== "boolean"
  ) {
    return false;
  }
  if (
    typeof r.isReviewed !== "undefined" &&
    typeof r.isReviewed !== "boolean"
  ) {
    return false;
  }
  if (typeof r.receiptUrls !== "undefined") {
    if (!Array.isArray(r.receiptUrls)) return false;
    if (!r.receiptUrls.every((x) => typeof x === "string")) return false;
  }
  if (
    typeof (r as { receiptUrl?: unknown }).receiptUrl !== "undefined" &&
    typeof (r as { receiptUrl?: unknown }).receiptUrl !== "string"
  ) {
    return false;
  }
  return (
    typeof r.id === "string" &&
    typeof r.date === "string" &&
    typeof r.amount === "number" &&
    Number.isFinite(r.amount) &&
    typeof r.currency === "string" &&
    typeof r.categoryId === "string" &&
    typeof r.paymentMethodId === "string" &&
    typeof r.note === "string" &&
    (r.type === "expense" || r.type === "income")
  );
}

function readStoredExpenses(): Expense[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Expense[] = [];
    for (const row of parsed) {
      if (!isValidExpenseShape(row)) continue;
      const r = row as Record<string, unknown>;
      out.push({
        id: r.id as string,
        date: r.date as string,
        amount: r.amount as number,
        currency: r.currency as string,
        categoryId: r.categoryId as string,
        paymentMethodId: r.paymentMethodId as string,
        note: r.note as string,
        type: r.type as Expense["type"],
        installments:
          typeof r.installments === "number" && r.installments > 0
            ? Math.floor(r.installments)
            : 1,
        installmentIndex:
          typeof r.installmentIndex === "number" && r.installmentIndex > 0
            ? Math.floor(r.installmentIndex)
            : 1,
        recurringMonthly: r.recurringMonthly === true,
        ...(r.isVerified === true ? { isVerified: true } : {}),
        ...(r.isReviewed === true ? { isReviewed: true } : {}),
        ...(Array.isArray(r.receiptUrls) && r.receiptUrls.length
          ? { receiptUrls: capReceiptUrls(r.receiptUrls as string[]) }
          : typeof (r as { receiptUrl?: unknown }).receiptUrl === "string" &&
              (r as { receiptUrl: string }).receiptUrl.trim()
            ? { receiptUrls: capReceiptUrls([(r as { receiptUrl: string }).receiptUrl.trim()]) }
            : {}),
      });
    }
    return dedupeExpenseRows(out);
  } catch {
    return [];
  }
}

function readCustomOptions<T extends { id: string; name: string; color: string }>(
  key: string,
): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is T =>
        Boolean(x) &&
        typeof x === "object" &&
        typeof (x as { id?: unknown }).id === "string" &&
        typeof (x as { name?: unknown }).name === "string" &&
        typeof (x as { color?: unknown }).color === "string",
    );
  } catch {
    return [];
  }
}

function readCustomCategories(): Category[] {
  const raw = readCustomOptions<
    Category & { icon?: unknown; iconKey?: unknown }
  >(STORAGE_EXPENSE_CATEGORIES);
  const mapped = raw.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    iconKey: normalizeCategoryIconKey(
      (c as { iconKey?: unknown }).iconKey,
      (c as { icon?: unknown }).icon,
    ),
  }));
  return dedupeCategoriesByName(mapped);
}

type CategoryOverride = Partial<Pick<Category, "name" | "iconKey" | "color">>;
type IncomeCategoryOverride = Partial<Pick<Category, "name" | "iconKey" | "color">>;

function readCategoryOverrides(): Record<string, CategoryOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_EXPENSE_CATEGORY_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, CategoryOverride> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== "string" || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      out[k] = {
        name: typeof r.name === "string" ? r.name : undefined,
        iconKey: normalizeCategoryIconKey(r.iconKey, (r as { icon?: unknown }).icon),
        color: typeof r.color === "string" ? r.color : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function readIncomeCategoryOverrides(): Record<string, IncomeCategoryOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_INCOME_CATEGORY_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, IncomeCategoryOverride>;
  } catch {
    return {};
  }
}

function parseCurrencyRow(row: unknown): CurrencyDef | null {
  if (!row || typeof row !== "object") return null;
  const x = row as Record<string, unknown>;
  if (typeof x.code !== "string" || typeof x.labelHe !== "string") return null;
  const symbol =
    typeof x.symbol === "string" && x.symbol.length > 0 ? x.symbol : "¤";
  const iconKey = normalizeCurrencyIconKey(x.iconKey ?? x.icon);
  return { code: x.code, labelHe: x.labelHe, symbol, iconKey };
}

function dedupeCurrenciesByCode(arr: CurrencyDef[]): CurrencyDef[] {
  const byCode = new Map<string, CurrencyDef>();
  for (const c of arr) {
    if (!byCode.has(c.code)) byCode.set(c.code, c);
  }
  return [...byCode.values()];
}

function normalizeManagedCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

function readCustomCurrencies(): CurrencyDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_CURRENCIES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CurrencyDef[] = [];
    for (const row of parsed) {
      const c = parseCurrencyRow(row);
      if (c) out.push(c);
    }
    return dedupeCurrenciesByCode(out);
  } catch {
    return [];
  }
}

function readRecurringSkips(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_RECURRING_INCOME_SKIPS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const months = v.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}$/.test(x));
      if (months.length) out[k] = months;
    }
    return out;
  } catch {
    return {};
  }
}

function isYearMonth(s: string): s is `${number}-${number}` {
  return /^\d{4}-\d{2}$/.test(s);
}

function clampDay(year: number, month1to12: number, day: number): number {
  const last = new Date(year, month1to12, 0).getDate();
  return Math.max(1, Math.min(last, day));
}

function toDbCategoryId(value: string | undefined): string | null {
  return typeof value === "string" && isStandardUuid(value) ? value : null;
}

/** Row shape for `public.categories` (unique per household: household_id + name + type). */
function categoryToSupabaseRow(
  c: Pick<Category, "id" | "name" | "color" | "iconKey">,
  userId: string,
  type: "expense" | "income",
  householdId: string,
) {
  return {
    id: c.id,
    user_id: userId,
    household_id: householdId,
    name: c.name,
    type,
    color: c.color,
    icon: c.iconKey,
  };
}

async function deleteCategoryFromSupabase(
  householdId: string,
  categoryId: string,
): Promise<{ error: unknown | null }> {
  if (!isValidHouseholdCode(householdId) || !isStandardUuid(categoryId)) {
    return { error: null };
  }
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", categoryId)
    .eq("household_id", householdId);
  return { error };
}

function normalizeCategoryDisplayLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function buildSupabaseExpenseUpdateBody(patch: ExpenseUpdatePatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.amount !== undefined) body.amount = patch.amount;
  if (patch.categoryId !== undefined) {
    body.category = patch.categoryId;
    body.category_id = toDbCategoryId(patch.categoryId);
  }
  if (patch.date !== undefined) body.date = patch.date;
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.currency !== undefined) body.currency = patch.currency;
  if (patch.isVerified !== undefined) body.is_verified = patch.isVerified === true;
  if (patch.isReviewed !== undefined) body.is_reviewed = patch.isReviewed === true;
  if (patch.recurringMonthly !== undefined) {
    body.is_recurring = patch.recurringMonthly === true;
  }
  if (patch.type !== undefined) body.entry_type = patch.type;
  if (patch.paymentMethodId !== undefined) {
    body.payment_method_id = patch.paymentMethodId;
  }
  const ii: Record<string, unknown> = {};
  if (patch.installmentIndex !== undefined) {
    ii.installmentIndex = patch.installmentIndex;
  }
  if (patch.installments !== undefined) ii.installments = patch.installments;
  if (patch.paymentMethodId !== undefined) {
    ii.paymentMethodId = patch.paymentMethodId;
  }
  if (patch.type !== undefined) ii.type = patch.type;
  if (Object.keys(ii).length > 0) body.installments_info = ii;
  if (patch.receiptUrls !== undefined) {
    if (patch.receiptUrls === null || patch.receiptUrls.length === 0) {
      body.receipt_urls = null;
    } else {
      body.receipt_urls = capReceiptUrls(patch.receiptUrls);
    }
  }
  return body;
}

type SupabaseExpenseRow = {
  id: string;
  user_id: string;
  household_id: string;
  amount: number;
  category?: string | null;
  category_id?: string | null;
  date: string;
  note: string;
  currency: string;
  is_verified: boolean;
  is_reviewed?: boolean;
  /** Canonical type on row; preferred over JSON when present. */
  entry_type?: string | null;
  payment_method_id?: string | null;
  installments_info: {
    installmentIndex?: number;
    installments?: number;
    paymentMethodId?: string;
    type?: Expense["type"];
  } | null;
  is_recurring: boolean;
  receipt_urls?: string[] | null;
};

type PaymentMethodOverride = CategoryOverride;

function receiptUrlsFromDbRow(row: SupabaseExpenseRow): string[] | undefined {
  const fromArr = Array.isArray(row.receipt_urls)
    ? row.receipt_urls.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const capped = capReceiptUrls(fromArr);
  return capped.length ? capped : undefined;
}

function mapDbExpenseToApp(row: SupabaseExpenseRow): Expense {
  const colType = row.entry_type === "income" ? "income" : row.entry_type === "expense" ? "expense" : undefined;
  const jsonType = row.installments_info?.type;
  const type: Expense["type"] =
    colType === "income" || (colType === undefined && jsonType === "income")
      ? "income"
      : "expense";
  const paymentMethodId =
    typeof row.payment_method_id === "string" && row.payment_method_id.length > 0
      ? row.payment_method_id
      : row.installments_info?.paymentMethodId ?? "";
  const receiptUrls = receiptUrlsFromDbRow(row);
  return {
    id: row.id,
    date: row.date,
    amount: Number(row.amount) || 0,
    currency: row.currency,
    categoryId: row.category_id ?? row.category ?? "",
    paymentMethodId,
    note: row.note ?? "",
    type,
    installments: Math.max(1, Math.floor(row.installments_info?.installments ?? 1)),
    installmentIndex: Math.max(1, Math.floor(row.installments_info?.installmentIndex ?? 1)),
    recurringMonthly: row.is_recurring === true,
    ...(row.is_verified ? { isVerified: true } : {}),
    ...(row.is_reviewed ? { isReviewed: true } : {}),
    ...(receiptUrls?.length ? { receiptUrls } : {}),
  };
}

export type RemoveExpenseOptions = {
  /** `single`: one projected month (skip) or plain row delete. `series`: remove template + all instances. `demote`: recurring template → one-off. */
  mode?: "single" | "series" | "demote";
  /** When `id` is the UUID template row with `recurringMonthly`. */
  isRecurringTemplate?: boolean;
};

type ExpensesContextValue = {
  expenses: Expense[];
  sortExpenses: (
    rows: Expense[],
    sortBy: "newest" | "oldest" | "amountDesc" | "amountAsc",
  ) => Expense[];
  /** Expenses for a specific month, including projected recurring incomes. */
  expensesForMonth: (ym: `${number}-${number}`) => Expense[];
  /** Ensure recurring templates are instantiated into state for a month. */
  materializeRecurringForMonth: (ym: `${number}-${number}`) => void;
  addExpense: (
    input: AddExpenseInput,
  ) => Promise<{ ok: true; ids: string[] } | { ok: false; error: string }>;
  /** CSV import (Hebrew headers) with strict dedupe */
  importData: (
    rows: RawImportedEntry[],
  ) => { imported: number; skipped: number; newCategories: number; newMethods: number };
  /** Bulk insert income rows (validated); persists to Supabase when connected. */
  bulkImportIncomes: (
    rows: Omit<Expense, "id">[],
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  /** Bulk insert expense rows (validated); persists to Supabase when connected. */
  bulkImportExpenses: (
    rows: Omit<Expense, "id">[],
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  updateExpense: (id: string, patch: ExpenseUpdatePatch) => void;
  /**
   * Awaits Supabase update before updating local state. Use when persistence must be confirmed
   * (e.g. receipt upload + DB row in one flow).
   */
  updateExpenseAsync: (
    id: string,
    patch: ExpenseUpdatePatch,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Wait until session + household are ready for Storage / Supabase writes. */
  waitForCloudContext: () => Promise<{ userId: string; householdId: string } | null>;
  removeExpense: (
    id: string,
    options?: RemoveExpenseOptions,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  expenseCategories: Category[];
  incomeSources: Category[];
  /** Update income category (custom or builtin override). */
  updateIncomeSource: (
    id: string,
    patch: { name?: string; iconKey?: string; color?: string },
  ) => void;
  /** Delete a custom income category. Built-ins can't be deleted. */
  deleteIncomeSource: (id: string, moveToIncomeSourceId?: string) => void;
  paymentMethods: PaymentMethod[];
  destinationAccounts: PaymentMethod[];
  currencies: CurrencyDef[];
  addManagedCurrency: (code: string) => string | null;
  removeManagedCurrency: (code: string) => void;
  addExpenseCategory: (
    name: string,
    iconKey?: string,
    color?: string,
  ) => string | null;
  addIncomeSource: (
    name: string,
    iconKey?: string,
    color?: string,
  ) => string | null;
  addPaymentMethod: (name: string, iconKey?: string, color?: string) => string | null;
  addDestinationAccount: (name: string, iconKey?: string, color?: string) => string | null;
  updatePaymentMethod: (
    id: string,
    patch: { name?: string; iconKey?: string; color?: string },
  ) => void;
  deletePaymentMethod: (id: string, moveToPaymentMethodId?: string) => void;
  updateDestinationAccount: (
    id: string,
    patch: { name?: string; iconKey?: string; color?: string },
  ) => void;
  deleteDestinationAccount: (id: string, moveToDestinationAccountId?: string) => void;
  addCustomCurrency: (labelHe: string) => string | null;
  /** Update expense category (custom or builtin override). */
  updateExpenseCategory: (
    id: string,
    patch: { name?: string; iconKey?: string; color?: string },
  ) => void;
  /** Delete expense category and optionally move rows first. */
  deleteExpenseCategory: (id: string, moveToCategoryId?: string) => void;
  reorderExpenseCategories: (orderedIds: string[]) => void;
  reorderIncomeSources: (orderedIds: string[]) => void;
  quickAccessCount: number;
  setQuickAccessCount: (count: number) => void;
  /**
   * Skipped YYYY-MM per recurring template id (income and expense).
   * Used when removing a single projected month without deleting the series.
   */
  recurringIncomeSkips: Record<string, string[]>;
  /** Skip one projected recurring income payment for a month. */
  skipRecurringIncomePayment: (templateId: string, ym: `${number}-${number}`) => void;
  /** Stop recurring on a template income. */
  stopRecurringIncome: (templateId: string) => void;
  /** Clear all user data in this context (expenses + custom lists). Caller should also remove app keys from localStorage. */
  clearAllUserData: () => Promise<void>;
  /** Local-only state reset (no DB deletes). */
  resetLocalState: () => void;
  /**
   * Imperatively begin a household transition: sets the sync lock, wipes ALL
   * local React state, and aggressively clears localStorage + IndexedDB.
   * Call this BEFORE any Supabase writes that change household_id so the
   * reactive sync effect cannot push stale data into the new household.
   * The lock is released automatically by the household-change useEffect once
   * the fresh Supabase fetch completes (triggered by refreshProfile()).
   */
  beginHouseholdTransition: () => void;
  /**
   * Imperatively seed the 5 default ("Starter Pack") categories for a specific
   * userId/householdId. Generates fresh UUIDs every call — no hardcoded IDs.
   * Returns { ok, error }. Call this only during the explicit "Leave → Fresh
   * slate" flow, never reactively.
   */
  seedStarterPack: (
    userId: string,
    householdId: string,
  ) => Promise<{ ok: boolean; error?: unknown }>;
};

const ExpensesContext = createContext<ExpensesContextValue | null>(null);

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    const h = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function showSupabaseInsertError(error: unknown) {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Database write failed";
  toast.error(msg);
}

export function ExpensesProvider({ children }: { children: ReactNode }) {
  const {
    mergeBudgetOnExpenseCategoryDeleted,
    clearAllUserData: clearAllBudgetData,
  } = useBudgets();
  const { user, profile, session, loading: authLoading } = useAuth();
  const householdId = normalizeHouseholdCode(profile?.household_id ?? "");
  const latestCategoryListsRef = useRef({
    expenseCategories: [] as Category[],
    incomeSources: [] as Category[],
  });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseCategoryOverrides, setExpenseCategoryOverrides] = useState<
    Record<string, CategoryOverride>
  >(() => readCategoryOverrides());
  const [incomeCategoryOverrides, setIncomeCategoryOverrides] = useState<
    Record<string, IncomeCategoryOverride>
  >(() => readIncomeCategoryOverrides());
  const [recurringIncomeSkips, setRecurringIncomeSkips] = useState<
    Record<string, string[]>
  >(() => readRecurringSkips());
  const [customIncomeSources, setCustomIncomeSources] = useState<Category[]>(
    () => {
      const raw = readCustomOptions<
        Category & { icon?: unknown; iconKey?: unknown }
      >(STORAGE_INCOME_SOURCES);
      const mapped = raw.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        iconKey: normalizeCategoryIconKey(
          (c as { iconKey?: unknown }).iconKey,
          (c as { icon?: unknown }).icon,
        ),
      }));
      return dedupeCategoriesByName(mapped);
    },
  );
  const [customDestinationAccounts, setCustomDestinationAccounts] = useState<
    PaymentMethod[]
  >(() => {
    const raw = readCustomOptions<PaymentMethod & { icon?: unknown; iconKey?: unknown }>(
      STORAGE_DEST_ACCOUNTS,
    );
    const mapped = raw.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      iconKey: normalizeCategoryIconKey((m as { iconKey?: unknown }).iconKey, (m as { icon?: unknown }).icon),
    }));
    return dedupePaymentMethodsByName(mapped);
  });
  const [customPaymentMethods, setCustomPaymentMethods] = useState<PaymentMethod[]>(
    () => {
      const raw = readCustomOptions<PaymentMethod & { icon?: unknown; iconKey?: unknown }>(
        STORAGE_PAYMENT_METHODS,
      );
      const mapped = raw.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        iconKey: normalizeCategoryIconKey((m as { iconKey?: unknown }).iconKey, (m as { icon?: unknown }).icon),
      }));
      return dedupePaymentMethodsByName(mapped);
    },
  );
  const [customExpenseCategories, setCustomExpenseCategories] = useState<
    Category[]
  >(() => readCustomCategories());
  const [customCurrencies, setCustomCurrencies] = useState<CurrencyDef[]>(() =>
    readCustomCurrencies(),
  );
  const [deletedBuiltinExpenseCategoryIds, setDeletedBuiltinExpenseCategoryIds] =
    useState<Set<string>>(() => readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_EXPENSE_CATS));
  const [deletedBuiltinIncomeSourceIds, setDeletedBuiltinIncomeSourceIds] =
    useState<Set<string>>(() => readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_INCOME_CATS));
  const [prefsCloudReady, setPrefsCloudReady] = useState(false);
  const deletedBuiltinCloudTimerRef = useRef<number | null>(null);
  const [paymentMethodOverrides, setPaymentMethodOverrides] = useState<
    Record<string, PaymentMethodOverride>
  >({});
  const [destinationAccountOverrides, setDestinationAccountOverrides] = useState<
    Record<string, PaymentMethodOverride>
  >({});
  const [deletedBuiltinPaymentMethodIds, setDeletedBuiltinPaymentMethodIds] = useState<
    Set<string>
  >(new Set());
  const [deletedBuiltinDestinationAccountIds, setDeletedBuiltinDestinationAccountIds] =
    useState<Set<string>>(new Set());
  const [expenseCategoryOrder, setExpenseCategoryOrder] = useState<string[]>([]);
  const [incomeCategoryOrder, setIncomeCategoryOrder] = useState<string[]>([]);
  const expenseCategoryOrderRef = useRef<string[]>([]);
  const incomeCategoryOrderRef = useRef<string[]>([]);
  expenseCategoryOrderRef.current = expenseCategoryOrder;
  incomeCategoryOrderRef.current = incomeCategoryOrder;
  const [quickAccessCount, setQuickAccessCountState] = useState<number>(() => {
    const fromProfile = profile?.category_display_limit;
    if (typeof fromProfile === "number" && Number.isFinite(fromProfile)) {
      return normalizeCategoryDisplayLimit(fromProfile);
    }
    const uid = user?.id?.trim();
    const hh = normalizeHouseholdCode(profile?.household_id ?? "");
    if (uid && isValidHouseholdCode(hh)) {
      const cached = readDataEntryLayoutCache(uid, hh);
      if (cached.categoryDisplayLimit != null) {
        return normalizeCategoryDisplayLimit(cached.categoryDisplayLimit);
      }
    }
    return 8;
  });
  const quickAccessCountRef = useRef(quickAccessCount);
  quickAccessCountRef.current = quickAccessCount;
  const starterPackSeedGuardRef = useRef<string>("");
  const previousHouseholdIdRef = useRef<string>("");
  const isHouseholdTransitioningRef = useRef(false);
  const isDeletingRef = useRef(false);
  // Blocks the category-sync effect for one render cycle after a Supabase fetch
  // resolves. Set to true before the setState calls inside fetchCategoriesFromSupabase,
  // cleared by a setTimeout(0) so it lives exactly until React has committed the
  // fetch result — preventing fetched rows from being pushed straight back up.
  const isCategoryFetchFlushingRef = useRef(false);
  const [householdReloadToken, setHouseholdReloadToken] = useState(0);

  // Apply last-known layout from localStorage before paint to avoid FOUC (DB / app_state lag).
  useLayoutEffect(() => {
    if (!user?.id || !isValidHouseholdCode(householdId)) return;
    const c = readDataEntryLayoutCache(user.id, householdId);
    setExpenseCategoryOrder(c.expense);
    setIncomeCategoryOrder(c.income);
    const profLim = profile?.category_display_limit;
    const hasProfileLimit =
      typeof profLim === "number" && Number.isFinite(profLim);
    if (!hasProfileLimit && c.categoryDisplayLimit != null) {
      setQuickAccessCountState(normalizeCategoryDisplayLimit(c.categoryDisplayLimit));
    }
  }, [user?.id, householdId, profile?.category_display_limit]);

  const waitForCloudContext = useCallback(async () => {
    // On wake-up, auth/profile can lag briefly; wait before writing.
    for (let i = 0; i < 16; i++) {
      const householdCode = normalizeHouseholdCode(profile?.household_id ?? "");
      if (
        session &&
        user?.id &&
        !authLoading &&
        isValidHouseholdCode(householdCode)
      ) {
        return {
          userId: user.id,
          householdId: householdCode,
        };
      }
      await sleep(250);
    }
    return null;
  }, [authLoading, profile?.household_id, session, user?.id]);

  const fetchExpensesFromSupabase = useCallback(async () => {
    if (authLoading || !session || !user?.id) return;
    if (!isValidHouseholdCode(householdId)) return;
    try {
      const { data, error } = await supabase
        .from("expenses")
        .select(
          "id, user_id, household_id, amount, category, category_id, date, note, currency, is_verified, is_reviewed, installments_info, is_recurring, entry_type, payment_method_id, receipt_urls",
        )
        .eq("household_id", householdId)
        .order("date", { ascending: false });
      if (error || !data) return;
      const mapped = (data as SupabaseExpenseRow[])
        .map(mapDbExpenseToApp)
        .filter(isValidExpenseShape);
      setExpenses(dedupeExpenseRows(mapped));
    } catch {
      /* ignore load failures; user can retry by navigating */
    }
  }, [authLoading, householdId, session, user?.id]);

  const fetchCategoriesFromSupabase = useCallback(async () => {
    if (authLoading || !session || !user?.id) return;
    const hm = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!isValidHouseholdCode(hm)) {
      setCustomExpenseCategories([]);
      setCustomIncomeSources([]);
      return;
    }
    const q = supabase.from("categories").select("id,name,color,icon,type").eq("household_id", hm);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return;
    const expenseRows = data
      .filter((r) => String((r as { type?: unknown }).type ?? "") === "expense")
      .map((r) => ({
        id: String((r as { id?: unknown }).id ?? ""),
        name: String((r as { name?: unknown }).name ?? ""),
        color: String((r as { color?: unknown }).color ?? "#737373"),
        iconKey: normalizeCategoryIconKey((r as { icon?: unknown }).icon, "tag"),
      }))
      .filter((r) => r.id && r.name);
    const incomeRows = data
      .filter((r) => String((r as { type?: unknown }).type ?? "") === "income")
      .map((r) => ({
        id: String((r as { id?: unknown }).id ?? ""),
        name: String((r as { name?: unknown }).name ?? ""),
        color: String((r as { color?: unknown }).color ?? "#737373"),
        iconKey: normalizeCategoryIconKey((r as { icon?: unknown }).icon, "tag"),
      }))
      .filter((r) => r.id && r.name);
    const expenseCustom = expenseRows.filter((r) => !MOCK_CATEGORIES.some((b) => b.id === r.id));
    const incomeCustom = incomeRows.filter((r) => !MOCK_INCOME_SOURCES.some((b) => b.id === r.id));
    const cachedLayout =
      user?.id && isValidHouseholdCode(hm) ? readDataEntryLayoutCache(user.id, hm) : null;
    const sortedExpenseCustom = cachedLayout
      ? sortCustomCategoryRowsByOrder(expenseCustom, cachedLayout.expense)
      : expenseCustom;
    const sortedIncomeCustom = cachedLayout
      ? sortCustomCategoryRowsByOrder(incomeCustom, cachedLayout.income)
      : incomeCustom;
    const baseExpenseIds = MOCK_CATEGORIES.filter(
      (c) => !deletedBuiltinExpenseCategoryIds.has(c.id),
    ).map((c) => c.id);
    const baseIncomeIds = MOCK_INCOME_SOURCES.filter(
      (c) => !deletedBuiltinIncomeSourceIds.has(c.id),
    ).map((c) => c.id);
    const fullExpenseIds = [...baseExpenseIds, ...sortedExpenseCustom.map((r) => r.id)];
    const fullIncomeIds = [...baseIncomeIds, ...sortedIncomeCustom.map((r) => r.id)];
    const orderE = mergeSavedCategoryOrder(cachedLayout?.expense ?? [], fullExpenseIds);
    const orderI = mergeSavedCategoryOrder(cachedLayout?.income ?? [], fullIncomeIds);
    // Lock the sync effect for exactly one render cycle so that the freshly-fetched
    // rows cannot be pushed straight back to Supabase with the wrong user_id.
    // setTimeout(0) fires after React commits the re-render triggered by the two
    // setState calls below, guaranteeing the sync effect is skipped for that render.
    isCategoryFetchFlushingRef.current = true;
    setExpenseCategoryOrder(orderE);
    setIncomeCategoryOrder(orderI);
    setCustomExpenseCategories(
      dedupeCategoriesByName(
        sortedExpenseCustom.map(({ id, name, color, iconKey }) => ({ id, name, color, iconKey })),
      ),
    );
    setCustomIncomeSources(
      dedupeCategoriesByName(
        sortedIncomeCustom.map(({ id, name, color, iconKey }) => ({ id, name, color, iconKey })),
      ),
    );
    setTimeout(() => {
      isCategoryFetchFlushingRef.current = false;
    }, 0);
  }, [
    authLoading,
    deletedBuiltinExpenseCategoryIds,
    deletedBuiltinIncomeSourceIds,
    profile?.household_id,
    session,
    user?.id,
  ]);

  useEffect(() => {
    void fetchExpensesFromSupabase();
  }, [fetchExpensesFromSupabase, householdReloadToken]);

  useEffect(() => {
    void fetchCategoriesFromSupabase();
  }, [fetchCategoriesFromSupabase, householdReloadToken]);

  useEffect(() => {
    if (authLoading || !session || !user?.id) return;
    const nextHouseholdId = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!isValidHouseholdCode(nextHouseholdId)) return;
    const prev = previousHouseholdIdRef.current;
    if (!prev) {
      previousHouseholdIdRef.current = nextHouseholdId;
      // First mount: localStorage may hold stale categories from a previous session
      // or a different household. Lock the sync effect immediately (this effect runs
      // before the sync effect in definition order) so the stale data cannot be
      // pushed to Supabase. Wipe in-memory state, then release the lock only after
      // a fresh Supabase fetch has resolved.
      isHouseholdTransitioningRef.current = true;
      isCategoryFetchFlushingRef.current = true;
      setExpenses([]);
      setCustomExpenseCategories([]);
      setCustomIncomeSources([]);
      latestCategoryListsRef.current = { expenseCategories: [], incomeSources: [] };
      try {
        removeExpandyAppDataKeys();
      } catch { /* ignore */ }
      // The fetch effects at lines 888-894 have already started their own copies of
      // these fetches. We run a second pair here purely to get a Promise we can track
      // so we know exactly when it is safe to release the lock.
      void Promise.all([fetchCategoriesFromSupabase(), fetchExpensesFromSupabase()]).finally(() => {
        isHouseholdTransitioningRef.current = false;
        // isCategoryFetchFlushingRef is released by the setTimeout(0) inside
        // fetchCategoriesFromSupabase — no need to clear it here.
      });
      return;
    }
    if (prev === nextHouseholdId) return;

    isHouseholdTransitioningRef.current = true;
    setExpenses([]);
    setCustomIncomeSources([]);
    setCustomDestinationAccounts([]);
    setCustomPaymentMethods([]);
    setCustomExpenseCategories([]);
    setCustomCurrencies([]);
    setExpenseCategoryOverrides({});
    setIncomeCategoryOverrides({});
    setPaymentMethodOverrides({});
    setDestinationAccountOverrides({});
    setRecurringIncomeSkips({});
    setDeletedBuiltinExpenseCategoryIds(new Set());
    setDeletedBuiltinIncomeSourceIds(new Set());
    setDeletedBuiltinPaymentMethodIds(new Set());
    setDeletedBuiltinDestinationAccountIds(new Set());
    if (user?.id) {
      const cached = readDataEntryLayoutCache(user.id, nextHouseholdId);
      setExpenseCategoryOrder(cached.expense);
      setIncomeCategoryOrder(cached.income);
      if (cached.categoryDisplayLimit != null) {
        setQuickAccessCountState(
          normalizeCategoryDisplayLimit(cached.categoryDisplayLimit),
        );
      }
    } else {
      setExpenseCategoryOrder([]);
      setIncomeCategoryOrder([]);
    }
    latestCategoryListsRef.current = {
      expenseCategories: [],
      incomeSources: [],
    };

    starterPackSeedGuardRef.current = "";
    previousHouseholdIdRef.current = nextHouseholdId;
    try {
      removeExpandyAppDataKeys();
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_INCOME_CATS);
    } catch {
      /* ignore */
    }

    // Safety purge for client-side databases if any are used by plugins.
    try {
      const idbWithList = indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
      if (typeof idbWithList.databases === "function") {
        void idbWithList.databases().then((dbs) => {
          for (const db of dbs) {
            const n = db?.name ?? "";
            if (n.toLowerCase().includes("expandy")) indexedDB.deleteDatabase(n);
          }
        });
      }
    } catch {
      /* ignore */
    }

    void Promise.all([fetchCategoriesFromSupabase(), fetchExpensesFromSupabase()]).finally(() => {
      isHouseholdTransitioningRef.current = false;
      setHouseholdReloadToken((x) => x + 1);
    });
  }, [
    authLoading,
    fetchCategoriesFromSupabase,
    fetchExpensesFromSupabase,
    profile?.household_id,
    session,
    user?.id,
  ]);

  useEffect(() => {
    if (authLoading) return;
    const activeUserId = user?.id ?? "";
    try {
      const prevUserId = localStorage.getItem(STORAGE_ACTIVE_AUTH_USER) ?? "";
      if (!activeUserId) {
        if (prevUserId) localStorage.removeItem(STORAGE_ACTIVE_AUTH_USER);
        return;
      }

      // Different auth user on same browser: clear local app cache to prevent
      // stale IDs (including category IDs) leaking across accounts.
      if (prevUserId && prevUserId !== activeUserId) {
        removeExpandyAppDataKeys();
        localStorage.removeItem(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
        localStorage.removeItem(STORAGE_DELETED_BUILTIN_INCOME_CATS);
        setExpenses([]);
        setCustomIncomeSources([]);
        setCustomDestinationAccounts([]);
        setCustomPaymentMethods([]);
        setCustomExpenseCategories([]);
        setCustomCurrencies([]);
        setExpenseCategoryOverrides({});
        setIncomeCategoryOverrides({});
        setPaymentMethodOverrides({});
        setDestinationAccountOverrides({});
        setRecurringIncomeSkips({});
        setDeletedBuiltinExpenseCategoryIds(new Set());
        setDeletedBuiltinIncomeSourceIds(new Set());
        setDeletedBuiltinPaymentMethodIds(new Set());
        setDeletedBuiltinDestinationAccountIds(new Set());
        setExpenseCategoryOrder([]);
        setIncomeCategoryOrder([]);
        latestCategoryListsRef.current = {
          expenseCategories: [],
          incomeSources: [],
        };
      }

      localStorage.setItem(STORAGE_ACTIVE_AUTH_USER, activeUserId);
    } catch {
      // Ignore localStorage failures; cloud state still loads.
    }
  }, [authLoading, user?.id]);

  useEffect(() => {
    setPrefsCloudReady(false);
    if (authLoading || !user?.id || !isValidHouseholdCode(householdId)) return;
    let cancelled = false;
    void (async () => {
      const app = await fetchProfileAppState(user.id);
      if (cancelled) return;
      const exp = app[APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds];
      const inc = app[APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds];

      // Cloud may hold `[]` before first sync or due to older bugs — never drop local deletions;
      // merge with localStorage so removed default categories stay hidden.
      const locExp = readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
      const cloudExp = deletedBuiltinListFromCloud(exp);
      const mergedExp = mergeDeletedBuiltinIdLists(exp, locExp);
      setDeletedBuiltinExpenseCategoryIds(new Set(mergedExp));

      const locInc = readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_INCOME_CATS);
      const cloudInc = deletedBuiltinListFromCloud(inc);
      const mergedInc = mergeDeletedBuiltinIdLists(inc, locInc);
      setDeletedBuiltinIncomeSourceIds(new Set(mergedInc));

      const repair: Record<string, unknown> = {};
      if (deletedBuiltinListsDiffer(mergedExp, cloudExp)) {
        repair[APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds] = mergedExp;
      }
      if (deletedBuiltinListsDiffer(mergedInc, cloudInc)) {
        repair[APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds] = mergedInc;
      }
      if (Object.keys(repair).length > 0) {
        await patchProfileAppState(user.id, repair);
      }

      if (!cancelled) setPrefsCloudReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, householdId, user?.id]);

  useEffect(() => {
    return () => {
      if (deletedBuiltinCloudTimerRef.current != null) {
        window.clearTimeout(deletedBuiltinCloudTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!prefsCloudReady || !user?.id || !isValidHouseholdCode(householdId)) return;
    if (deletedBuiltinCloudTimerRef.current != null) {
      window.clearTimeout(deletedBuiltinCloudTimerRef.current);
    }
    deletedBuiltinCloudTimerRef.current = window.setTimeout(() => {
      deletedBuiltinCloudTimerRef.current = null;
      void patchProfileAppState(user.id, {
        [APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds]: [
          ...deletedBuiltinExpenseCategoryIds,
        ],
        [APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds]: [...deletedBuiltinIncomeSourceIds],
      });
    }, 450);
  }, [
    prefsCloudReady,
    householdId,
    user?.id,
    deletedBuiltinExpenseCategoryIds,
    deletedBuiltinIncomeSourceIds,
  ]);

  useEffect(() => {
    async function migrateLocalDataOnce() {
      if (!isValidHouseholdCode(householdId) || !user?.id) return;
      const migrationKey = `expandy-migrated-${householdId}`;
      if (localStorage.getItem(migrationKey) === "1") return;
      const hasLocalData = EXPANDY_APP_DATA_STORAGE_KEYS.some((key) => {
        try {
          return Boolean(localStorage.getItem(key));
        } catch {
          return false;
        }
      });
      if (!hasLocalData) {
        localStorage.setItem(migrationKey, "1");
        return;
      }

      const { count: existingExpenses = 0 } = await supabase
        .from("expenses")
        .select("id", { head: true, count: "exact" })
        .eq("household_id", householdId);

      if (existingExpenses === 0) {
        const localExpenses = readStoredExpenses().filter((row) => isStandardUuid(row.id));
        if (localExpenses.length) {
          await supabase.from("expenses").upsert(
            localExpenses.map((row) => ({
              id: row.id,
              user_id: user.id,
              household_id: householdId,
              amount: row.amount,
              category: row.categoryId,
              category_id: toDbCategoryId(row.categoryId),
              date: row.date,
              note: row.note,
              currency: row.currency,
              is_verified: row.isVerified === true,
              is_reviewed: row.isReviewed === true,
              installments_info: {
                installmentIndex: row.installmentIndex,
                installments: row.installments,
                paymentMethodId: row.paymentMethodId,
                type: row.type,
              },
              entry_type: row.type,
              payment_method_id: row.paymentMethodId,
              is_recurring: row.recurringMonthly === true,
              ...(row.receiptUrls?.length
                ? { receipt_urls: capReceiptUrls(row.receiptUrls) }
                : {}),
            })),
          );
        }
      }

      const rawAssets = localStorage.getItem("expandy-assets-v1");
      if (rawAssets) {
        try {
          const parsed = JSON.parse(rawAssets) as Array<{
            ym: string;
            accounts: Array<{
              id: string;
              name: string;
              type: string;
              balance: number;
              color?: string;
              currency?: string;
            }>;
          }>;
          const rows = Array.isArray(parsed)
            ? parsed.flatMap((s) =>
                Array.isArray(s.accounts)
                  ? s.accounts.map((a) => ({
                      id: `${a.id}__${s.ym}`,
                      user_id: user.id,
                      household_id: householdId,
                      name: a.name,
                      type: a.type,
                      balance: Number(a.balance) || 0,
                      date: `${s.ym}-01`,
                      color: a.color,
                      currency: a.currency ?? "ILS",
                    }))
                  : [],
              )
            : [];
          if (rows.length) await supabase.from("assets").upsert(rows);
        } catch {
          /* ignore malformed local assets */
        }
      }

      try {
        const existingApp = await fetchProfileAppState(user.id);
        const patch: Record<string, unknown> = {};

        let localBudgets: Record<string, unknown> = {};
        try {
          const br = localStorage.getItem(BUDGET_LOCAL_STORAGE_KEY);
          if (br) {
            const p = JSON.parse(br) as unknown;
            if (p && typeof p === "object" && !Array.isArray(p)) {
              localBudgets = { ...localBudgets, ...(p as Record<string, unknown>) };
            }
          }
          const scopedKey = `${BUDGET_LOCAL_STORAGE_KEY}__${householdId}`;
          const sr = localStorage.getItem(scopedKey);
          if (sr) {
            const p = JSON.parse(sr) as unknown;
            if (p && typeof p === "object" && !Array.isArray(p)) {
              localBudgets = { ...localBudgets, ...(p as Record<string, unknown>) };
            }
          }
        } catch {
          /* ignore */
        }
        const exB = existingApp[APP_STATE_KEYS.budgetsByMonth];
        const cloudBudgets =
          exB != null && typeof exB === "object" && !Array.isArray(exB)
            ? { ...(exB as Record<string, unknown>) }
            : {};
        const mergedBudgets = { ...cloudBudgets, ...localBudgets };
        if (Object.keys(mergedBudgets).length > 0) {
          patch[APP_STATE_KEYS.budgetsByMonth] = mergedBudgets;
        }

        const locDelExp = readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
        const exDelExp = existingApp[APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds];
        const cloudDelExp = Array.isArray(exDelExp)
          ? exDelExp.filter((x): x is string => typeof x === "string")
          : [];
        const mergedDelExp = [...new Set([...cloudDelExp, ...locDelExp])];
        if (mergedDelExp.length > 0) {
          patch[APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds] = mergedDelExp;
        }

        const locDelInc = readDeletedBuiltinIds(STORAGE_DELETED_BUILTIN_INCOME_CATS);
        const exDelInc = existingApp[APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds];
        const cloudDelInc = Array.isArray(exDelInc)
          ? exDelInc.filter((x): x is string => typeof x === "string")
          : [];
        const mergedDelInc = [...new Set([...cloudDelInc, ...locDelInc])];
        if (mergedDelInc.length > 0) {
          patch[APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds] = mergedDelInc;
        }

        if (Object.keys(patch).length > 0) {
          await patchProfileAppState(user.id, patch);
        }
      } catch {
        /* still clear local keys */
      }

      removeExpandyAppDataKeys();
      localStorage.setItem(migrationKey, "1");
    }
    void migrateLocalDataOnce();
  }, [householdId, user?.id]);

  const expenseCategoriesForStorage = useMemo(
    () => dedupeCategoriesByName(customExpenseCategories),
    [customExpenseCategories],
  );
  const incomeSourcesForStorage = useMemo(
    () => dedupeCategoriesByName(customIncomeSources),
    [customIncomeSources],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EXPENSE_CATEGORIES, JSON.stringify(customExpenseCategories));
    } catch {
      /* ignore */
    }
  }, [customExpenseCategories]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_INCOME_SOURCES, JSON.stringify(customIncomeSources));
    } catch {
      /* ignore */
    }
  }, [customIncomeSources]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PAYMENT_METHODS, JSON.stringify(customPaymentMethods));
    } catch {
      /* ignore */
    }
  }, [customPaymentMethods]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DEST_ACCOUNTS, JSON.stringify(customDestinationAccounts));
    } catch {
      /* ignore */
    }
  }, [customDestinationAccounts]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_DELETED_BUILTIN_EXPENSE_CATS,
        JSON.stringify([...deletedBuiltinExpenseCategoryIds]),
      );
    } catch {
      /* ignore */
    }
  }, [deletedBuiltinExpenseCategoryIds]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_DELETED_BUILTIN_INCOME_CATS,
        JSON.stringify([...deletedBuiltinIncomeSourceIds]),
      );
    } catch {
      /* ignore */
    }
  }, [deletedBuiltinIncomeSourceIds]);

  useEffect(() => {
    if (authLoading || !profile) return;
    const normalized = normalizeCategoryDisplayLimit(profile.category_display_limit);
    setQuickAccessCountState((prev) => (prev === normalized ? prev : normalized));
    if (user?.id && isValidHouseholdCode(householdId)) {
      writeDataEntryLayoutCache(user.id, householdId, {
        categoryDisplayLimit: normalized,
      });
    }
  }, [authLoading, householdId, profile?.category_display_limit, profile?.id, user?.id]);


  // Reactive Starter Pack seeding has been intentionally removed.
  // Seeding categories reactively when categories.length === 0 is unsafe: it fires
  // during household transitions, on every new login, and when the host deliberately
  // has zero categories. Seeding must only happen explicitly during new-user onboarding
  // (auth flow), never as a side-effect inside the context.
  useEffect(() => {
    if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) return;
    // Guard 1: household transition in progress — never push during a household switch.
    if (isHouseholdTransitioningRef.current) return;
    // Guard 2: fetchCategoriesFromSupabase just resolved and set state — skip this render
    // so we don't push fetched host categories back up with the wrong user_id.
    if (isCategoryFetchFlushingRef.current) return;
    // Guard 3: manual category deletion in progress — avoid re-upserting stale rows
    // during the deletion window and the immediate next render after local state updates.
    if (isDeletingRef.current) return;
    const rawRows: CategoryUpsertRow[] = [
      ...expenseCategoriesForStorage
        .filter((c) => isStandardUuid(c.id))
        .map((c) => categoryToSupabaseRow(c, user.id, "expense", householdId)),
      ...incomeSourcesForStorage
        .filter((c) => isStandardUuid(c.id))
        .map((c) => categoryToSupabaseRow(c, user.id, "income", householdId)),
    ];
    const rows = dedupeCategoryUpsertRows(rawRows);
    if (!rows.length) return;
    void (async () => {
      const { error } = await upsertCategoriesToSupabase(rows);
      if (error) {
        console.error("[ExpensesContext] categories upsert failed", error);
        const msg = supabaseErrorMessage(error);
        toast.error(msg || "שמירת קטגוריות לענן נכשלה", {
          id: "categories-cloud-sync",
          duration: 8000,
        });
      }
    })();
  }, [
    authLoading,
    session,
    user?.id,
    householdId,
    expenseCategoriesForStorage,
    incomeSourcesForStorage,
  ]);

  const addExpense = useCallback(async (rawInput: AddExpenseInput) => {
    const cloud = await waitForCloudContext();
    if (!cloud) {
      return { ok: false as const, error: "אין חיבור לחשבון. נסה שוב בעוד רגע." };
    }

    const { receiptFiles, ...input } = rawInput;

    const catUuid = toDbCategoryId(input.categoryId);
    if (catUuid) {
      const { expenseCategories: expCats, incomeSources: incCats } =
        latestCategoryListsRef.current;
      const cat =
        input.type === "income"
          ? incCats.find((c) => c.id === input.categoryId)
          : expCats.find((c) => c.id === input.categoryId);
      if (cat) {
        const row = categoryToSupabaseRow(
          cat,
          cloud.userId,
          input.type === "income" ? "income" : "expense",
          cloud.householdId,
        );
        const { error: catErr } = await upsertCategoriesToSupabase([row]);
        if (catErr) {
          showSupabaseInsertError(catErr);
          return {
            ok: false as const,
            error: `שמירת קטגוריה לענן נכשלה: ${supabaseErrorMessage(catErr)}`,
          };
        }
      }
    }
    const receiptFileList = (receiptFiles ?? [])
      .filter((f): f is File => f instanceof File)
      .slice(0, MAX_RECEIPT_IMAGES);

    let rows: Expense[] = [];
    if (input.type === "expense" && input.recurringMonthly) {
      rows = [
        {
          ...input,
          id: newId(),
          amount: Math.round(input.amount * 100) / 100,
          installments: 1,
          installmentIndex: 1,
          recurringMonthly: true,
        },
      ];
    } else if (input.type === "expense" && input.installments > 1) {
      const count = Math.max(1, Math.floor(input.installments));
      const unit = Math.round((input.amount / count) * 100) / 100;
      for (let i = 0; i < count; i++) {
        const baseNote = input.note.trim();
        const installNote = `(תשלום ${i + 1} מתוך ${count})`;
        rows.push({
          ...input,
          id: newId(),
          amount: unit,
          date: addMonthsToIsoDate(input.date, i),
          note: baseNote ? `${baseNote} ${installNote}` : installNote,
          installments: count,
          installmentIndex: i + 1,
        });
      }
    } else {
      rows = [{ ...input, id: newId() }];
    }

    for (const row of rows) {
      if (!isStandardUuid(row.id)) {
        return {
          ok: false as const,
          error: "שמירה נכשלה: מזהה תנועה לא תקין. נסה שוב.",
        };
      }
    }

    if (receiptFileList.length && rows[0]) {
      const up = await uploadReceiptImagesParallel({
        householdId: cloud.householdId,
        userId: cloud.userId,
        expenseId: rows[0]!.id,
        files: receiptFileList,
      });
      if ("error" in up) {
        return {
          ok: false as const,
          error: `העלאת הקבלה נכשלה: ${up.error}`,
        };
      }
      const urls = capReceiptUrls(up.urls);
      if (!urls.length) {
        return {
          ok: false as const,
          error: "העלאת הקבלה נכשלה: לא התקבלו קישורים לתמונות.",
        };
      }
      rows = rows.map((r) => ({ ...r, receiptUrls: urls }));
    }

    const payload = rows.map((row) => ({
      id: row.id,
      user_id: cloud.userId,
      household_id: cloud.householdId,
      amount: row.amount,
      category: row.categoryId,
      category_id: toDbCategoryId(row.categoryId),
      date: row.date,
      note: row.note,
      currency: row.currency,
      is_verified: row.isVerified === true,
      is_reviewed: row.isReviewed === true,
      entry_type: row.type,
      payment_method_id: row.paymentMethodId,
      installments_info: {
        installmentIndex: row.installmentIndex,
        installments: row.installments,
        paymentMethodId: row.paymentMethodId,
        type: row.type,
      },
      is_recurring: row.recurringMonthly === true,
      receipt_urls:
        row.receiptUrls?.length ? capReceiptUrls(row.receiptUrls) : null,
    }));
    const optimisticIds = new Set(rows.map((r) => r.id));
    setExpenses((prev) => [...prev, ...rows]);
    try {
      const { error } = await supabase.from("expenses").upsert(payload);
      if (error) {
        showSupabaseInsertError(error);
        setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
        return { ok: false as const, error: `שמירה לענן נכשלה: ${error.message}` };
      }
    } catch (error) {
      showSupabaseInsertError(error);
      setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "שמירה לענן נכשלה",
      };
    }
    return { ok: true as const, ids: rows.map((r) => r.id) };
  }, [waitForCloudContext]);

  const materializeRecurringForMonth = useCallback(
    (ym: `${number}-${number}`) => {
      setExpenses((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const next = [...prev];

        const templates = prev.filter((e) => e.recurringMonthly === true);
        for (const t of templates) {
          const baseYm = t.date.slice(0, 7);
          if (!isYearMonth(baseYm)) continue;
          if (baseYm > ym) continue;

          const skips = new Set(recurringIncomeSkips[t.id] ?? []);
          if (skips.has(ym)) continue;
          if (ym === baseYm) continue;

          const id = projectedRecurringId(t.id, ym);
          if (existingIds.has(id)) continue;

          const [yStr, mStr] = ym.split("-");
          const day = Number(t.date.slice(8, 10)) || 1;
          const y = Number(yStr);
          const m = Number(mStr);
          const d = clampDay(y, m, day);
          const date = `${ym}-${String(d).padStart(2, "0")}`;

          next.push({
            ...t,
            id,
            date,
            // Instances should be editable without affecting template.
            recurringMonthly: false,
            installments: 1,
            installmentIndex: 1,
            isVerified: undefined,
          });
          existingIds.add(id);
        }

        return next;
      });
    },
    [recurringIncomeSkips],
  );

  const allExpenseCategoryIds = useMemo(() => {
    const base = MOCK_CATEGORIES.filter(
      (c) => !deletedBuiltinExpenseCategoryIds.has(c.id),
    ).map((c) => c.id);
    const custom = customExpenseCategories.map((c) => c.id);
    return [...base, ...custom];
  }, [customExpenseCategories, deletedBuiltinExpenseCategoryIds]);

  const allIncomeCategoryIds = useMemo(() => {
    const base = MOCK_INCOME_SOURCES.filter(
      (c) => !deletedBuiltinIncomeSourceIds.has(c.id),
    ).map((c) => c.id);
    const custom = customIncomeSources.map((c) => c.id);
    return [...base, ...custom];
  }, [customIncomeSources, deletedBuiltinIncomeSourceIds]);

  const expenseCategoryIdsKey = useMemo(
    () => allExpenseCategoryIds.join("\u0001"),
    [allExpenseCategoryIds],
  );
  const incomeCategoryIdsKey = useMemo(
    () => allIncomeCategoryIds.join("\u0001"),
    [allIncomeCategoryIds],
  );

  /** Data Entry (הזנה) layout: personal order per user, stored in `profiles.app_state` (by household). */
  const persistDataEntryCategoryLayout = useCallback(
    async (expenseOrd: string[], incomeOrd: string[]) => {
      const uid = user?.id?.trim();
      if (!uid || !isValidHouseholdCode(householdId)) return;
      const app = await fetchProfileAppState(uid);
      const key = APP_STATE_KEYS.dataEntryCategoryLayoutByHousehold;
      const byHh = parseDataEntryLayoutByHousehold(app[key]);
      byHh[householdId] = { expense: expenseOrd, income: incomeOrd };
      const res = await patchProfileAppState(uid, { [key]: byHh });
      if (!res.ok) {
        console.error("[ExpensesContext] data entry layout persist failed", res.error);
        return;
      }
      writeDataEntryLayoutCache(uid, householdId, {
        expense: expenseOrd,
        income: incomeOrd,
        categoryDisplayLimit: quickAccessCountRef.current,
      });
    },
    [user?.id, householdId],
  );

  useEffect(() => {
    if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) return;
    if (isHouseholdTransitioningRef.current) return;
    let cancelled = false;
    void (async () => {
      const app = await fetchProfileAppState(user.id);
      if (cancelled) return;
      const byHh = parseDataEntryLayoutByHousehold(
        app[APP_STATE_KEYS.dataEntryCategoryLayoutByHousehold],
      );
      let saved = byHh[householdId] ?? { expense: [], income: [] };
      let migratedLegacyLayout = false;
      if (!saved.expense.length && !saved.income.length) {
        const legE = readLegacyCategoryOrderFromLocalStorage(LEGACY_STORAGE_EXPENSE_CATEGORY_ORDER);
        const legI = readLegacyCategoryOrderFromLocalStorage(LEGACY_STORAGE_INCOME_CATEGORY_ORDER);
        if (legE.length || legI.length) {
          saved = { expense: legE, income: legI };
          migratedLegacyLayout = true;
        }
      }
      const nextE = mergeSavedCategoryOrder(saved.expense, allExpenseCategoryIds);
      const nextI = mergeSavedCategoryOrder(saved.income, allIncomeCategoryIds);
      setExpenseCategoryOrder((prev) => (sameIdOrder(prev, nextE) ? prev : nextE));
      setIncomeCategoryOrder((prev) => (sameIdOrder(prev, nextI) ? prev : nextI));
      if (cancelled) return;
      writeDataEntryLayoutCache(user.id, householdId, {
        expense: nextE,
        income: nextI,
        categoryDisplayLimit: quickAccessCountRef.current,
      });
      if (migratedLegacyLayout && !cancelled) {
        void persistDataEntryCategoryLayout(nextE, nextI);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    session,
    user?.id,
    householdId,
    expenseCategoryIdsKey,
    incomeCategoryIdsKey,
    allExpenseCategoryIds,
    allIncomeCategoryIds,
    persistDataEntryCategoryLayout,
  ]);

  const expenseCategories = useMemo(() => {
    const apply = (c: Category): Category => {
      const o = expenseCategoryOverrides[c.id];
      if (!o) return c;
      const name = typeof o.name === "string" ? o.name : c.name;
      const iconKey = normalizeCategoryIconKey(o.iconKey ?? c.iconKey);
      const color = typeof o.color === "string" ? o.color : c.color;
      return { ...c, name, iconKey, color };
    };
    const base = MOCK_CATEGORIES.filter(
      (c) => !deletedBuiltinExpenseCategoryIds.has(c.id),
    ).map(apply);
    const custom = customExpenseCategories.map(apply);
    const all = [...base, ...custom];
    if (!expenseCategoryOrder.length) return all;
    const pos = new Map(expenseCategoryOrder.map((id, i) => [id, i] as const));
    return [...all].sort((a, b) => {
      const ai = pos.get(a.id);
      const bi = pos.get(b.id);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return a.name.localeCompare(b.name, "he");
    });
  }, [
    customExpenseCategories,
    expenseCategoryOverrides,
    deletedBuiltinExpenseCategoryIds,
    expenseCategoryOrder,
  ]);
  const incomeSources = useMemo(() => {
    const apply = (c: Category): Category => {
      const o = incomeCategoryOverrides[c.id];
      if (!o) return c;
      const name = typeof o.name === "string" ? o.name : c.name;
      const iconKey = normalizeCategoryIconKey(o.iconKey ?? c.iconKey);
      const color = typeof o.color === "string" ? o.color : c.color;
      return { ...c, name, iconKey, color };
    };
    const base = MOCK_INCOME_SOURCES.filter(
      (c) => !deletedBuiltinIncomeSourceIds.has(c.id),
    ).map(apply);
    const custom = customIncomeSources.map(apply);
    const all = [...base, ...custom];
    if (!incomeCategoryOrder.length) return all;
    const pos = new Map(incomeCategoryOrder.map((id, i) => [id, i] as const));
    return [...all].sort((a, b) => {
      const ai = pos.get(a.id);
      const bi = pos.get(b.id);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return a.name.localeCompare(b.name, "he");
    });
  }, [
    customIncomeSources,
    incomeCategoryOverrides,
    deletedBuiltinIncomeSourceIds,
    incomeCategoryOrder,
  ]);
  latestCategoryListsRef.current = { expenseCategories, incomeSources };

  const destinationAccounts = useMemo(() => {
    const apply = (m: PaymentMethod): PaymentMethod => {
      const o = destinationAccountOverrides[m.id];
      if (!o) return m;
      return {
        ...m,
        name: typeof o.name === "string" ? o.name : m.name,
        iconKey: normalizeCategoryIconKey(o.iconKey ?? m.iconKey),
        color: typeof o.color === "string" ? o.color : m.color,
      };
    };
    const base = MOCK_DESTINATION_ACCOUNTS.filter(
      (m) => !deletedBuiltinDestinationAccountIds.has(m.id),
    ).map(apply);
    const custom = customDestinationAccounts.map(apply);
    return [...base, ...custom];
  }, [
    customDestinationAccounts,
    destinationAccountOverrides,
    deletedBuiltinDestinationAccountIds,
  ]);
  const paymentMethods = useMemo(() => {
    const apply = (m: PaymentMethod): PaymentMethod => {
      const o = paymentMethodOverrides[m.id];
      if (!o) return m;
      return {
        ...m,
        name: typeof o.name === "string" ? o.name : m.name,
        iconKey: normalizeCategoryIconKey(o.iconKey ?? m.iconKey),
        color: typeof o.color === "string" ? o.color : m.color,
      };
    };
    const base = MOCK_PAYMENT_METHODS.filter(
      (m) => !deletedBuiltinPaymentMethodIds.has(m.id),
    ).map(apply);
    const custom = customPaymentMethods.map(apply);
    return [...base, ...custom];
  }, [customPaymentMethods, paymentMethodOverrides, deletedBuiltinPaymentMethodIds]);
  const currencies = useMemo(
    () => [...CURRENCIES, ...customCurrencies],
    [customCurrencies],
  );
  const builtinCurrencyCodes = useMemo(
    () => new Set(CURRENCIES.map((c) => c.code)),
    [],
  );

  const currencyToCode = useCallback((input: string): string => {
    const s = input.trim();
    if (!s) return DEFAULT_CURRENCY;
    const exactCode = currencies.find((c) => c.code === s);
    if (exactCode) return exactCode.code;
    const exactLabel = currencies.find((c) => c.labelHe === s);
    if (exactLabel) return exactLabel.code;
    const exactSymbol = currencies.find((c) => c.symbol === s);
    if (exactSymbol) return exactSymbol.code;
    const byContains = currencies.find((c) => s.includes(c.code));
    if (byContains) return byContains.code;
    return DEFAULT_CURRENCY;
  }, [currencies]);

  const importData = useCallback(
    (rows: RawImportedEntry[]) => {
      let skipped = 0;
      let imported = 0;

      const trimmedRows = rows.map((r) => ({
        ...r,
        date: r.date.trim(),
        typeLabel: r.typeLabel.trim(),
        amount: r.amount.trim(),
        currency: r.currency.trim(),
        category: r.category.trim(),
        paymentMethodOrAccount: r.paymentMethodOrAccount.trim(),
        note: r.note.trim(),
      }));

      const norm = normalizeOptionName;

      // Normalized key -> id (reuse existing when names match ignoring case/whitespace)
      const expenseCatByNorm = new Map(
        expenseCategories.map((c) => [norm(c.name), c.id] as const),
      );
      const incomeCatByNorm = new Map(
        incomeSources.map((c) => [norm(c.name), c.id] as const),
      );
      const incomeAccByNorm = new Map(
        destinationAccounts.map((p) => [norm(p.name), p.id] as const),
      );
      const expensePmByNorm = new Map(
        paymentMethods.map((p) => [norm(p.name), p.id] as const),
      );

      const neededExpenseCats = new Set<string>();
      const neededIncomeCats = new Set<string>();
      const neededExpensePms = new Set<string>();
      const neededIncomeAccs = new Set<string>();

      const firstExpenseCatDisplay = new Map<string, string>();
      const firstIncomeCatDisplay = new Map<string, string>();
      const firstExpensePmDisplay = new Map<string, string>();
      const firstIncomeAccDisplay = new Map<string, string>();

      for (const r of trimmedRows) {
        const t = parseEntryTypeLabel(r.typeLabel);
        if (!t) continue;
        if (t === "income") {
          if (r.category) {
            const k = norm(r.category);
            neededIncomeCats.add(k);
            if (!firstIncomeCatDisplay.has(k)) firstIncomeCatDisplay.set(k, r.category);
          }
          if (r.paymentMethodOrAccount) {
            const k = norm(r.paymentMethodOrAccount);
            neededIncomeAccs.add(k);
            if (!firstIncomeAccDisplay.has(k)) firstIncomeAccDisplay.set(k, r.paymentMethodOrAccount);
          }
        } else {
          if (r.category) {
            const k = norm(r.category);
            neededExpenseCats.add(k);
            if (!firstExpenseCatDisplay.has(k)) firstExpenseCatDisplay.set(k, r.category);
          }
          if (r.paymentMethodOrAccount) {
            const k = norm(r.paymentMethodOrAccount);
            neededExpensePms.add(k);
            if (!firstExpensePmDisplay.has(k)) firstExpensePmDisplay.set(k, r.paymentMethodOrAccount);
          }
        }
      }

      const pmColorPool = ["#60a5fa", "#c084fc", "#2dd4bf", "#f59e0b", "#94a3b8"];

      let newCategories = 0;
      let newMethods = 0;

      if (neededExpenseCats.size) {
        const toAdd: Category[] = [];
        const usedColors = [...MOCK_CATEGORIES, ...customExpenseCategories].map((c) => c.color);
        for (const nk of neededExpenseCats) {
          if (expenseCatByNorm.has(nk)) continue;
          const displayName =
            firstExpenseCatDisplay.get(nk) ?? nk;
          const id = newId();
          const pickedColor = pickDistinctImportCategoryColor(usedColors);
          const option: Category = {
            id,
            name: displayName,
            color: pickedColor,
            iconKey: "tag",
          };
          usedColors.push(pickedColor);
          expenseCatByNorm.set(nk, id);
          toAdd.push(option);
        }
        if (toAdd.length) {
          newCategories += toAdd.length;
          setCustomExpenseCategories((prev) => [...prev, ...toAdd]);
          setExpenseCategoryOrder((prev) => {
            const next = [...prev];
            for (const c of toAdd) {
              if (!next.includes(c.id)) next.push(c.id);
            }
            return next;
          });
        }
      }

      if (neededIncomeCats.size) {
        const toAdd: Category[] = [];
        const usedColors = [...MOCK_INCOME_SOURCES, ...customIncomeSources].map((c) => c.color);
        for (const nk of neededIncomeCats) {
          if (incomeCatByNorm.has(nk)) continue;
          const displayName =
            firstIncomeCatDisplay.get(nk) ?? nk;
          const id = newId();
          const pickedColor = pickDistinctImportCategoryColor(usedColors);
          const option: Category = {
            id,
            name: displayName,
            color: pickedColor,
            iconKey: "tag",
          };
          usedColors.push(pickedColor);
          incomeCatByNorm.set(nk, id);
          toAdd.push(option);
        }
        if (toAdd.length) {
          newCategories += toAdd.length;
          setCustomIncomeSources((prev) => [...prev, ...toAdd]);
          setIncomeCategoryOrder((prev) => {
            const next = [...prev];
            for (const c of toAdd) {
              if (!next.includes(c.id)) next.push(c.id);
            }
            return next;
          });
        }
      }

      if (neededIncomeAccs.size) {
        const toAdd: PaymentMethod[] = [];
        for (const nk of neededIncomeAccs) {
          if (incomeAccByNorm.has(nk)) continue;
          const displayName =
            firstIncomeAccDisplay.get(nk) ?? nk;
          const id = `acc-custom-${newId()}`;
          const option: PaymentMethod = {
            id,
            name: displayName,
            color: pmColorPool[Math.floor(Math.random() * pmColorPool.length)],
            iconKey: "wallet",
          };
          incomeAccByNorm.set(nk, id);
          toAdd.push(option);
        }
        if (toAdd.length) {
          newMethods += toAdd.length;
          setCustomDestinationAccounts((prev) => [...prev, ...toAdd]);
        }
      }

      if (neededExpensePms.size) {
        const toAdd: PaymentMethod[] = [];
        for (const nk of neededExpensePms) {
          if (expensePmByNorm.has(nk)) continue;
          const displayName =
            firstExpensePmDisplay.get(nk) ?? nk;
          const id = `pm-custom-${newId()}`;
          const option: PaymentMethod = {
            id,
            name: displayName,
            color: pmColorPool[Math.floor(Math.random() * pmColorPool.length)],
            iconKey: "credit-card",
          };
          expensePmByNorm.set(nk, id);
          toAdd.push(option);
        }
        if (toAdd.length) {
          newMethods += toAdd.length;
          setCustomPaymentMethods((prev) => [...prev, ...toAdd]);
        }
      }

      const out: Expense[] = [];
      for (const r of trimmedRows) {
        const iso = parseImportDateToIso(r.date);
        const type = parseEntryTypeLabel(r.typeLabel);
        const amt = parseAmountToNumber(r.amount);

        if (!iso || !type || amt == null || !Number.isFinite(amt) || amt <= 0) {
          skipped++;
          continue;
        }

        const currency = currencyToCode(r.currency);
        const categoryId =
          type === "income"
            ? (r.category ? incomeCatByNorm.get(norm(r.category)) : undefined)
            : (r.category ? expenseCatByNorm.get(norm(r.category)) : undefined);
        const paymentMethodId =
          type === "income"
            ? (r.paymentMethodOrAccount
                ? incomeAccByNorm.get(norm(r.paymentMethodOrAccount))
                : undefined)
            : (r.paymentMethodOrAccount
                ? expensePmByNorm.get(norm(r.paymentMethodOrAccount))
                : undefined);

        const fallbackCategoryId =
          type === "income" ? incomeSources[0]?.id : expenseCategories[0]?.id;
        const fallbackPaymentId =
          type === "income" ? destinationAccounts[0]?.id : paymentMethods[0]?.id;

        if (!categoryId && !fallbackCategoryId) {
          skipped++;
          continue;
        }
        if (!paymentMethodId && !fallbackPaymentId) {
          skipped++;
          continue;
        }

        out.push({
          id: newId(),
          date: iso,
          type,
          amount: Math.round(Math.abs(amt) * 100) / 100,
          currency,
          categoryId: categoryId ?? fallbackCategoryId!,
          paymentMethodId: paymentMethodId ?? fallbackPaymentId!,
          note: r.note,
          installments: 1,
          installmentIndex: 1,
          recurringMonthly: false,
          isVerified: false,
        });
      }

      if (out.length) {
        imported = out.length;
        setExpenses((prev) => [...prev, ...out]);
      }

      return { imported, skipped, newCategories, newMethods };
    },
    [
      expenseCategories,
      incomeSources,
      destinationAccounts,
      paymentMethods,
      currencyToCode,
    ],
  );

  const bulkImportIncomes = useCallback(
    async (rows: Omit<Expense, "id">[]) => {
      try {
        const cloud = await waitForCloudContext();
        if (!cloud) {
          return {
            ok: false as const,
            error: "אין חיבור לחשבון. נסה שוב בעוד רגע.",
          };
        }
        if (!rows.length) return { ok: true as const, count: 0 };
        for (const r of rows) {
          if (r.type !== "income") {
            return { ok: false as const, error: "רק הכנסות מותרות בייבוא זה." };
          }
        }
        const categoryById = new Map(incomeSources.map((c) => [c.id, c] as const));
        const categoryRows = [...new Set(rows.map((r) => toDbCategoryId(r.categoryId)).filter(Boolean))]
          .map((id) => {
            const cid = id as string;
            const local = categoryById.get(cid);
            return categoryToSupabaseRow(
              {
                id: cid,
                name: local?.name ?? "Imported income",
                color: local?.color ?? "#737373",
                iconKey: local?.iconKey ?? "tag",
              },
              cloud.userId,
              "income",
              cloud.householdId,
            );
          });
        if (categoryRows.length) {
          const { error: categoriesError } = await upsertCategoriesToSupabase(
            dedupeCategoryUpsertRows(categoryRows),
          );
          if (categoriesError) {
            return { ok: false as const, error: supabaseErrorMessage(categoriesError) };
          }
        }
        const withIds: Expense[] = rows.map((r) => ({
          ...r,
          id: newId(),
        }));
        for (const row of withIds) {
          if (!isStandardUuid(row.id)) {
            return { ok: false as const, error: "שמירה נכשלה: מזהה תנועה לא תקין." };
          }
        }
        const payload = withIds.map((row) => ({
          id: row.id,
          user_id: cloud.userId,
          household_id: cloud.householdId,
          amount: Number(row.amount),
          category: row.categoryId,
          category_id: toDbCategoryId(row.categoryId),
          date: row.date,
          note: row.note ?? "",
          currency: row.currency,
          is_verified: false,
          is_reviewed: false,
          entry_type: "income" as const,
          payment_method_id: row.paymentMethodId,
          installments_info: {
            installmentIndex: row.installmentIndex,
            installments: row.installments,
            paymentMethodId: row.paymentMethodId,
            type: row.type,
          },
          is_recurring: row.recurringMonthly === true,
          receipt_urls: null as string[] | null,
        }));
        const optimisticIds = new Set(withIds.map((r) => r.id));
        setExpenses((prev) => [...prev, ...withIds]);
        try {
          const { error } = await supabase.from("expenses").insert(payload);
          if (error) {
            showSupabaseInsertError(error);
            setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
            return { ok: false as const, error: error.message };
          }
        } catch (error) {
          showSupabaseInsertError(error);
          setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : "ייבוא הכנסות נכשל",
          };
        }
        return { ok: true as const, count: withIds.length };
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "ייבוא הכנסות נכשל בשל שגיאה לא צפויה.",
        };
      }
    },
    [waitForCloudContext, incomeSources],
  );

  const bulkImportExpenses = useCallback(
    async (rows: Omit<Expense, "id">[]) => {
      try {
        const cloud = await waitForCloudContext();
        if (!cloud) {
          return {
            ok: false as const,
            error: "אין חיבור לחשבון. נסה שוב בעוד רגע.",
          };
        }
        if (!rows.length) return { ok: true as const, count: 0 };
        for (const r of rows) {
          if (r.type !== "expense") {
            return { ok: false as const, error: "רק הוצאות מותרות בייבוא זה." };
          }
        }
        const categoryById = new Map(expenseCategories.map((c) => [c.id, c] as const));
        const categoryRows = [...new Set(rows.map((r) => toDbCategoryId(r.categoryId)).filter(Boolean))]
          .map((id) => {
            const cid = id as string;
            const local = categoryById.get(cid);
            return categoryToSupabaseRow(
              {
                id: cid,
                name: local?.name ?? "Imported expense",
                color: local?.color ?? "#737373",
                iconKey: local?.iconKey ?? "tag",
              },
              cloud.userId,
              "expense",
              cloud.householdId,
            );
          });
        if (categoryRows.length) {
          const { error: categoriesError } = await upsertCategoriesToSupabase(
            dedupeCategoryUpsertRows(categoryRows),
          );
          if (categoriesError) {
            return { ok: false as const, error: supabaseErrorMessage(categoriesError) };
          }
        }
        const withIds: Expense[] = rows.map((r) => ({
          ...r,
          id: newId(),
        }));
        for (const row of withIds) {
          if (!isStandardUuid(row.id)) {
            return { ok: false as const, error: "שמירה נכשלה: מזהה תנועה לא תקין." };
          }
        }
        const payload = withIds.map((row) => ({
          id: row.id,
          user_id: cloud.userId,
          household_id: cloud.householdId,
          amount: Number(row.amount),
          category: row.categoryId,
          category_id: toDbCategoryId(row.categoryId),
          date: row.date,
          note: row.note ?? "",
          currency: row.currency,
          is_verified: false,
          is_reviewed: false,
          entry_type: "expense" as const,
          payment_method_id: row.paymentMethodId,
          installments_info: {
            installmentIndex: row.installmentIndex,
            installments: row.installments,
            paymentMethodId: row.paymentMethodId,
            type: row.type,
          },
          is_recurring: row.recurringMonthly === true,
          receipt_urls: null as string[] | null,
        }));
        const optimisticIds = new Set(withIds.map((r) => r.id));
        setExpenses((prev) => [...prev, ...withIds]);
        try {
          const { error } = await supabase.from("expenses").insert(payload);
          if (error) {
            showSupabaseInsertError(error);
            setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
            return { ok: false as const, error: error.message };
          }
        } catch (error) {
          showSupabaseInsertError(error);
          setExpenses((prev) => prev.filter((x) => !optimisticIds.has(x.id)));
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : "ייבוא הוצאות נכשל",
          };
        }
        return { ok: true as const, count: withIds.length };
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "ייבוא הוצאות נכשל בשל שגיאה לא צפויה.",
        };
      }
    },
    [waitForCloudContext, expenseCategories],
  );

  function mergeExpensePatch(e: Expense, patch: ExpenseUpdatePatch): Expense {
    const merged = { ...e, ...patch } as Expense;
    if (
      patch.receiptUrls === null ||
      (Array.isArray(patch.receiptUrls) && patch.receiptUrls.length === 0)
    ) {
      const { receiptUrls: _, ...rest } = merged;
      void _;
      return rest;
    }
    return merged;
  }

  const applyExpensePatchToSupabase = useCallback(
    async (
      id: string,
      patch: ExpenseUpdatePatch,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const projected = parseProjectedRecurringId(id);
      if (projected) {
        const templatePatch: ExpenseUpdatePatch = { ...patch };
        delete templatePatch.date;
        const cloud = await waitForCloudContext();
        if (!cloud) {
          return { ok: false, error: "אין חיבור לענן. נסה שוב בעוד רגע." };
        }
        if (!isStandardUuid(projected.templateId)) {
          return { ok: false, error: "שמירה נכשלה: מזהה תבנית לא תקין." };
        }
        const body = buildSupabaseExpenseUpdateBody(templatePatch);
        if (Object.keys(body).length === 0) return { ok: true };
        const { error } = await supabase
          .from("expenses")
          .update(body)
          .eq("id", projected.templateId)
          .eq("household_id", cloud.householdId);
        if (error) return { ok: false, error: error.message };
        return { ok: true };
      }

      if (!isStandardUuid(id)) {
        return { ok: false, error: "שמירה נכשלה: מזהה תנועה לא תקין לענן." };
      }

      const cloud = await waitForCloudContext();
      if (!cloud) {
        return { ok: false, error: "אין חיבור לענן. נסה שוב בעוד רגע." };
      }
      const body = buildSupabaseExpenseUpdateBody(patch);
      if (Object.keys(body).length === 0) return { ok: true };
      const { error } = await supabase
        .from("expenses")
        .update(body)
        .eq("id", id)
        .eq("household_id", cloud.householdId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },
    [waitForCloudContext],
  );

  const updateExpenseAsync = useCallback(
    async (
      id: string,
      patch: ExpenseUpdatePatch,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const projected = parseProjectedRecurringId(id);
      if (projected) {
        const templatePatch: ExpenseUpdatePatch = { ...patch };
        delete templatePatch.date;
        const res = await applyExpensePatchToSupabase(id, patch);
        if (!res.ok) return res;
        setExpenses((prev) =>
          prev.map((e) => {
            if (e.id === id) return mergeExpensePatch(e, patch);
            if (e.id === projected.templateId && e.recurringMonthly) {
              return mergeExpensePatch(e, templatePatch);
            }
            return e;
          }),
        );
        return { ok: true };
      }

      if (!isStandardUuid(id)) {
        setExpenses((prev) =>
          prev.map((e) => (e.id === id ? mergeExpensePatch(e, patch) : e)),
        );
        return { ok: true };
      }

      const res = await applyExpensePatchToSupabase(id, patch);
      if (!res.ok) return res;
      setExpenses((prev) =>
        prev.map((e) => (e.id === id ? mergeExpensePatch(e, patch) : e)),
      );
      return { ok: true };
    },
    [applyExpensePatchToSupabase],
  );

  const updateExpense = useCallback(
    (id: string, patch: ExpenseUpdatePatch) => {
      const projected = parseProjectedRecurringId(id);
      if (projected) {
        const templatePatch: ExpenseUpdatePatch = { ...patch };
        delete templatePatch.date;
        setExpenses((prev) =>
          prev.map((e) => {
            if (e.id === id) return mergeExpensePatch(e, patch);
            if (e.id === projected.templateId && e.recurringMonthly) {
              return mergeExpensePatch(e, templatePatch);
            }
            return e;
          }),
        );
        void (async () => {
          const cloud = await waitForCloudContext();
          if (!cloud || !isStandardUuid(projected.templateId)) return;
          const body = buildSupabaseExpenseUpdateBody(templatePatch);
          if (Object.keys(body).length === 0) return;
          await supabase
            .from("expenses")
            .update(body)
            .eq("id", projected.templateId)
            .eq("household_id", cloud.householdId);
        })();
        return;
      }

      setExpenses((prev) =>
        prev.map((e) => (e.id === id ? mergeExpensePatch(e, patch) : e)),
      );

      if (!isStandardUuid(id)) {
        return;
      }

      void (async () => {
        const cloud = await waitForCloudContext();
        if (!cloud) return;
        const body = buildSupabaseExpenseUpdateBody(patch);
        if (Object.keys(body).length === 0) return;
        await supabase
          .from("expenses")
          .update(body)
          .eq("id", id)
          .eq("household_id", cloud.householdId);
      })();
    },
    [waitForCloudContext],
  );

  const removeExpense = useCallback(
    async (
      id: string,
      options?: RemoveExpenseOptions,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const mode = options?.mode ?? "single";

      const projected = parseProjectedRecurringId(id);
      if (projected) {
        if (mode === "single") {
          setRecurringIncomeSkips((prev) => {
            const cur = new Set(prev[projected.templateId] ?? []);
            cur.add(projected.ym);
            return { ...prev, [projected.templateId]: [...cur] };
          });
          setExpenses((prev) => prev.filter((e) => e.id !== id));
          return { ok: true as const };
        }

        const templateId = projected.templateId;
        const cloud = await waitForCloudContext();
        if (!cloud) {
          return {
            ok: false as const,
            error: "אין חיבור לחשבון. נסה שוב בעוד רגע.",
          };
        }
        if (isStandardUuid(templateId)) {
          const { error } = await supabase
            .from("expenses")
            .delete()
            .eq("id", templateId)
            .eq("household_id", cloud.householdId)
            .select("id");
          if (error) {
            return {
              ok: false as const,
              error: `מחיקה מהענן נכשלה: ${error.message}`,
            };
          }
        }
        setExpenses((prev) =>
          prev.filter(
            (e) =>
              e.id !== templateId &&
              parseProjectedRecurringId(e.id)?.templateId !== templateId,
          ),
        );
        setRecurringIncomeSkips((prev) => {
          if (!prev[templateId]) return prev;
          const next = { ...prev };
          delete next[templateId];
          return next;
        });
        return { ok: true as const };
      }

      if (!isStandardUuid(id)) {
        setExpenses((prev) => prev.filter((e) => e.id !== id));
        return { ok: true as const };
      }

      const cloud = await waitForCloudContext();
      if (!cloud) {
        return {
          ok: false as const,
          error: "אין חיבור לחשבון. נסה שוב בעוד רגע.",
        };
      }

      const isRecurringTemplate = options?.isRecurringTemplate === true;

      if (isRecurringTemplate && mode === "demote") {
        const tmpl = expenses.find((e) => e.id === id);
        const body = buildSupabaseExpenseUpdateBody({
          recurringMonthly: false,
          installments: 1,
          installmentIndex: 1,
          paymentMethodId: tmpl?.paymentMethodId,
          type: tmpl?.type,
        });
        const { error } = await supabase
          .from("expenses")
          .update(body)
          .eq("id", id)
          .eq("household_id", cloud.householdId);
        if (error) {
          return {
            ok: false as const,
            error: `עדכון בענן נכשל: ${error.message}`,
          };
        }
        setExpenses((prev) =>
          prev
            .filter((e) => parseProjectedRecurringId(e.id)?.templateId !== id)
            .map((e) =>
              e.id === id
                ? {
                    ...e,
                    recurringMonthly: false,
                    installments: 1,
                    installmentIndex: 1,
                  }
                : e,
            ),
        );
        setRecurringIncomeSkips((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return { ok: true as const };
      }

      if (isRecurringTemplate && mode === "series") {
        const { error } = await supabase
          .from("expenses")
          .delete()
          .eq("id", id)
          .eq("household_id", cloud.householdId)
          .select("id");
        if (error) {
          return {
            ok: false as const,
            error: `מחיקה מהענן נכשלה: ${error.message}`,
          };
        }
        setExpenses((prev) =>
          prev.filter(
            (e) =>
              e.id !== id && parseProjectedRecurringId(e.id)?.templateId !== id,
          ),
        );
        setRecurringIncomeSkips((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return { ok: true as const };
      }

      const { error } = await supabase
        .from("expenses")
        .delete()
        .eq("id", id)
        .eq("household_id", cloud.householdId)
        .select("id");
      if (error) {
        return {
          ok: false as const,
          error: `מחיקה מהענן נכשלה: ${error.message}`,
        };
      }
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      setRecurringIncomeSkips((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return { ok: true as const };
    },
    [waitForCloudContext, expenses],
  );

  const skipRecurringIncomePayment = useCallback(
    (templateId: string, ym: `${number}-${number}`) => {
      setRecurringIncomeSkips((prev) => {
        const cur = new Set(prev[templateId] ?? []);
        cur.add(ym);
        return { ...prev, [templateId]: [...cur] };
      });
    },
    [],
  );

  const stopRecurringIncome = useCallback((templateId: string) => {
    setExpenses((prev) =>
      prev.map((e) =>
        e.id === templateId ? { ...e, recurringMonthly: false } : e,
      ),
    );
    setRecurringIncomeSkips((prev) => {
      if (!prev[templateId]) return prev;
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
  }, []);

  const expensesForMonth = useCallback(
    (ym: `${number}-${number}`) => {
      const monthExpenses = expenses.filter((e) => e.date.startsWith(ym));

      return [...monthExpenses].sort((a, b) => {
        const d = b.date.localeCompare(a.date);
        if (d !== 0) return d;
        return b.id.localeCompare(a.id);
      });
    },
    [expenses, recurringIncomeSkips],
  );

  const sortExpenses = useCallback(
    (rows: Expense[], sortBy: "newest" | "oldest" | "amountDesc" | "amountAsc") => {
      return [...rows].sort((a, b) => {
        const aAmt = typeof a?.amount === "number" && Number.isFinite(a.amount) ? a.amount : 0;
        const bAmt = typeof b?.amount === "number" && Number.isFinite(b.amount) ? b.amount : 0;
        if (sortBy === "amountDesc") return bAmt - aAmt;
        if (sortBy === "amountAsc") return aAmt - bAmt;
        const ad = typeof a?.date === "string" ? a.date : "";
        const bd = typeof b?.date === "string" ? b.date : "";
        const d =
          sortBy === "oldest" ? ad.localeCompare(bd) : bd.localeCompare(ad);
        if (d !== 0) return d;
        const aid = typeof a?.id === "string" ? a.id : "";
        const bid = typeof b?.id === "string" ? b.id : "";
        return sortBy === "oldest" ? aid.localeCompare(bid) : bid.localeCompare(aid);
      });
    },
    [],
  );

  const addExpenseCategory = useCallback(
    (name: string, iconKey?: string, color?: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const all = [...MOCK_CATEGORIES, ...customExpenseCategories];
      const existing = all.find(
        (x) => normalizeOptionName(x.name) === normalizeOptionName(trimmed),
      );
      if (existing) return existing.id;
      const id = newId();
      const option: Category = {
        id,
        name: trimmed,
        color:
          typeof color === "string" && color.trim()
            ? color.trim()
            : pickDistinctImportCategoryColor(all.map((c) => c.color)),
        iconKey: normalizeCategoryIconKey(iconKey ?? "tag"),
      };
      setCustomExpenseCategories((prev) => [...prev, option]);
      setExpenseCategoryOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
      return id;
    },
    [customExpenseCategories],
  );

  const updateExpenseCategory = useCallback(
    (id: string, patch: { name?: string; iconKey?: string; color?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      const nextIconKey =
        typeof patch.iconKey === "string"
          ? normalizeCategoryIconKey(patch.iconKey)
          : undefined;
      const nextColor =
        typeof patch.color === "string" && patch.color.trim()
          ? patch.color.trim()
          : undefined;

      const isBuiltin = MOCK_CATEGORIES.some((c) => c.id === id);
      if (isBuiltin) {
        setExpenseCategoryOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            name: nextName ?? prev[id]?.name,
            iconKey: nextIconKey ?? prev[id]?.iconKey,
            color: nextColor ?? prev[id]?.color,
          },
        }));
        return;
      }

      setCustomExpenseCategories((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                name: nextName ?? c.name,
                iconKey: nextIconKey ?? c.iconKey,
                color: nextColor ?? c.color,
              }
            : c,
        ),
      );
    },
    [],
  );

  const deleteExpenseCategory = useCallback(
    (id: string, moveToCategoryId?: string) => {
      const isBuiltin = MOCK_CATEGORIES.some((c) => c.id === id);
      if (isBuiltin) {
        setDeletedBuiltinExpenseCategoryIds((prev) => new Set([...prev, id]));
        setExpenseCategoryOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        if (isValidHouseholdCode(householdId) && isStandardUuid(id)) {
          isDeletingRef.current = true;
          void (async () => {
            const { error } = await deleteCategoryFromSupabase(householdId, id);
            if (error) {
              console.error("[ExpensesContext] category delete failed", error);
              const msg = supabaseErrorMessage(error);
              toast.error(msg || "מחיקת קטגוריה נכשלה");
              isDeletingRef.current = false;
              return;
            }
            // DB-first delete: only after backend success do we mutate local state.
            setCustomExpenseCategories((prev) => prev.filter((c) => c.id !== id));
            if (moveToCategoryId && moveToCategoryId !== id) {
              setExpenses((prev) =>
                prev.map((e) =>
                  e.categoryId === id ? { ...e, categoryId: moveToCategoryId } : e,
                ),
              );
            }
            mergeBudgetOnExpenseCategoryDeleted(id, moveToCategoryId);
            setExpenseCategoryOrder((prev) => {
              const next = prev.filter((x) => x !== id);
              queueMicrotask(() =>
                void persistDataEntryCategoryLayout(next, incomeCategoryOrderRef.current),
              );
              return next;
            });
            setTimeout(() => {
              isDeletingRef.current = false;
            }, 0);
          })();
          return;
        }
        setCustomExpenseCategories((prev) => prev.filter((c) => c.id !== id));
      }
      if (moveToCategoryId && moveToCategoryId !== id) {
        setExpenses((prev) =>
          prev.map((e) =>
            e.categoryId === id ? { ...e, categoryId: moveToCategoryId } : e,
          ),
        );
      }
      mergeBudgetOnExpenseCategoryDeleted(id, moveToCategoryId);
      setExpenseCategoryOrder((prev) => {
        const next = prev.filter((x) => x !== id);
        if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) {
          return next;
        }
        queueMicrotask(() =>
          void persistDataEntryCategoryLayout(next, incomeCategoryOrderRef.current),
        );
        return next;
      });
    },
    [
      authLoading,
      householdId,
      mergeBudgetOnExpenseCategoryDeleted,
      persistDataEntryCategoryLayout,
      session,
      user?.id,
    ],
  );

  const reorderExpenseCategories = useCallback(
    (orderedIds: string[]) => {
      setExpenseCategoryOrder(orderedIds);
      if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) return;
      void persistDataEntryCategoryLayout(orderedIds, incomeCategoryOrderRef.current);
    },
    [authLoading, householdId, persistDataEntryCategoryLayout, session, user?.id],
  );

  const addIncomeSource = useCallback((name: string, iconKey?: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = [...MOCK_INCOME_SOURCES, ...customIncomeSources].find(
      (x) => normalizeOptionName(x.name) === normalizeOptionName(trimmed),
    );
    if (existing) return existing.id;
      const id = newId();
    const option: Category = {
      id,
      name: trimmed,
      color:
        typeof color === "string" && color.trim()
          ? color.trim()
            : pickDistinctImportCategoryColor(
                [...MOCK_INCOME_SOURCES, ...customIncomeSources].map((c) => c.color),
              ),
      iconKey: normalizeCategoryIconKey(iconKey ?? "tag"),
    };
    setCustomIncomeSources((prev) => [...prev, option]);
    setIncomeCategoryOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
    return id;
  }, [customIncomeSources]);

  const updateIncomeSource = useCallback(
    (id: string, patch: { name?: string; iconKey?: string; color?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      const nextIconKey =
        typeof patch.iconKey === "string"
          ? normalizeCategoryIconKey(patch.iconKey)
          : undefined;
      const nextColor =
        typeof patch.color === "string" && patch.color.trim()
          ? patch.color.trim()
          : undefined;

      const isBuiltin = MOCK_INCOME_SOURCES.some((c) => c.id === id);
      if (isBuiltin) {
        setIncomeCategoryOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            name: nextName ?? prev[id]?.name,
            iconKey: nextIconKey ?? prev[id]?.iconKey,
            color: nextColor ?? prev[id]?.color,
          },
        }));
        return;
      }

      setCustomIncomeSources((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                name: nextName ?? c.name,
                iconKey: nextIconKey ?? c.iconKey,
                color: nextColor ?? c.color,
              }
            : c,
        ),
      );
    },
    [],
  );

  const deleteIncomeSource = useCallback(
    (id: string, moveToIncomeSourceId?: string) => {
      const isBuiltin = MOCK_INCOME_SOURCES.some((c) => c.id === id);
      if (isBuiltin) {
        setDeletedBuiltinIncomeSourceIds((prev) => new Set([...prev, id]));
        setIncomeCategoryOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        if (isValidHouseholdCode(householdId) && isStandardUuid(id)) {
          isDeletingRef.current = true;
          void (async () => {
            const { error } = await deleteCategoryFromSupabase(householdId, id);
            if (error) {
              console.error("[ExpensesContext] income source delete failed", error);
              const msg = supabaseErrorMessage(error);
              toast.error(msg || "מחיקת מקור הכנסה נכשלה");
              isDeletingRef.current = false;
              return;
            }
            // DB-first delete: only after backend success do we mutate local state.
            setCustomIncomeSources((prev) => prev.filter((c) => c.id !== id));
            if (moveToIncomeSourceId && moveToIncomeSourceId !== id) {
              setExpenses((prev) =>
                prev.map((e) =>
                  e.type === "income" && e.categoryId === id
                    ? { ...e, categoryId: moveToIncomeSourceId }
                    : e,
                ),
              );
            }
            setIncomeCategoryOrder((prev) => {
              const next = prev.filter((x) => x !== id);
              queueMicrotask(() =>
                void persistDataEntryCategoryLayout(expenseCategoryOrderRef.current, next),
              );
              return next;
            });
            setTimeout(() => {
              isDeletingRef.current = false;
            }, 0);
          })();
          return;
        }
        setCustomIncomeSources((prev) => prev.filter((c) => c.id !== id));
      }
      if (moveToIncomeSourceId && moveToIncomeSourceId !== id) {
        setExpenses((prev) =>
          prev.map((e) =>
            e.type === "income" && e.categoryId === id
              ? { ...e, categoryId: moveToIncomeSourceId }
              : e,
          ),
        );
      }
      setIncomeCategoryOrder((prev) => {
        const next = prev.filter((x) => x !== id);
        if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) {
          return next;
        }
        queueMicrotask(() =>
          void persistDataEntryCategoryLayout(expenseCategoryOrderRef.current, next),
        );
        return next;
      });
    },
    [authLoading, householdId, persistDataEntryCategoryLayout, session, user?.id],
  );

  const reorderIncomeSources = useCallback(
    (orderedIds: string[]) => {
      setIncomeCategoryOrder(orderedIds);
      if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) return;
      void persistDataEntryCategoryLayout(expenseCategoryOrderRef.current, orderedIds);
    },
    [authLoading, householdId, persistDataEntryCategoryLayout, session, user?.id],
  );

  const setQuickAccessCount = useCallback(
    (count: number) => {
      const next = normalizeCategoryDisplayLimit(count);
      if (next === quickAccessCount) return;
      if (authLoading || !session || !user?.id) {
        setQuickAccessCountState(next);
        return;
      }
      void (async () => {
        const { error } = await supabase
          .from("profiles")
          .update({ category_display_limit: next })
          .eq("id", user.id);
        if (error) {
          toast.error(error.message);
          return;
        }
        setQuickAccessCountState(next);
        if (isValidHouseholdCode(householdId)) {
          writeDataEntryLayoutCache(user.id, householdId, { categoryDisplayLimit: next });
        }
      })();
    },
    [authLoading, householdId, quickAccessCount, session, user?.id],
  );

  const addPaymentMethod = useCallback((name: string, iconKey?: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = [...MOCK_PAYMENT_METHODS, ...customPaymentMethods].find(
      (x) => normalizeOptionName(x.name) === normalizeOptionName(trimmed),
    );
    if (existing) return existing.id;
    const id = `pm-custom-${newId()}`;
    const colorPool = ["#60a5fa", "#c084fc", "#2dd4bf", "#f59e0b", "#94a3b8"];
    const option: PaymentMethod = {
      id,
      name: trimmed,
      color:
        typeof color === "string" && color.trim()
          ? color.trim()
          : colorPool[Math.floor(Math.random() * colorPool.length)],
      iconKey: normalizeCategoryIconKey(iconKey ?? "credit-card"),
    };
    setCustomPaymentMethods((prev) => [...prev, option]);
    return id;
  }, [customPaymentMethods]);

  const addDestinationAccount = useCallback(
    (name: string, iconKey?: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = [...MOCK_DESTINATION_ACCOUNTS, ...customDestinationAccounts].find(
      (x) => normalizeOptionName(x.name) === normalizeOptionName(trimmed),
    );
    if (existing) return existing.id;
    const id = `acc-custom-${newId()}`;
    const colorPool = ["#2563eb", "#8b5cf6", "#14b8a6", "#f97316", "#ef4444"];
    const option: PaymentMethod = {
      id,
      name: trimmed,
      color:
        typeof color === "string" && color.trim()
          ? color.trim()
          : colorPool[Math.floor(Math.random() * colorPool.length)],
      iconKey: normalizeCategoryIconKey(iconKey ?? "wallet"),
    };
    setCustomDestinationAccounts((prev) => [...prev, option]);
    return id;
  }, [customDestinationAccounts]);

  const updatePaymentMethod = useCallback(
    (id: string, patch: { name?: string; iconKey?: string; color?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      const nextIconKey =
        typeof patch.iconKey === "string"
          ? normalizeCategoryIconKey(patch.iconKey)
          : undefined;
      const nextColor =
        typeof patch.color === "string" && patch.color.trim()
          ? patch.color.trim()
          : undefined;

      const isBuiltin = MOCK_PAYMENT_METHODS.some((m) => m.id === id);
      if (isBuiltin) {
        setPaymentMethodOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            name: nextName ?? prev[id]?.name,
            iconKey: nextIconKey ?? prev[id]?.iconKey,
            color: nextColor ?? prev[id]?.color,
          },
        }));
        return;
      }

      setCustomPaymentMethods((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                name: nextName ?? m.name,
                iconKey: nextIconKey ?? m.iconKey,
                color: nextColor ?? m.color,
              }
            : m,
        ),
      );
    },
    [],
  );

  const deletePaymentMethod = useCallback(
    (id: string, moveToPaymentMethodId?: string) => {
      const isBuiltin = MOCK_PAYMENT_METHODS.some((m) => m.id === id);
      if (isBuiltin) {
        setDeletedBuiltinPaymentMethodIds((prev) => new Set([...prev, id]));
        setPaymentMethodOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setCustomPaymentMethods((prev) => prev.filter((m) => m.id !== id));
      }

      setExpenses((prev) => {
        const touched = prev.some(
          (e) => e.type === "expense" && e.paymentMethodId === id,
        );
        if (!touched) return prev;

        let fallback = moveToPaymentMethodId ?? "";
        if (!fallback || fallback === id) {
          const mockFallback = MOCK_PAYMENT_METHODS.find((m) => m.id !== id)?.id;
          fallback = mockFallback ?? "";
        }
        if (!fallback || fallback === id) {
          const customFallback = customPaymentMethods.find((m) => m.id !== id)?.id;
          fallback = customFallback ?? "";
        }
        if (!fallback || fallback === id) return prev;

        return prev.map((e) =>
          e.type === "expense" && e.paymentMethodId === id
            ? { ...e, paymentMethodId: fallback }
            : e,
        );
      });
    },
    [customPaymentMethods],
  );

  const updateDestinationAccount = useCallback(
    (id: string, patch: { name?: string; iconKey?: string; color?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      const nextIconKey =
        typeof patch.iconKey === "string"
          ? normalizeCategoryIconKey(patch.iconKey)
          : undefined;
      const nextColor =
        typeof patch.color === "string" && patch.color.trim()
          ? patch.color.trim()
          : undefined;

      const isBuiltin = MOCK_DESTINATION_ACCOUNTS.some((m) => m.id === id);
      if (isBuiltin) {
        setDestinationAccountOverrides((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            name: nextName ?? prev[id]?.name,
            iconKey: nextIconKey ?? prev[id]?.iconKey,
            color: nextColor ?? prev[id]?.color,
          },
        }));
        return;
      }

      setCustomDestinationAccounts((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                name: nextName ?? m.name,
                iconKey: nextIconKey ?? m.iconKey,
                color: nextColor ?? m.color,
              }
            : m,
        ),
      );
    },
    [],
  );

  const deleteDestinationAccount = useCallback(
    (id: string, moveToDestinationAccountId?: string) => {
      const isBuiltin = MOCK_DESTINATION_ACCOUNTS.some((m) => m.id === id);
      if (isBuiltin) {
        setDeletedBuiltinDestinationAccountIds((prev) => new Set([...prev, id]));
        setDestinationAccountOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else {
        setCustomDestinationAccounts((prev) => prev.filter((m) => m.id !== id));
      }

      setExpenses((prev) => {
        const touched = prev.some(
          (e) => e.type === "income" && e.paymentMethodId === id,
        );
        if (!touched) return prev;

        let fallback = moveToDestinationAccountId ?? "";
        if (!fallback || fallback === id) {
          const mockFallback = MOCK_DESTINATION_ACCOUNTS.find((m) => m.id !== id)?.id;
          fallback = mockFallback ?? "";
        }
        if (!fallback || fallback === id) {
          const customFallback = customDestinationAccounts.find((m) => m.id !== id)?.id;
          fallback = customFallback ?? "";
        }
        if (!fallback || fallback === id) return prev;

        return prev.map((e) =>
          e.type === "income" && e.paymentMethodId === id
            ? { ...e, paymentMethodId: fallback }
            : e,
        );
      });
    },
    [customDestinationAccounts],
  );

  const addCustomCurrency = useCallback((labelHe: string) => {
    const trimmed = labelHe.trim();
    if (!trimmed) return null;
    const existing = [...CURRENCIES, ...customCurrencies].find(
      (c) => normalizeOptionName(c.labelHe) === normalizeOptionName(trimmed),
    );
    if (existing) return existing.code;
    const code = `cx-${newId()}`;
    const def: CurrencyDef = {
      code,
      labelHe: trimmed,
      symbol: "¤",
      iconKey: "badge-cent",
    };
    setCustomCurrencies((prev) => [...prev, def]);
    return code;
  }, [customCurrencies]);

  const addManagedCurrency = useCallback((codeInput: string) => {
    const code = normalizeManagedCurrencyCode(codeInput);
    if (!/^[A-Z]{3,6}$/.test(code)) return null;
    const existing = [...CURRENCIES, ...customCurrencies].find(
      (c) => normalizeManagedCurrencyCode(c.code) === code,
    );
    if (existing) return existing.code;
    const def: CurrencyDef = {
      code,
      labelHe: code,
      symbol: code === "ILS" ? "₪" : "¤",
      iconKey: code === "ILS" ? "ils" : "badge-cent",
    };
    setCustomCurrencies((prev) => [...prev, def]);
    return code;
  }, [customCurrencies]);

  const removeManagedCurrency = useCallback((codeInput: string) => {
    const code = normalizeManagedCurrencyCode(codeInput);
    if (!code || builtinCurrencyCodes.has(code)) return;
    setCustomCurrencies((prev) =>
      prev.filter((c) => normalizeManagedCurrencyCode(c.code) !== code),
    );
    setExpenses((prev) =>
      prev.map((e) =>
        normalizeManagedCurrencyCode(e.currency) === code
          ? { ...e, currency: DEFAULT_CURRENCY }
          : e,
      ),
    );
  }, [builtinCurrencyCodes]);

  const clearAllUserData = useCallback(async () => {
    if (isValidHouseholdCode(householdId) && user?.id) {
      await Promise.all([
        supabase.from("expenses").delete().eq("household_id", householdId),
        supabase.from("assets").delete().eq("household_id", householdId),
        supabase.from("savings_goals").delete().eq("household_id", householdId),
        supabase.from("categories").delete().eq("household_id", householdId),
      ]);
      await patchProfileAppState(user.id, {
        [APP_STATE_KEYS.deletedBuiltinExpenseCategoryIds]: [],
        [APP_STATE_KEYS.deletedBuiltinIncomeCategoryIds]: [],
        [APP_STATE_KEYS.budgetsByMonth]: {},
      });
    }
    setExpenses([]);
    setCustomIncomeSources([]);
    setCustomDestinationAccounts([]);
    setCustomPaymentMethods([]);
    setCustomExpenseCategories([]);
    setCustomCurrencies([]);
    setExpenseCategoryOverrides({});
    setIncomeCategoryOverrides({});
    setPaymentMethodOverrides({});
    setDestinationAccountOverrides({});
    setRecurringIncomeSkips({});
    setDeletedBuiltinExpenseCategoryIds(new Set());
    setDeletedBuiltinIncomeSourceIds(new Set());
    setDeletedBuiltinPaymentMethodIds(new Set());
    setDeletedBuiltinDestinationAccountIds(new Set());
    setExpenseCategoryOrder([]);
    setIncomeCategoryOrder([]);
    setQuickAccessCountState(8);
    try {
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_INCOME_CATS);
    } catch {
      /* ignore */
    }
    removeExpandyAppDataKeys();
  }, [householdId, user?.id]);

  const resetLocalState = useCallback(() => {
    setExpenses([]);
    setCustomIncomeSources([]);
    setCustomDestinationAccounts([]);
    setCustomPaymentMethods([]);
    setCustomExpenseCategories([]);
    setCustomCurrencies([]);
    setExpenseCategoryOverrides({});
    setIncomeCategoryOverrides({});
    setPaymentMethodOverrides({});
    setDestinationAccountOverrides({});
    setRecurringIncomeSkips({});
    setDeletedBuiltinExpenseCategoryIds(new Set());
    setDeletedBuiltinIncomeSourceIds(new Set());
    setDeletedBuiltinPaymentMethodIds(new Set());
    setDeletedBuiltinDestinationAccountIds(new Set());
    setExpenseCategoryOrder([]);
    setIncomeCategoryOrder([]);
    latestCategoryListsRef.current = {
      expenseCategories: [],
      incomeSources: [],
    };
    // Keep budget state in sync with category/expense wipes during transitions.
    clearAllBudgetData();
  }, [clearAllBudgetData]);

  /**
   * Sets the sync + fetch-flush locks, wipes all local React state, and
   * aggressively purges localStorage / IndexedDB. Call this synchronously
   * before any Supabase write that moves the user to a new household so the
   * reactive sync effect is blocked for the entire transition window.
   *
   * The household-change useEffect releases the lock automatically after the
   * next Supabase fetch completes (triggered by refreshProfile()).
   */
  const beginHouseholdTransition = useCallback(() => {
    isHouseholdTransitioningRef.current = true;
    isCategoryFetchFlushingRef.current = true;
    starterPackSeedGuardRef.current = "";
    resetLocalState();
    // Purge persistent caches so nothing stale can survive a page reload.
    try {
      removeExpandyAppDataKeys();
      localStorage.removeItem(BUDGET_LOCAL_STORAGE_KEY);
      if (isValidHouseholdCode(householdId)) {
        localStorage.removeItem(`${BUDGET_LOCAL_STORAGE_KEY}__${householdId}`);
      }
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_EXPENSE_CATS);
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_INCOME_CATS);
    } catch { /* ignore */ }
    try {
      const idbWithList = indexedDB as unknown as {
        databases?: () => Promise<Array<{ name?: string }>>;
      };
      if (typeof idbWithList.databases === "function") {
        void idbWithList.databases().then((dbs) => {
          for (const db of dbs) {
            const n = db?.name ?? "";
            if (n.toLowerCase().includes("expandy")) indexedDB.deleteDatabase(n);
          }
        });
      }
    } catch { /* ignore */ }
  }, [householdId, resetLocalState]);

  /**
   * Inserts 5 default "Starter Pack" expense categories for the given user and
   * household. Every call generates fresh UUIDs — never reuses hardcoded IDs.
   * Must only be called during the explicit "Leave → Fresh slate" flow.
   */
  const seedStarterPack = useCallback(
    async (
      forUserId: string,
      forHouseholdId: string,
    ): Promise<{ ok: boolean; error?: unknown }> => {
      const rows = DEFAULT_STARTER_CATEGORIES.map((c) =>
        categoryToSupabaseRow(
          { id: newId(), name: c.name, color: c.color, iconKey: c.iconKey },
          forUserId,
          "expense",
          forHouseholdId,
        ),
      );
      const { error } = await upsertCategoriesToSupabase(
        dedupeCategoryUpsertRows(rows),
      );
      if (error) return { ok: false, error };
      return { ok: true };
    },
    [],
  );

  const value = useMemo(
    () => ({
      expenses,
      sortExpenses,
      expensesForMonth,
      materializeRecurringForMonth,
      addExpense,
      importData,
      bulkImportIncomes,
      bulkImportExpenses,
      updateExpense,
      updateExpenseAsync,
      waitForCloudContext,
      removeExpense,
      expenseCategories,
      incomeSources,
      paymentMethods,
      destinationAccounts,
      currencies,
      addManagedCurrency,
      removeManagedCurrency,
      addExpenseCategory,
      addIncomeSource,
      addPaymentMethod,
      addDestinationAccount,
      updatePaymentMethod,
      deletePaymentMethod,
      updateDestinationAccount,
      deleteDestinationAccount,
      addCustomCurrency,
      updateExpenseCategory,
      deleteExpenseCategory,
      reorderExpenseCategories,
      reorderIncomeSources,
      quickAccessCount,
      setQuickAccessCount,
      updateIncomeSource,
      deleteIncomeSource,
      recurringIncomeSkips,
      skipRecurringIncomePayment,
      stopRecurringIncome,
      clearAllUserData,
      resetLocalState,
      beginHouseholdTransition,
      seedStarterPack,
    }),
    [
      expenses,
      sortExpenses,
      expensesForMonth,
      materializeRecurringForMonth,
      addExpense,
      importData,
      bulkImportIncomes,
      bulkImportExpenses,
      updateExpense,
      updateExpenseAsync,
      waitForCloudContext,
      removeExpense,
      expenseCategories,
      incomeSources,
      paymentMethods,
      destinationAccounts,
      currencies,
      addManagedCurrency,
      removeManagedCurrency,
      addExpenseCategory,
      addIncomeSource,
      addPaymentMethod,
      addDestinationAccount,
      updatePaymentMethod,
      deletePaymentMethod,
      updateDestinationAccount,
      deleteDestinationAccount,
      addCustomCurrency,
      updateExpenseCategory,
      deleteExpenseCategory,
      reorderExpenseCategories,
      reorderIncomeSources,
      quickAccessCount,
      setQuickAccessCount,
      updateIncomeSource,
      deleteIncomeSource,
      recurringIncomeSkips,
      skipRecurringIncomePayment,
      stopRecurringIncome,
      clearAllUserData,
      resetLocalState,
      beginHouseholdTransition,
      seedStarterPack,
    ],
  );

  return (
    <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>
  );
}

export function useExpenses() {
  const ctx = useContext(ExpensesContext);
  if (!ctx) throw new Error("useExpenses must be used within ExpensesProvider");
  return ctx;
}
