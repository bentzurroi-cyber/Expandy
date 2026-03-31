import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CATEGORY_BUDGETS } from "@/data/mock";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

type BudgetContextValue = {
  budgets: Record<string, number>;
  getBudget: (categoryId: string) => number;
  setBudget: (categoryId: string, amount: number) => void;
  getMonthlyBudgetTotal: () => number;
  setMonthlyBudgetTotal: (amount: number) => Promise<boolean>;
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

export function BudgetProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [budgets, setBudgets] = useState<Record<string, number>>({});

  useEffect(() => {
    async function loadBudgets() {
      if (!profile?.household_id) {
        setBudgets({});
        return;
      }
      const { data } = await supabase
        .from("settings")
        .select("budget_limits")
        .eq("household_id", profile.household_id)
        .maybeSingle();
      const limits = (data?.budget_limits ?? {}) as Record<string, number>;
      setBudgets(limits);
    }
    void loadBudgets();
  }, [profile?.household_id]);

  const getBudget = useCallback(
    (categoryId: string) => budgets[categoryId] ?? DEFAULT_CATEGORY_BUDGETS[categoryId] ?? 0,
    [budgets],
  );

  const setBudget = useCallback((categoryId: string, amount: number) => {
    const next = Math.max(0, Math.round(amount * 100) / 100);
    setBudgets((prev) => {
      const updated = { ...prev, [categoryId]: next };
      if (profile?.household_id) {
        void supabase.from("settings").upsert({
          household_id: profile.household_id,
          budget_limits: updated,
        });
      }
      return updated;
    });
  }, [profile?.household_id]);

  const getMonthlyBudgetTotal = useCallback(
    () => budgets[MONTHLY_TOTAL_KEY] ?? 0,
    [budgets],
  );

  const setMonthlyBudgetTotal = useCallback(async (amount: number) => {
    const next = Math.max(0, Math.round(amount * 100) / 100);
    const updated = { ...budgets, [MONTHLY_TOTAL_KEY]: next };
    setBudgets(updated);
    if (!profile?.household_id) return false;
    const { error } = await supabase.from("settings").upsert({
      household_id: profile.household_id,
      budget_limits: updated,
    });
    if (error) {
      toast.error("שמירת התקציב החודשי נכשלה");
      return false;
    }
    return true;
  }, [profile?.household_id, budgets]);

  const mergeBudgetOnExpenseCategoryDeleted = useCallback(
    (deletedCategoryId: string, moveToCategoryId?: string) => {
      setBudgets((prev) => {
        const next: Record<string, number> = { ...prev };
        const fromStored = next[deletedCategoryId];
        const fromDefault = DEFAULT_CATEGORY_BUDGETS[deletedCategoryId];
        const deletedAmount =
          typeof fromStored === "number"
            ? fromStored
            : typeof fromDefault === "number"
              ? fromDefault
              : 0;
        delete next[deletedCategoryId];

        if (
          moveToCategoryId &&
          moveToCategoryId !== deletedCategoryId &&
          deletedAmount > 0
        ) {
          const toStored = next[moveToCategoryId];
          const toDefault = DEFAULT_CATEGORY_BUDGETS[moveToCategoryId];
          const base =
            typeof toStored === "number"
              ? toStored
              : typeof toDefault === "number"
                ? toDefault
                : 0;
          next[moveToCategoryId] =
            Math.round((base + deletedAmount) * 100) / 100;
        }
        return next;
      });
    },
    [],
  );

  const clearAllUserData = useCallback(() => {
    setBudgets({});
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
