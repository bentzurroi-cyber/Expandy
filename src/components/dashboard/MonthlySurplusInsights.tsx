import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { useAuth } from "@/context/AuthContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useFxTick } from "@/context/FxContext";
import { useSavingsGoals } from "@/context/SavingsGoalsContext";
import { useI18n } from "@/context/I18nContext";
import { convertToILS } from "@/lib/fx";
import {
  buildGeminiMonthPayload,
  fetchGeminiMonthInsight,
} from "@/lib/geminiMonthInsight";
import { fireSavingsGoalConfetti } from "@/lib/goalConfetti";
import { formatIlsWholeCeil } from "@/lib/format";
import {
  allocateSurplusToGoals,
  computeMonthSurplusIls,
} from "@/lib/monthlySurplusInsights";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { formatYearMonth, type YearMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { toast } from "sonner";

/** Current-month surplus + suggested split across goals (dashboard). */
export function MonthlySurplusInsights() {
  const { t, dir, lang } = useI18n();
  const { profile } = useAuth();
  const fxTick = useFxTick();
  const { expensesForMonth, materializeRecurringForMonth } = useExpenses();
  const { goals, depositAmount, loading: goalsLoading, totalCurrentAmount } = useSavingsGoals();

  const householdId = useMemo(
    () => normalizeHouseholdCode(profile?.household_id ?? ""),
    [profile?.household_id],
  );

  const ym: YearMonth = useMemo(() => formatYearMonth(new Date()), []);

  useEffect(() => {
    if (!isValidHouseholdCode(householdId)) return;
    materializeRecurringForMonth(ym);
  }, [householdId, materializeRecurringForMonth, ym]);

  const surplus = useMemo(() => {
    const rows = expensesForMonth(ym);
    return computeMonthSurplusIls(rows, `${ym}-01`, (amt, ccy, d) =>
      convertToILS(amt, ccy, d),
    );
  }, [expensesForMonth, fxTick, ym]);

  const allocation = useMemo(
    () => allocateSurplusToGoals(surplus, goals),
    [goals, surplus],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [amountSav, setAmountSav] = useState("");
  const [amountInv, setAmountInv] = useState("");
  const [depositing, setDepositing] = useState<string | null>(null);
  const [aiTip, setAiTip] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    setAmountSav(
      allocation.amountToSavings > 0.009
        ? formatNumericInput(String(allocation.amountToSavings))
        : "",
    );
    setAmountInv(
      allocation.amountToInvestment > 0.009
        ? formatNumericInput(String(allocation.amountToInvestment))
        : "",
    );
  }, [allocation.amountToInvestment, allocation.amountToSavings, modalOpen]);

  /** Future Gemini tip — payload is ready; API stays off until configured. */
  useEffect(() => {
    if (!isValidHouseholdCode(householdId) || surplus <= 0.009) {
      setAiTip(null);
      return;
    }
    const rows = expensesForMonth(ym);
    let inc = 0;
    let exp = 0;
    for (const e of rows) {
      if (!e || typeof e.amount !== "number" || !Number.isFinite(e.amount)) continue;
      const ils = convertToILS(e.amount, e.currency ?? "ILS", `${ym}-01`);
      if (e.type === "income") inc += ils;
      else exp += ils;
    }
    const payload = buildGeminiMonthPayload({
      month: ym,
      locale: lang === "he" ? "he" : "en",
      incomeIls: inc,
      expenseIls: exp,
      goalsCount: goals.length,
      goalsCurrentIls: totalCurrentAmount,
      goalsTargetIls: goals.reduce((s, g) => s + g.targetAmount, 0),
    });
    let cancelled = false;
    void (async () => {
      const res = await fetchGeminiMonthInsight(payload);
      if (!cancelled && res?.text) setAiTip(res.text);
    })();
    return () => {
      cancelled = true;
    };
  }, [expensesForMonth, goals, householdId, lang, surplus, totalCurrentAmount, ym]);

  const advice = useMemo(() => {
    const { savingsGoal, amountToSavings, investmentGoal, amountToInvestment } = allocation;
    const y = formatIlsWholeCeil(amountToSavings);
    const rest = formatIlsWholeCeil(amountToInvestment);
    const s = formatIlsWholeCeil(surplus);
    if (savingsGoal && investmentGoal && amountToSavings > 0.009 && amountToInvestment > 0.009) {
      return t.monthlyInsightAdviceSplit
        .replace("{{y}}", y)
        .replace("{{sav}}", savingsGoal.name)
        .replace("{{rest}}", rest)
        .replace("{{inv}}", investmentGoal.name);
    }
    if (savingsGoal && amountToSavings > 0.009) {
      return t.monthlyInsightAdviceSavings
        .replace("{{y}}", y)
        .replace("{{sav}}", savingsGoal.name);
    }
    if (investmentGoal && amountToInvestment > 0.009) {
      return t.monthlyInsightAdviceInv
        .replace("{{surplus}}", s)
        .replace("{{inv}}", investmentGoal.name);
    }
    return t.monthlyInsightAdviceGeneric;
  }, [allocation, surplus, t]);

  const runDeposit = useCallback(
    async (goalId: string, raw: string) => {
      const p = parseNumericInput(raw);
      const amt = p != null && Number.isFinite(p) ? Math.ceil(p) : 0;
      if (amt <= 0) {
        toast.error(t.savingsGoalDepositAmountInvalid);
        return;
      }
      setDepositing(goalId);
      try {
        const res = await depositAmount(goalId, amt);
        if (res.ok) {
          toast.success(t.savingsGoalDepositedToast);
          if (res.reachedTarget) void fireSavingsGoalConfetti();
          setModalOpen(false);
        }
      } finally {
        setDepositing(null);
      }
    },
    [depositAmount, t],
  );

  if (!isValidHouseholdCode(householdId)) return null;
  if (surplus <= 0.009) return null;

  const surplusLabel = formatIlsWholeCeil(surplus);

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-amber-500/12 via-background to-sky-500/10 p-6 shadow-sm",
        )}
        dir={dir}
      >
        <div className="pointer-events-none absolute -end-6 -top-6 size-28 rounded-full bg-amber-400/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-8 -start-8 size-32 rounded-full bg-sky-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.monthlyInsightBadge}
              </p>
              <p className="text-lg font-semibold leading-snug text-foreground">
                {t.monthlyInsightSurplus.replace("{{amount}}", surplusLabel)}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">{advice}</p>
              {aiTip ? (
                <p className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>{aiTip}</span>
                </p>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => setModalOpen(true)}
            disabled={goalsLoading || goals.length === 0}
          >
            {t.monthlyInsightCta}
          </Button>
          {goals.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.monthlyInsightNoGoals}</p>
          ) : null}
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle>{t.monthlyInsightModalTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            {allocation.savingsGoal && allocation.amountToSavings > 0.009 ? (
              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: `${allocation.savingsGoal.color}22`,
                      color: allocation.savingsGoal.color,
                    }}
                  >
                    <CategoryGlyph iconKey={allocation.savingsGoal.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {allocation.savingsGoal.name}
                  </span>
                </div>
                <Label htmlFor="insight-sav">{t.savingsGoalDepositAmountLabel}</Label>
                <Input
                  id="insight-sav"
                  dir="ltr"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={amountSav}
                  onChange={(e) => setAmountSav(formatNumericInput(e.target.value))}
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={depositing != null}
                  onClick={() =>
                    void runDeposit(allocation.savingsGoal!.id, amountSav)
                  }
                >
                  {t.monthlyInsightDeposit}
                </Button>
              </div>
            ) : null}
            {allocation.investmentGoal && allocation.amountToInvestment > 0.009 ? (
              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: `${allocation.investmentGoal.color}22`,
                      color: allocation.investmentGoal.color,
                    }}
                  >
                    <CategoryGlyph iconKey={allocation.investmentGoal.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {allocation.investmentGoal.name}
                  </span>
                </div>
                <Label htmlFor="insight-inv">{t.savingsGoalDepositAmountLabel}</Label>
                <Input
                  id="insight-inv"
                  dir="ltr"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={amountInv}
                  onChange={(e) => setAmountInv(formatNumericInput(e.target.value))}
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={depositing != null}
                  onClick={() =>
                    void runDeposit(allocation.investmentGoal!.id, amountInv)
                  }
                >
                  {t.monthlyInsightDeposit}
                </Button>
              </div>
            ) : null}
            {goals.length > 0 &&
            allocation.amountToSavings <= 0.009 &&
            allocation.amountToInvestment <= 0.009 ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t.monthlyInsightNoAutoSplit}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              {t.savingsGoalCancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
