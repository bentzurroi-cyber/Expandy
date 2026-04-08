import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { formatYearMonth } from "@/lib/month";
import { normalizeHoldingAssetType } from "@/lib/savingsGoalHolding";
import {
  defaultSavingsGoalColor,
  normalizeSavingsGoalIconKey,
  parseHexColor6,
} from "@/lib/savingsGoalUi";
import { toast } from "sonner";

export type SavingsGoal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string | null;
  isInvestmentPortfolio: boolean;
  color: string;
  icon: string;
  /** Deposits counted toward this calendar month's `monthly_contribution`. */
  monthlyCurrent: number;
  /** Lower = higher priority for partial surplus / compass ordering. */
  priority: number;
  /** Matches household asset type id (`assets.type`). */
  holdingAssetType: string;
  /** User confirmed this month that funds reached the investment account. */
  monthlyInvestmentTransferAck: boolean;
  /** `open` = no numeric cap; progress is open-ended. */
  targetMode: "fixed" | "open";
  /** `surplus` = monthly plan follows month income−expenses (handled in surplus flow). */
  monthlyMode: "fixed" | "surplus";
  updatedAt: string;
};

type SavingsGoalInsert = {
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string | null;
  isInvestmentPortfolio: boolean;
  color?: string;
  icon?: string;
  priority?: number;
  holdingAssetType?: string;
  targetMode?: "fixed" | "open";
  monthlyMode?: "fixed" | "surplus";
};

type SavingsGoalsContextValue = {
  goals: SavingsGoal[];
  loading: boolean;
  totalCurrentAmount: number;
  refresh: () => Promise<void>;
  addGoal: (input: SavingsGoalInsert) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateGoal: (
    id: string,
    patch: Partial<SavingsGoalInsert> & {
      currentAmount?: number;
      monthlyCurrent?: number;
      monthlyInvestmentTransferAck?: boolean;
    },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteGoal: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Add `amount` to current_amount (quick deposit from assets). */
  depositAmount: (
    id: string,
    amount: number,
  ) => Promise<
    { ok: true; reachedTarget: boolean } | { ok: false; error: string }
  >;
};

const SavingsGoalsContext = createContext<SavingsGoalsContextValue | null>(null);

/**
 * Exact `public.savings_goals` columns this client reads via PostgREST.
 * Base table (see `supabase/sql/create_public_savings_goals.sql`) plus extensions:
 * `priority`, `holding_asset_type`, `monthly_investment_transfer_ack`, `target_mode`, `monthly_mode`.
 * Do not add other column names here without a matching DB migration.
 */
const SAVINGS_GOALS_SELECT_COLUMNS =
  "id, name, target_amount, current_amount, monthly_contribution, monthly_current, monthly_investment_transfer_ack, target_date, is_investment_portfolio, color, icon, priority, holding_asset_type, target_mode, monthly_mode, updated_at, created_at";

function mapRow(row: Record<string, unknown>): SavingsGoal {
  const isInv = row.is_investment_portfolio === true;
  const fallbackIcon = isInv ? "trending-up" : "piggy-bank";
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    targetAmount: Number(row.target_amount ?? 0),
    currentAmount: Number(row.current_amount ?? 0),
    monthlyContribution: Number(row.monthly_contribution ?? 0),
    targetDate:
      typeof row.target_date === "string" && row.target_date.length >= 8
        ? row.target_date.slice(0, 10)
        : null,
    isInvestmentPortfolio: isInv,
    color: parseHexColor6(row.color) ?? defaultSavingsGoalColor(isInv),
    icon: normalizeSavingsGoalIconKey(row.icon, fallbackIcon),
    monthlyCurrent: Math.max(0, Number(row.monthly_current ?? 0)),
    priority: (() => {
      const n = Math.floor(Number(row.priority));
      return Number.isFinite(n) && n >= 0 ? n : 50;
    })(),
    holdingAssetType: normalizeHoldingAssetType(
      typeof row.holding_asset_type === "string" ? row.holding_asset_type : "",
    ),
    monthlyInvestmentTransferAck: row.monthly_investment_transfer_ack === true,
    targetMode: row.target_mode === "open" ? "open" : "fixed",
    monthlyMode: row.monthly_mode === "surplus" ? "surplus" : "fixed",
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function SavingsGoalsProvider({ children }: { children: ReactNode }) {
  const { profile, user, session, loading: authLoading } = useAuth();
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const householdId = useMemo(
    () => normalizeHouseholdCode(profile?.household_id ?? ""),
    [profile?.household_id],
  );

  const load = useCallback(async () => {
    if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) {
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const calYm = formatYearMonth(new Date());
      const monthKey = `expandy-sg-cal-month-v1-${householdId}`;
      try {
        const prevYm = localStorage.getItem(monthKey);
        if (prevYm !== calYm) {
          const { error: rollErr } = await supabase
            .from("savings_goals")
            .update({
              monthly_current: 0,
              monthly_investment_transfer_ack: false,
              updated_at: new Date().toISOString(),
            })
            .eq("household_id", householdId);
          if (!rollErr) localStorage.setItem(monthKey, calYm);
        }
      } catch {
        /* ignore localStorage / rollover */
      }

      const { data, error } = await supabase
        .from("savings_goals")
        .select(SAVINGS_GOALS_SELECT_COLUMNS)
        .eq("household_id", householdId)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) {
        setGoals([]);
        return;
      }
      setGoals((data ?? []).map((r) => mapRow(r as Record<string, unknown>)));
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, [authLoading, householdId, session, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (authLoading || !session || !user?.id || !isValidHouseholdCode(householdId)) return;
    const channel = supabase
      .channel(`savings-goals-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "savings_goals",
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authLoading, householdId, load, session, user?.id]);

  const totalCurrentAmount = useMemo(
    () => goals.reduce((s, g) => s + (Number.isFinite(g.currentAmount) ? g.currentAmount : 0), 0),
    [goals],
  );

  const addGoal = useCallback(
    async (input: SavingsGoalInsert): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!user?.id || !isValidHouseholdCode(householdId)) {
        return { ok: false, error: "No household" };
      }
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Name required" };
      const targetMode = input.targetMode === "open" ? "open" : "fixed";
      const monthlyMode = input.monthlyMode === "surplus" ? "surplus" : "fixed";
      if (targetMode === "fixed") {
        if (!Number.isFinite(input.targetAmount) || input.targetAmount <= 0) {
          return { ok: false, error: "Invalid target" };
        }
      } else if (!Number.isFinite(input.targetAmount) || input.targetAmount < 0) {
        return { ok: false, error: "Invalid target" };
      }
      const current = Math.max(0, input.currentAmount);
      const monthly = Math.max(0, input.monthlyContribution);
      const isInv = input.isInvestmentPortfolio === true;
      const fallbackIcon = isInv ? "trending-up" : "piggy-bank";
      const color =
        parseHexColor6(input.color) ?? defaultSavingsGoalColor(isInv);
      const icon = normalizeSavingsGoalIconKey(input.icon ?? fallbackIcon, fallbackIcon);
      const pri =
        input.priority != null && Number.isFinite(input.priority)
          ? Math.max(0, Math.min(100000, Math.floor(input.priority)))
          : 50;
      const holding = normalizeHoldingAssetType(input.holdingAssetType ?? "");
      const targetAmt =
        targetMode === "open" ? 0 : Math.round(input.targetAmount * 100) / 100;
      const row = {
        user_id: user.id,
        household_id: householdId,
        name,
        target_amount: targetAmt,
        current_amount: Math.round(current * 100) / 100,
        monthly_contribution: Math.round(monthly * 100) / 100,
        target_date: input.targetDate && input.targetDate.length >= 8 ? input.targetDate : null,
        is_investment_portfolio: isInv,
        color,
        icon,
        monthly_current: 0,
        monthly_investment_transfer_ack: false,
        priority: pri,
        holding_asset_type: holding || null,
        target_mode: targetMode,
        monthly_mode: monthlyMode,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("savings_goals").insert(row);
      if (error) {
        toast.error(error.message);
        return { ok: false, error: error.message };
      }
      await load();
      return { ok: true };
    },
    [householdId, load, user?.id],
  );

  const updateGoal = useCallback(
    async (
      id: string,
      patch: Partial<SavingsGoalInsert> & {
        currentAmount?: number;
        monthlyCurrent?: number;
        monthlyInvestmentTransferAck?: boolean;
      },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isValidHouseholdCode(householdId)) {
        return { ok: false, error: "No household" };
      }
      const existing = goals.find((x) => x.id === id);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof patch.name === "string") updates.name = patch.name.trim();
      if (patch.targetAmount != null && Number.isFinite(patch.targetAmount) && patch.targetAmount >= 0) {
        updates.target_amount = Math.round(patch.targetAmount * 100) / 100;
      }
      if (patch.currentAmount != null && Number.isFinite(patch.currentAmount) && patch.currentAmount >= 0) {
        updates.current_amount = Math.round(patch.currentAmount * 100) / 100;
      }
      if (patch.monthlyCurrent != null && Number.isFinite(patch.monthlyCurrent) && patch.monthlyCurrent >= 0) {
        updates.monthly_current = Math.round(patch.monthlyCurrent * 100) / 100;
      }
      if (patch.monthlyContribution != null && Number.isFinite(patch.monthlyContribution)) {
        updates.monthly_contribution = Math.max(0, Math.round(patch.monthlyContribution * 100) / 100);
      }
      if (patch.targetDate !== undefined) {
        updates.target_date =
          patch.targetDate && patch.targetDate.length >= 8 ? patch.targetDate : null;
      }
      if (patch.isInvestmentPortfolio !== undefined) {
        updates.is_investment_portfolio = patch.isInvestmentPortfolio === true;
      }
      if (patch.color !== undefined) {
        const c = parseHexColor6(patch.color);
        if (c) updates.color = c;
      }
      if (patch.icon !== undefined) {
        const isInv =
          patch.isInvestmentPortfolio !== undefined
            ? patch.isInvestmentPortfolio === true
            : existing?.isInvestmentPortfolio === true;
        const fallback = isInv ? "trending-up" : "piggy-bank";
        updates.icon = normalizeSavingsGoalIconKey(patch.icon, fallback);
      }
      if (patch.priority != null && Number.isFinite(patch.priority)) {
        updates.priority = Math.max(0, Math.min(100000, Math.floor(patch.priority)));
      }
      if (patch.holdingAssetType !== undefined) {
        const h = normalizeHoldingAssetType(patch.holdingAssetType);
        updates.holding_asset_type = h || null;
      }
      if (patch.monthlyInvestmentTransferAck !== undefined) {
        updates.monthly_investment_transfer_ack = patch.monthlyInvestmentTransferAck === true;
      }
      if (patch.targetMode !== undefined) {
        updates.target_mode = patch.targetMode === "open" ? "open" : "fixed";
      }
      if (patch.monthlyMode !== undefined) {
        updates.monthly_mode = patch.monthlyMode === "surplus" ? "surplus" : "fixed";
      }
      if (Object.keys(updates).length <= 1) return { ok: true };
      const { error } = await supabase
        .from("savings_goals")
        .update(updates)
        .eq("id", id)
        .eq("household_id", householdId);
      if (error) {
        toast.error(error.message);
        return { ok: false, error: error.message };
      }
      await load();
      return { ok: true };
    },
    [goals, householdId, load],
  );

  const deleteGoal = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isValidHouseholdCode(householdId)) {
        return { ok: false, error: "No household" };
      }
      const { error } = await supabase
        .from("savings_goals")
        .delete()
        .eq("id", id)
        .eq("household_id", householdId);
      if (error) {
        toast.error(error.message);
        return { ok: false, error: error.message };
      }
      await load();
      return { ok: true };
    },
    [householdId, load],
  );

  const depositAmount = useCallback(
    async (
      id: string,
      amount: number,
    ): Promise<
      { ok: true; reachedTarget: boolean } | { ok: false; error: string }
    > => {
      const g = goals.find((x) => x.id === id);
      if (!g) return { ok: false, error: "Not found" };
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Invalid amount" };
      }
      const add = Math.round(amount * 100) / 100;
      const target = g.targetAmount;
      const wasBelow =
        g.targetMode === "open" ? false : target > 0 && g.currentAmount < target;
      const next = Math.round((g.currentAmount + add) * 100) / 100;
      const nextMonthly = Math.round((g.monthlyCurrent + add) * 100) / 100;
      const reachedTarget = wasBelow && next >= target;
      const res = await updateGoal(id, {
        currentAmount: next,
        monthlyCurrent: nextMonthly,
      });
      if (!res.ok) return res;
      return { ok: true, reachedTarget };
    },
    [goals, updateGoal],
  );

  const value = useMemo<SavingsGoalsContextValue>(
    () => ({
      goals,
      loading,
      totalCurrentAmount,
      refresh: load,
      addGoal,
      updateGoal,
      deleteGoal,
      depositAmount,
    }),
    [addGoal, deleteGoal, depositAmount, goals, load, loading, totalCurrentAmount, updateGoal],
  );

  return (
    <SavingsGoalsContext.Provider value={value}>{children}</SavingsGoalsContext.Provider>
  );
}

export function useSavingsGoals(): SavingsGoalsContextValue {
  const ctx = useContext(SavingsGoalsContext);
  if (!ctx) {
    throw new Error("useSavingsGoals must be used within SavingsGoalsProvider");
  }
  return ctx;
}
