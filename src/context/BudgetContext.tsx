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
const MONTHLY_TOTAL_KEY = "__monthly_total__";
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
    (ym: YearMonth): Record<string, number> => {
      const direct = budgetsByMonth[ym];
      if (direct && typeof direct === "object") return direct;
      const prev = budgetsByMonth[previousYearMonth(ym)];
      if (prev && typeof prev === "object") return prev;
      return {};
    },
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
        const base = prev[keyMonth] ?? resolveMonthBudgets(keyMonth);
        const updatedMonth = { ...base, [categoryId]: nextAmount };
        const next = { ...prev, [keyMonth]: updatedMonth };
        persistBudgets(next);
        return next;
      });
    },
    [activeMonth, persistBudgets, resolveMonthBudgets],
  );

  const getMonthlyBudgetTotal = useCallback(
    (ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const scoped = resolveMonthBudgets(keyMonth);
      return scoped[MONTHLY_TOTAL_KEY] ?? 0;
    },
    [activeMonth, resolveMonthBudgets],
  );

  const setMonthlyBudgetTotal = useCallback(
    async (amount: number, ym?: YearMonth) => {
      const keyMonth = ym ?? activeMonth;
      const nextAmount = Math.max(0, Math.round(amount * 100) / 100);
      setBudgetsByMonth((prev) => {
        const base = prev[keyMonth] ?? resolveMonthBudgets(keyMonth);
        const updatedMonth = { ...base, [MONTHLY_TOTAL_KEY]: nextAmount };
        const next = { ...prev, [keyMonth]: updatedMonth };
        persistBudgets(next);
        return next;
      });
      return true;
    },
    [activeMonth, persistBudgets, resolveMonthBudgets],
  );

  const mergeBudgetOnExpenseCategoryDeleted = useCallback(
    (deletedCategoryId: string, moveToCategoryId?: string) => {
      setBudgetsByMonth((prev) => {
        const nextByMonth: BudgetsByMonth = {};
        for (const [ym, monthBudgets] of Object.entries(prev)) {
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
      mergeBudgetOnExpenseCategoryDeleted,
      clearAllUserData,
    }),
    [
      budgets,
      getBudget,
      setBudget,
      getMonthlyBudgetTotal,
      setMonthlyBudgetTotal,
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
