import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CATEGORY_BUDGETS } from "@/data/mock";
import { formatYearMonth, type YearMonth } from "@/lib/month";

type BudgetContextValue = {
  budgets: Record<string, number>;
  getBudget: (categoryId: string, ym?: YearMonth) => number;
  setBudget: (categoryId: string, amount: number, ym?: YearMonth) => void;
  getMonthlyBudgetTotal: (ym?: YearMonth) => number;
  setMonthlyBudgetTotal: (amount: number, ym?: YearMonth) => Promise<boolean>;
  /** Snapshot (category ids + BUDGET_MONTHLY_TOTAL_KEY) used when no month chain matches. */
  setDefaultBudgetTemplate: (template: Record<string, number>) => void;
  /**
   * When an expense category is removed: drop its budget entry.
   * If moveToCategoryId is set (user reassigned transactions), merge that budget into the target.
   */
  mergeBudgetOnExpenseCategoryDeleted: (
    deletedCategoryId: string,
    moveToCategoryId?: string,
  ) => void;
  /** Reset stored budgets to demo defaults (used with full data clear). */
  clearAllUserData: () => void;
};

const BudgetContext = createContext<BudgetContextValue | null>(null);

/** Stored alongside per-month maps; not a real calendar month. */
export const BUDGET_MONTHLY_TOTAL_KEY = "__monthly_total__";
export const BUDGET_DEFAULT_TEMPLATE_KEY = "__default_budget__";

const STORAGE_KEY = "expandy-budgets-by-month-v1";

type BudgetsByMonth = Record<string, Record<string, number>>;

function previousYearMonth(ym: YearMonth): YearMonth {
  const [yRaw, mRaw] = ym.split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
  const d = new Date(y, m - 2, 1);
  return formatYearMonth(d);
}

function isCalendarYearMonthKey(k: string): boolean {
  return /^\d{4}-\d{2}$/.test(k);
}

/**
 * Resolve budgets for a calendar month from storage: direct row, walk backwards
 * through months, then saved default template, then empty.
 */
export function resolveMonthBudgetsFrom(
  store: BudgetsByMonth,
  ym: YearMonth,
): Record<string, number> {
  const direct = store[ym];
  if (direct !== undefined && typeof direct === "object") {
    return { ...direct };
  }
  let cur: YearMonth = ym;
  for (let i = 0; i < 240; i += 1) {
    const next = previousYearMonth(cur);
    if (next === cur) break;
    cur = next;
    const b = store[cur];
    if (
      b !== undefined &&
      typeof b === "object" &&
      Object.keys(b).length > 0
    ) {
      return { ...b };
    }
  }
  const tmpl = store[BUDGET_DEFAULT_TEMPLATE_KEY];
  if (
    tmpl !== undefined &&
    typeof tmpl === "object" &&
    Object.keys(tmpl).length > 0
  ) {
    return { ...tmpl };
  }
  return {};
}

function readStoredBudgetsByMonth(): BudgetsByMonth {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BudgetsByMonth;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [budgetsByMonth, setBudgetsByMonth] = useState<BudgetsByMonth>(() =>
    readStoredBudgetsByMonth(),
  );
  const activeMonth = formatYearMonth(new Date());

  const resolveMonthBudgets = useCallback(
    (ym: YearMonth): Record<string, number> =>
      resolveMonthBudgetsFrom(budgetsByMonth, ym),
    [budgetsByMonth],
  );

  const budgets = useMemo(
    () => resolveMonthBudgets(activeMonth),
    [resolveMonthBudgets, activeMonth],
  );

  const persistBudgets = useCallback((next: BudgetsByMonth) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const getBudget = useCallback(
    (categoryId: string, ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const scoped = resolveMonthBudgets(keyMonth);
      return scoped[categoryId] ?? DEFAULT_CATEGORY_BUDGETS[categoryId] ?? 0;
    },
    [activeMonth, resolveMonthBudgets],
  );

  const setBudget = useCallback(
    (categoryId: string, amount: number, ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const nextAmount = Math.max(0, Math.round(amount * 100) / 100);
      setBudgetsByMonth((prev) => {
        const base =
          prev[keyMonth] ?? resolveMonthBudgetsFrom(prev, keyMonth);
        const updatedMonth = { ...base, [categoryId]: nextAmount };
        const next = { ...prev, [keyMonth]: updatedMonth };
        persistBudgets(next);
        return next;
      });
    },
    [activeMonth, persistBudgets],
  );

  const getMonthlyBudgetTotal = useCallback(
    (ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const scoped = resolveMonthBudgets(keyMonth);
      return scoped[BUDGET_MONTHLY_TOTAL_KEY] ?? 0;
    },
    [activeMonth, resolveMonthBudgets],
  );

  const setMonthlyBudgetTotal = useCallback(
    async (amount: number, ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const nextAmount = Math.max(0, Math.round(amount * 100) / 100);
      setBudgetsByMonth((prev) => {
        const base =
          prev[keyMonth] ?? resolveMonthBudgetsFrom(prev, keyMonth);
        const updatedMonth = {
          ...base,
          [BUDGET_MONTHLY_TOTAL_KEY]: nextAmount,
        };
        const next = { ...prev, [keyMonth]: updatedMonth };
        persistBudgets(next);
        return next;
      });
      return true;
    },
    [activeMonth, persistBudgets],
  );

  const setDefaultBudgetTemplate = useCallback(
    (template: Record<string, number>) => {
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(template)) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
        cleaned[k] = Math.round(v * 100) / 100;
      }
      setBudgetsByMonth((prev) => {
        const next = {
          ...prev,
          [BUDGET_DEFAULT_TEMPLATE_KEY]: cleaned,
        };
        persistBudgets(next);
        return next;
      });
    },
    [persistBudgets],
  );

  const mergeBudgetOnExpenseCategoryDeleted = useCallback(
    (deletedCategoryId: string, moveToCategoryId?: string) => {
      setBudgetsByMonth((prev) => {
        const nextByMonth: BudgetsByMonth = {};
        for (const [ym, monthBudgets] of Object.entries(prev)) {
          if (!isCalendarYearMonthKey(ym)) {
            nextByMonth[ym] = { ...monthBudgets };
            continue;
          }
          const nextMonth: Record<string, number> = { ...monthBudgets };
          const fromStored = nextMonth[deletedCategoryId];
          const fromDefault = DEFAULT_CATEGORY_BUDGETS[deletedCategoryId];
          const deletedAmount =
            typeof fromStored === "number"
              ? fromStored
              : typeof fromDefault === "number"
                ? fromDefault
                : 0;
          delete nextMonth[deletedCategoryId];
          if (moveToCategoryId && moveToCategoryId !== deletedCategoryId && deletedAmount > 0) {
            const toStored = nextMonth[moveToCategoryId];
            const toDefault = DEFAULT_CATEGORY_BUDGETS[moveToCategoryId];
            const base =
              typeof toStored === "number"
                ? toStored
                : typeof toDefault === "number"
                  ? toDefault
                  : 0;
            nextMonth[moveToCategoryId] = Math.round((base + deletedAmount) * 100) / 100;
          }
          nextByMonth[ym] = nextMonth;
        }
        persistBudgets(nextByMonth);
        return nextByMonth;
      });
    },
    [persistBudgets],
  );

  const clearAllUserData = useCallback(() => {
    setBudgetsByMonth({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      budgets,
      getBudget,
      setBudget,
      getMonthlyBudgetTotal,
      setMonthlyBudgetTotal,
      setDefaultBudgetTemplate,
      mergeBudgetOnExpenseCategoryDeleted,
      clearAllUserData,
    }),
    [
      budgets,
      getBudget,
      setBudget,
      getMonthlyBudgetTotal,
      setMonthlyBudgetTotal,
      setDefaultBudgetTemplate,
      mergeBudgetOnExpenseCategoryDeleted,
      clearAllUserData,
    ],
  );

  return (
    <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
  );
}

export function useBudgets() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudgets must be used within BudgetProvider");
  return ctx;
}
