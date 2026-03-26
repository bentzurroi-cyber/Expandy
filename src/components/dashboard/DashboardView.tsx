import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, PieChart as PieChartIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { MonthYearPicker } from "@/components/common/MonthYearPicker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { useBudgets } from "@/context/BudgetContext";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import type { Expense } from "@/data/mock";
import { overBudgetStripeStyle } from "@/lib/budgetStripe";
import { convertToILS } from "@/lib/fx";
import { formatCurrencyCompact, formatDateDDMMYYYY, formatIls } from "@/lib/format";
import {
  formatYearMonth,
  hebrewMonthYearLabel,
  lastNYearMonths,
  monthYearShort,
  type YearMonth,
} from "@/lib/month";
import { cn } from "@/lib/utils";

type ChartMode = "bars" | "pie";

type Row = {
  categoryId: string;
  name: string;
  iconKey: string;
  color: string;
  spent: number;
  budget: number;
  over: boolean;
  pct: number;
};

const INCOME_PIE_COLORS = [
  "#22c55e", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#f97316", // orange
  "#eab308", // yellow
  "#a855f7", // purple
  "#ef4444", // red
] as const;

export type DashboardViewProps = {
  onEditExpense: (e: Expense) => void;
  onCategoryDrillDown: (categoryId: string, month: YearMonth) => void;
};

export function DashboardView({
  onEditExpense,
  onCategoryDrillDown,
}: DashboardViewProps) {
  const fxTick = useFxTick();
  const { t, dir } = useI18n();
  const { getBudget, budgets } = useBudgets();
  const {
    expenses,
    expensesForMonth,
    materializeRecurringForMonth,
    expenseCategories,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    currencies,
  } = useExpenses();
  const [chartMode, setChartMode] = useState<ChartMode>("bars");
  const ALL_TIME = "__all_time__" as const;
  const [timeframeMode, setTimeframeMode] = useState<"month" | "year" | "all">("month");
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | typeof ALL_TIME>(() =>
    formatYearMonth(new Date()),
  );
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()));
  const [showAllBudgetCategories, setShowAllBudgetCategories] = useState(false);
  const [recentVisibleCount, setRecentVisibleCount] = useState(5);

  const filteredExpenses = useMemo(() => {
    if (timeframeMode === "all") return expenses;
    if (timeframeMode === "year") {
      return expenses.filter((e) => e.date.startsWith(`${selectedYear}-`));
    }
    return selectedMonth === ALL_TIME ? expenses : expensesForMonth(selectedMonth);
  }, [ALL_TIME, expenses, expensesForMonth, selectedMonth, timeframeMode, selectedYear]);

  const budgetScaleMonths = useMemo(() => {
    if (timeframeMode === "year") return 12;
    if (timeframeMode === "all") {
      return Math.max(1, new Set(filteredExpenses.map((e) => e.date.slice(0, 7))).size);
    }
    return 1;
  }, [timeframeMode, filteredExpenses]);

  // Ensure recurring templates are instantiated for the viewed month.
  useEffect(() => {
    if (timeframeMode === "month" && selectedMonth !== ALL_TIME) {
      materializeRecurringForMonth(selectedMonth);
    }
  }, [materializeRecurringForMonth, selectedMonth, ALL_TIME, timeframeMode]);
  const expensesOnly = useMemo(
    () => filteredExpenses.filter((e) => e.type === "expense"),
    [filteredExpenses],
  );
  const incomesOnly = useMemo(
    () => filteredExpenses.filter((e) => e.type === "income"),
    [filteredExpenses],
  );

  const { total, rows, pieData } = useMemo(() => {
    let sum = 0;
    const list: Row[] = expenseCategories.map((cat) => {
      const spent = expensesOnly
        .filter((e) => e.categoryId === cat.id)
        .reduce((s, e) => s + convertToILS(e.amount, e.currency, e.date), 0);
      sum += spent;
      const budget = getBudget(cat.id) * budgetScaleMonths;
      const pct = budget > 0 ? (spent / budget) * 100 : 0;
      const over = budget > 0 && spent > budget;
      return {
        categoryId: cat.id,
        name: cat.name,
        iconKey: cat.iconKey,
        color: cat.color,
        spent,
        budget,
        over,
        pct,
      };
    });
    const pie = list
      .filter((r) => r.spent > 0)
      .map((r) => ({
        name: r.name,
        value: r.spent,
        fill: r.color,
        iconKey: r.iconKey,
      }));
    return { total: sum, rows: list, pieData: pie };
  }, [expensesOnly, getBudget, budgets, expenseCategories, fxTick, budgetScaleMonths]);

  const financeSummary = useMemo(() => {
    const income = incomesOnly.reduce(
      (s, e) => s + convertToILS(e.amount, e.currency, e.date),
      0,
    );
    const expense = expensesOnly.reduce(
      (s, e) => s + convertToILS(e.amount, e.currency, e.date),
      0,
    );
    return { income, expense, net: income - expense };
  }, [incomesOnly, expensesOnly, fxTick]);
  const normalizedNet = Math.abs(financeSummary.net) < 0.01 ? 0 : financeSummary.net;
  const netIsZero = Math.abs(normalizedNet) < 0.01;

  const [showAllByCategory, setShowAllByCategory] = useState(false);

  const byCategorySortedBySpend = useMemo(() => {
    return [...rows].sort((a, b) => b.spent - a.spent);
  }, [rows]);

  const expenseCategoryPos = useMemo(() => {
    return new Map(expenseCategories.map((c, i) => [c.id, i] as const));
  }, [expenseCategories]);

  const byCategoryVisible = useMemo(() => {
    const sortByCustomOrder = (a: Row, b: Row) => {
      const ai = expenseCategoryPos.get(a.categoryId);
      const bi = expenseCategoryPos.get(b.categoryId);
      const aRank = ai != null ? ai : Number.POSITIVE_INFINITY;
      const bRank = bi != null ? bi : Number.POSITIVE_INFINITY;
      return aRank - bRank;
    };

    if (showAllByCategory) {
      return [...rows].sort(sortByCustomOrder);
    }

    return byCategorySortedBySpend
      .slice(0, 5)
      .sort(sortByCustomOrder);
  }, [byCategorySortedBySpend, expenseCategoryPos, rows, showAllByCategory]);

  const incomeBreakdown = useMemo(
    () =>
      incomeSources
        .map((src, idx) => {
          const value = incomesOnly
            .filter((i) => i.categoryId === src.id)
            .reduce(
              (s, e) => s + convertToILS(e.amount, e.currency, e.date),
              0,
            );
          return {
            name: src.name,
            iconKey: src.iconKey,
            value,
            fill: INCOME_PIE_COLORS[idx % INCOME_PIE_COLORS.length],
          };
        })
        .filter((x) => x.value > 0),
    [incomesOnly, incomeSources, fxTick],
  );

  const maxSpend = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.spent), 0),
    [rows],
  );

  const budgetRowsSorted = useMemo(
    () => [...rows].sort((a, b) => b.spent - a.spent),
    [rows],
  );
  const budgetRowsVisible = useMemo(() => {
    const sortByCustomOrder = (a: Row, b: Row) => {
      const ai = expenseCategoryPos.get(a.categoryId);
      const bi = expenseCategoryPos.get(b.categoryId);
      const aRank = ai != null ? ai : Number.POSITIVE_INFINITY;
      const bRank = bi != null ? bi : Number.POSITIVE_INFINITY;
      return aRank - bRank;
    };

    if (showAllBudgetCategories) {
      return [...rows].sort(sortByCustomOrder);
    }

    if (budgetRowsSorted.length <= 6) {
      return [...budgetRowsSorted].sort(sortByCustomOrder);
    }

    return budgetRowsSorted.slice(0, 6).sort(sortByCustomOrder);
  }, [budgetRowsSorted, expenseCategoryPos, rows, showAllBudgetCategories]);

  const recentSorted = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.id.localeCompare(a.id);
    });
  }, [filteredExpenses]);

  const recentDisplayed = useMemo(
    () => recentSorted.slice(0, recentVisibleCount),
    [recentSorted, recentVisibleCount],
  );

  const trendData = useMemo(() => {
    return lastNYearMonths(6).map((ym) => ({
      ym,
      label: monthYearShort(ym),
      expense: expenses
        .filter((e) => e.date.startsWith(ym) && e.type === "expense")
        .reduce((s, e) => s + convertToILS(e.amount, e.currency, e.date), 0),
      income: expenses
        .filter((e) => e.date.startsWith(ym) && e.type === "income")
        .reduce((s, e) => s + convertToILS(e.amount, e.currency, e.date), 0),
    }));
  }, [expenses, fxTick]);

  return (
    <div className="flex flex-col gap-4" dir={dir}>
      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <PieChartIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle>{t.dashboardTitle}</CardTitle>
            <CardDescription>{t.dashboardSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="month-filter">{t.monthFilterLabel}</Label>
            <div className="flex flex-wrap gap-2">
              <Select
                value={timeframeMode}
                onValueChange={(v) => setTimeframeMode(v as "month" | "year" | "all")}
              >
                <SelectTrigger className="w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="month" textValue="חודשית">
                    <SelectItemText>חודשית</SelectItemText>
                  </SelectItem>
                  <SelectItem value="year" textValue="שנתית">
                    <SelectItemText>שנתית</SelectItemText>
                  </SelectItem>
                  <SelectItem value="all" textValue={t.exportAllTime}>
                    <SelectItemText>{t.exportAllTime}</SelectItemText>
                  </SelectItem>
                </SelectContent>
              </Select>
              {timeframeMode === "month" ? (
                <MonthYearPicker
                  id="month-filter"
                  value={selectedMonth === ALL_TIME ? "all" : selectedMonth}
                  onChange={(v) => setSelectedMonth(v === "all" ? ALL_TIME : v)}
                  label={t.monthFilterLabel}
                  allTimeLabel={t.exportAllTime}
                  dir={dir}
                />
              ) : null}
              {timeframeMode === "year" ? (
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[8rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {[...new Set(expenses.map((e) => e.date.slice(0, 4)))]
                      .sort((a, b) => b.localeCompare(a))
                      .map((y) => (
                        <SelectItem key={y} value={y} textValue={y}>
                          <SelectItemText>{y}</SelectItemText>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">
              {selectedMonth === ALL_TIME
                ? t.exportAllTime
                : `${t.thisMonthTotal} · ${hebrewMonthYearLabel(selectedMonth)}`}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {formatIls(total)}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <FinanceStat label={t.summaryIncome} value={financeSummary.income} />
            <FinanceStat label={t.summaryExpense} value={financeSummary.expense} />
            <FinanceStat
              label={t.summaryNet}
              value={Math.abs(normalizedNet)}
              positive={!netIsZero && normalizedNet > 0}
              negative={!netIsZero && normalizedNet < 0}
              isZero={netIsZero}
              prefix={normalizedNet === 0 ? "" : normalizedNet > 0 ? "+" : "-"}
            />
          </div>

          <div className="space-y-2" role="group" aria-label={t.chartToggleHint}>
            <p className="text-xs font-medium text-muted-foreground">
              {t.chartToggleHint}
            </p>
            <div className="flex rounded-lg border border-border bg-muted/40 p-1">
              <Button
                type="button"
                variant={chartMode === "bars" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setChartMode("bars")}
                aria-pressed={chartMode === "bars"}
              >
                <BarChart3 className="size-4" />
                {t.chartBars}
              </Button>
              <Button
                type="button"
                variant={chartMode === "pie" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => setChartMode("pie")}
                aria-pressed={chartMode === "pie"}
              >
                <PieChartIcon className="size-4" />
                {t.chartPie}
              </Button>
            </div>
          </div>

          {chartMode === "pie" ? (
            <div className="w-full space-y-4" aria-label={t.chartPie}>
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t.pieEmpty}
                </p>
              ) : (
                <>
                  <div className="w-full" dir="ltr">
                    <div className="mx-auto h-[220px] w-full max-w-[300px] sm:h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={82}
                            paddingAngle={2}
                          >
                            {pieData.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={entry.fill}
                                stroke="transparent"
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => (
                              <SpendTooltip
                                active={active}
                                payload={payload}
                                totalSpend={total}
                                dir={dir}
                                pieTooltipLabel={t.pieTooltipOfTotal}
                              />
                            )}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <ul
                    className="flex flex-wrap justify-center gap-4 px-1"
                    dir={dir}
                    aria-label={t.chartPie}
                  >
                    {pieData.map((d) => (
                      <li
                        key={d.name}
                        className="flex min-w-0 max-w-[min(100%,14rem)] items-center gap-3"
                        dir={dir}
                      >
                        <CategoryGlyph iconKey={d.iconKey} className="size-3.5" />
                        <span
                          className="size-3 shrink-0 rounded-sm ring-1 ring-border/70"
                          style={{ backgroundColor: d.fill }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate text-sm font-medium leading-tight">
                          {d.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t.byCategory}
              </p>
              <ul className="grid grid-cols-2 gap-3">
                {byCategoryVisible.map((r) => (
                  <li key={r.categoryId}>
                    <div
                      className={cn(
                        "rounded-lg border border-border/50 bg-card/60 px-2.5 py-2",
                        r.over && "border-red-500/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
                          <CategoryGlyph
                            iconKey={r.iconKey}
                            className="size-3.5 shrink-0 opacity-80"
                          />
                          <span className="truncate">{r.name}</span>
                          {r.over ? <AlertCircle className="size-3 text-red-500/70" /> : null}
                        </span>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                          {formatIls(r.spent)}
                        </span>
                      </div>
                      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-secondary/90">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${r.budget > 0 ? (maxSpend ? (r.spent / maxSpend) * 100 : 0) : 0}%`,
                            backgroundColor: r.budget > 0 ? r.color : "#9ca3af",
                          }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {byCategorySortedBySpend.length > 5 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setShowAllByCategory((v) => !v)}
                >
                  {showAllByCategory
                    ? t.dashboardRecentShowLess
                    : t.dashboardRecentShowMore}
                </Button>
              ) : null}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.budgetSection}
            </p>
            <ul className="grid grid-cols-2 gap-3" aria-live="polite">
              {budgetRowsVisible.map((r) => {
                const fillWidth =
                  r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : 0;
                const overfill = r.over ? 100 : fillWidth;
                const remaining = Math.max(0, r.budget - r.spent);
                return (
                  <li key={`budget-${r.categoryId}`}>
                    <button
                      type="button"
                      className={cn(
                        "w-full rounded-lg border border-border/50 bg-card/60 px-2.5 py-2 text-start transition-colors",
                        "hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        r.over && "border-red-500/50",
                      )}
                      onClick={() =>
                        onCategoryDrillDown(
                          r.categoryId,
                          selectedMonth === ALL_TIME
                            ? formatYearMonth(new Date())
                            : selectedMonth,
                        )
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                          <CategoryGlyph
                            iconKey={r.iconKey}
                            className="size-3.5 shrink-0 opacity-80"
                          />
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {r.budget > 0 ? (
                            <>
                              {t.remaining} {formatIls(remaining)}
                            </>
                          ) : "לא מוגדר תקציב"}
                        </span>
                      </div>
                      {r.over ? (
                        <p className="mt-0.5 flex items-center gap-0.5 text-[10px] font-medium text-destructive">
                          <AlertCircle className="size-3" aria-hidden />
                          {t.overBudget}
                        </p>
                      ) : null}
                      <div
                        className={cn(
                          "mt-1.5 h-0.5 overflow-hidden rounded-full bg-secondary/90",
                          r.over && "ring-1 ring-red-500/25",
                        )}
                        role="presentation"
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${r.budget > 0 ? overfill : 0}%`,
                            ...(r.over
                              ? overBudgetStripeStyle(r.color)
                              : { backgroundColor: r.budget > 0 ? r.color : "#9ca3af" }),
                          }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {budgetRowsSorted.length > 6 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAllBudgetCategories((v) => !v)}
              >
                {showAllBudgetCategories
                  ? t.dashboardShowLessCategories
                  : t.dashboardShowAllCategories}
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.incomeBreakdown}
            </p>
            <div className="w-full rounded-xl border border-border/60 bg-muted/30 p-2" dir="ltr">
              {incomeBreakdown.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground" dir={dir}>
                  {t.pieEmpty}
                </p>
              ) : (
                <>
                  <div className="w-full" dir="ltr">
                    <div className="mx-auto h-[220px] w-full max-w-[300px] sm:h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={incomeBreakdown}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={82}
                            paddingAngle={2}
                          >
                            {incomeBreakdown.map((entry) => (
                              <Cell
                                key={entry.name}
                                fill={entry.fill}
                                stroke="transparent"
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => (
                              <SpendTooltip
                                active={active}
                                payload={payload}
                                totalSpend={financeSummary.income}
                                dir={dir}
                                pieTooltipLabel={t.pieTooltipOfTotal}
                              />
                            )}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <ul
                    className="flex flex-wrap justify-center gap-4 px-1"
                    dir={dir}
                    aria-label={t.chartPie}
                  >
                    {incomeBreakdown.map((d) => (
                      <li
                        key={d.name}
                        className="flex min-w-0 max-w-[min(100%,14rem)] items-center gap-3"
                        dir={dir}
                      >
                        <CategoryGlyph iconKey={d.iconKey} className="size-3.5" />
                        <span
                          className="size-3 shrink-0 rounded-sm ring-1 ring-border/70"
                          style={{ backgroundColor: d.fill }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate text-sm font-medium leading-tight">
                          {d.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.recentExpenses}
            </p>
            {recentSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.recentEmpty}
              </p>
            ) : (
              <ul className="space-y-2">
                {recentDisplayed.map((e) => {
                  const cats =
                    e.type === "income" ? incomeSources : expenseCategories;
                  const methods =
                    e.type === "income"
                      ? destinationAccounts
                      : paymentMethods;
                  const cat = cats.find((c) => c.id === e.categoryId);
                  const pm = methods.find(
                    (p) => p.id === e.paymentMethodId,
                  );
                  const dateLabel = formatDateDDMMYYYY(e.date);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onEditExpense(e)}
                        className={cn(
                          "flex w-full flex-col gap-1 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-start transition-colors",
                          "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatIls(convertToILS(e.amount, e.currency, e.date))}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {dateLabel}
                          </span>
                        </div>
                        {e.installments > 1 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {t.installmentLabel} {e.installmentIndex} {t.ofLabel} {e.installments}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {e.currency !== "ILS" ? (
                            <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5">
                              {formatCurrencyCompact(e.amount, e.currency, currencies)}
                            </span>
                          ) : null}
                          {cat ? (
                            <span className="flex items-center gap-1.5">
                              <CategoryGlyph iconKey={cat.iconKey} className="size-3.5" />
                              <ColorBadge color={cat.color} />
                              <span>{cat.name}</span>
                            </span>
                          ) : null}
                          {pm ? (
                            <span className="text-muted-foreground/80">
                              · {pm.name}
                            </span>
                          ) : null}
                        </div>
                        {e.note ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {e.note}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {recentSorted.length > 5 ? (
              <div className="flex flex-col gap-1 pt-1">
                {recentVisibleCount < recentSorted.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() =>
                      setRecentVisibleCount((c) =>
                        Math.min(c + 10, recentSorted.length),
                      )
                    }
                  >
                    {t.dashboardRecentShowMore}
                  </Button>
                ) : null}
                {recentVisibleCount > 5 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => setRecentVisibleCount(5)}
                  >
                    {t.dashboardRecentShowLess}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t.trendsTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.trendsSubtitle}
              </p>
            </div>
            <div className="w-full rounded-xl border border-border/60 bg-muted/30 p-2" dir="ltr">
              <div className="h-[200px] w-full sm:h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={trendData}
                    margin={{ top: 8, right: 8, left: 8, bottom: 4 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={44}
                      tickFormatter={(v) =>
                        typeof v === "number" ? v.toLocaleString("he-IL") : String(v)
                      }
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const ym = (payload[0]?.payload as { ym?: YearMonth })?.ym;
                        const income = Number(
                          payload.find((p) => p.dataKey === "income")?.value ?? 0,
                        );
                        const expense = Number(
                          payload.find((p) => p.dataKey === "expense")?.value ?? 0,
                        );
                        return (
                          <div className="flex flex-col gap-2 rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md" dir={dir}>
                            {ym ? <p className="text-xs text-muted-foreground">{hebrewMonthYearLabel(ym)}</p> : null}
                            <div className="inline-flex items-center gap-1 rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1 tabular-nums">
                              <span className="size-2 rounded-full bg-green-500" /> הכנסות: {formatIls(income)}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 tabular-nums">
                              <span className="size-2 rounded-full bg-red-500" /> הוצאות: {formatIls(expense)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="expense"
                      name={t.summaryExpense}
                      fill="#ef4444"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="income"
                      name={t.summaryIncome}
                      fill="#22c55e"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            {t.dashboardFooterNote}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SpendTooltip({
  active,
  payload,
  totalSpend,
  dir,
  pieTooltipLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: unknown; value?: unknown }>;
  totalSpend: number;
  dir: "rtl" | "ltr";
  pieTooltipLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p.name != null ? String(p.name) : "";
  const value = Number(p.value ?? 0);
  const pct = totalSpend > 0 ? Math.round((value / totalSpend) * 100) : 0;
  return (
    <div
      className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      dir={dir}
    >
      <p className="font-semibold">{name}</p>
      <p className="tabular-nums">{formatIls(value)}</p>
      <p className="text-xs text-muted-foreground">
        {pct}% {pieTooltipLabel}
      </p>
    </div>
  );
}

function FinanceStat({
  label,
  value,
  positive = false,
  negative = false,
  isZero = false,
  prefix = "",
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  isZero?: boolean;
  prefix?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          isZero
            ? "text-foreground"
            : positive
              ? "text-green-500"
              : negative
                ? "text-red-500"
                : "text-foreground",
        )}
      >
        {prefix}
        {formatIls(value)}
      </p>
    </div>
  );
}
