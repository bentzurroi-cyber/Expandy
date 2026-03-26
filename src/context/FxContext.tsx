import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAssets } from "@/context/AssetsContext";
import { useExpenses } from "@/context/ExpensesContext";
import { warmupFxRates } from "@/lib/fx";

type FxContextValue = {
  /** מונה שמתעדכן לאחר טעינת שערים — יש לכלול ב-deps של useMemo שמחשבים ₪ */
  tick: number;
};

const FxContext = createContext<FxContextValue | null>(null);

export function FxProvider({ children }: { children: ReactNode }) {
  const { expenses } = useExpenses();
  const { snapshots } = useAssets();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const pairs: { date: string; currency: string }[] = [
      ...expenses.map((e) => ({ date: e.date, currency: e.currency })),
      ...snapshots.flatMap((s) =>
        s.accounts.map((a) => ({
          date: `${s.ym}-01`,
          currency: a.currency ?? "ILS",
        })),
      ),
    ];
    warmupFxRates(pairs).finally(() => {
      if (!cancelled) setTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [expenses, snapshots]);

  const value = useMemo(() => ({ tick }), [tick]);
  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

export function useFxTick(): number {
  const ctx = useContext(FxContext);
  if (!ctx) return 0;
  return ctx.tick;
}
