import { useCallback, useMemo, useState } from "react";
import {
  BarChart3,
  PieChart as PieChartIcon,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
import { MonthlySurplusInsights } from "@/components/dashboard/MonthlySurplusInsights";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { useBudgets } from "@/context/BudgetContext";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import type { Expense } from "@/data/mock";
import { convertToILS } from "@/lib/fx";
import {
  localizedDestinationAccountName,
  localizedExpenseCategoryName,
  localizedIncomeSourceName,
  localizedPaymentMethodName,
} from "@/lib/defaultEntityLabels";
import { resolveTransactionCategory } from "@/lib/transactionCategoryDisplay";
import {
  formatCurrencyCompact,
  formatDateDDMMYYYY,
  formatIls,
  isShekelCurrency,
} from "@/lib/format";
import {
  formatYearMonth,
  hebrewMonthYearLabel,
  lastNYearMonths,
  monthYearShort,
  type YearMonth,
} from "@/lib/month";
import { parseProjectedRecurringId } from "@/lib/expenseIds";
import { mergeProjectedRecurringExpenses } from "@/lib/recurringProjection";
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

const CATEGORY_GRID_INITIAL = 4;

const INCOME_PIE_COLORS = [
  "#22c55e", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#f97316", // orange
  "#eab308", // yellow
  "#a855f7", // purple
  "#ef4444", // red
] as const;

/** Bar fills — aligned with legend pills; a step brighter than the first muted pass. */
const TREND_BAR_FILL = {
  expense: "#d85555",
  income: "#1faa59",
} as const;

export type DashboardViewProps = {
  onEditExpense: (e: Expense) => void;
  onCategoryDrillDown: (categoryId: string, month: YearMonth) => void;
};

export function DashboardView({
  onEditExpense,
  onCategoryDrillDown,
}: DashboardViewProps) {
  const fxTick = useFxTick();
  const { t, dir, lang } = useI18n();
  const { getBudget, getMonthlyBudgetTotal, budgets } = useBudgets();
  const {
    expenses,
    recurringIncomeSkips,
    expenseCategories,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    currencies,
  } = useExpenses();
  const [chartMode, setChartMode] = useState<ChartMode>("pie");
  const ALL_TIME = "__all_time__" as const;
  const [timeframeMode, setTimeframeMode] = useState<"month" | "year" | "all">("month");
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | typeof ALL_TIME>(() =>
    formatYearMonth(new Date()),
  );
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()));
  const [showAllCategoryGrids, setShowAllCategoryGrids] = useState(false);
  const [recentVisibleCount, setRecentVisibleCount] = useState(5);
  const budgetMonthForView: YearMonth = useMemo(
    () =>
      timeframeMode === "month" && selectedMonth !== ALL_TIME
        ? (selectedMonth as YearMonth)
        : formatYearMonth(new Date()),
    [ALL_TIME, selectedMonth, timeframeMode],
  );

  const toggleCategoryGridExpanded = useCallback(() => {
    const y = window.scrollY;
    setShowAllCategoryGrids((v) => !v);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    });
  }, []);

  /** Same recurring projection as History — synchronous, no useEffect race. */
  const expensesIncludingProjectedRecurring = useMemo(() => {
    if (timeframeMode === "year") {
      const months = Array.from(
        { length: 12 },
        (_, i) => `${selectedYear}-${String(i + 1).padStart(2, "0")}`,
      );
      return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
        mode: "explicitMonths",
        months,
        viewAnchorYm: `${selectedYear}-01`,
        capHorizonFromAnchor: false,
      });
    }
    if (timeframeMode === "all") {
      return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
        mode: "monthsFromData",
        viewAnchorYm: formatYearMonth(new Date()),
        capHorizonFromAnchor: true,
      });
    }
    if (selectedMonth === ALL_TIME) {
      return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
        mode: "monthsFromData",
        viewAnchorYm: formatYearMonth(new Date()),
        capHorizonFromAnchor: true,
      });
    }
    return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
      mode: "explicitMonths",
      months: [selectedMonth],
      viewAnchorYm: selectedMonth,
      capHorizonFromAnchor: false,
    });
  }, [
    ALL_TIME,
    expenses,
    recurringIncomeSkips,
    selectedMonth,
    selectedYear,
    timeframeMode,
  ]);

  const filteredExpenses = useMemo(() => {
    if (timeframeMode === "all") return expensesIncludingProjectedRecurring;
    if (timeframeMode === "year") {
      return expensesIncludingProjectedRecurring.filter((e) =>
        e.date.startsWith(`${selectedYear}-`),
      );
    }
    return selectedMonth === ALL_TIME
      ? expensesIncludingProjectedRecurring
      : expensesIncludingProjectedRecurring.filter((e) =>
          e.date.startsWith(selectedMonth),
        );
  }, [
    ALL_TIME,
    expensesIncludingProjectedRecurring,
    selectedMonth,
    selectedYear,
    timeframeMode,
  ]);

  const budgetScaleMonths = useMemo(() => {
    if (timeframeMode === "year") return 12;
    if (timeframeMode === "all") {
      return Math.max(1, new Set(filteredExpenses.map((e) => e.date.slice(0, 7))).size);
    }
    return 1;
  }, [timeframeMode, filteredExpenses]);
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
      const budget = getBudget(cat.id, budgetMonthForView) * budgetScaleMonths;
      const pct = budget > 0 ? (spent / budget) * 100 : 0;
      const over = budget > 0 && spent > budget;
      return {
        categoryId: cat.id,
        name: localizedExpenseCategoryName(cat.id, cat.name, lang),
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
  }, [expensesOnly, getBudget, budgets, expenseCategories, fxTick, budgetScaleMonths, lang, budgetMonthForView]);

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
  const storedMonthlyTotalCap =
    getMonthlyBudgetTotal(budgetMonthForView) * budgetScaleMonths;
  const summedCategoryBudgetCaps = useMemo(
    () =>
      expenseCategories.reduce(
        (sum, cat) => sum + getBudget(cat.id, budgetMonthForView),
        0,
      ) * budgetScaleMonths,
    [
      expenseCategories,
      getBudget,
      budgetMonthForView,
      budgetScaleMonths,
      budgets,
    ],
  );
  /** תקציב כולל מפורש מההגדרות, או — אם לא הוגדר — סכום תקציבי הקטגוריות */
  const effectiveMonthlyBudgetTotal =
    storedMonthlyTotalCap > 0 ? storedMonthlyTotalCap : summedCategoryBudgetCaps;
  const monthlyBudgetRemaining = Math.max(
    0,
    effectiveMonthlyBudgetTotal - financeSummary.expense,
  );
  const monthlyBudgetOver =
    effectiveMonthlyBudgetTotal > 0 &&
    financeSummary.expense > effectiveMonthlyBudgetTotal;

  /** Same order as Entry / Settings: `rows` follows `expenseCategories` from context. */
  const categoryGridRowsVisible = useMemo(
    () =>
      showAllCategoryGrids
        ? rows
        : rows.slice(0, CATEGORY_GRID_INITIAL),
    [rows, showAllCategoryGrids],
  );

  const incomeBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of incomesOnly) {
      totals.set(
        e.categoryId,
        (totals.get(e.categoryId) ?? 0) +
          convertToILS(e.amount, e.currency, e.date),
      );
    }
    const seen = new Set<string>();
    const rows: Array<{
      categoryId: string;
      name: string;
      iconKey: string;
      value: number;
      fill: string;
    }> = [];
    let colorIdx = 0;
    for (const src of incomeSources) {
      const value = totals.get(src.id) ?? 0;
      if (value <= 0) continue;
      seen.add(src.id);
      rows.push({
        categoryId: src.id,
        name: src.name,
        iconKey: src.iconKey,
        value,
        fill: INCOME_PIE_COLORS[colorIdx++ % INCOME_PIE_COLORS.length],
      });
    }
    for (const [catId, value] of totals) {
      if (value <= 0 || seen.has(catId)) continue;
      const cat = resolveTransactionCategory(
        catId,
        "income",
        expenseCategories,
        incomeSources,
      );
      rows.push({
        categoryId: catId,
        name: localizedIncomeSourceName(catId, cat?.name ?? catId, lang),
        iconKey: cat?.iconKey ?? "tag",
        value,
        fill: INCOME_PIE_COLORS[colorIdx++ % INCOME_PIE_COLORS.length],
      });
    }
    return rows;
  }, [incomesOnly, incomeSources, expenseCategories, fxTick, lang]);

  const maxSpend = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.spent), 0),
    [rows],
  );

  const expenseBarChartData = useMemo(() => {
    const positive = [...rows]
      .filter((r) => r.spent > 0)
      .sort((a, b) => b.spent - a.spent);
    const maxBars = 14;
    if (positive.length <= maxBars) {
      return positive.map((r) => ({
        name: r.name,
        spent: r.spent,
        fill: r.color,
      }));
    }
    const top = positive.slice(0, maxBars);
    const rest = positive.slice(maxBars);
    const otherSum = rest.reduce((s, r) => s + r.spent, 0);
    const otherLabel = lang === "he" ? "אחר" : "Other";
    return [
      ...top.map((r) => ({
        name: r.name,
        spent: r.spent,
        fill: r.color,
      })),
      { name: otherLabel, spent: otherSum, fill: "#71717a" },
    ];
  }, [rows, lang]);

  const expenseBarChartHeight = Math.min(
    400,
    Math.max(160, expenseBarChartData.length * 26 + 44),
  );

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
    const trendMonths = lastNYearMonths(6);
    const withProjected = mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
      mode: "explicitMonths",
      months: trendMonths,
      viewAnchorYm: formatYearMonth(new Date()),
      capHorizonFromAnchor: false,
    });
    return trendMonths.map((ym) => ({
      ym,
      label: monthYearShort(ym),
      expense: withProjected
        .filter((e) => e.date.startsWith(ym) && e.type === "expense")
        .reduce((s, e) => s + convertToILS(e.amount, e.currency, e.date), 0),
      income: withProjected
        .filter((e) => e.date.startsWith(ym) && e.type === "income")
        .reduce((s, e) => s + convertToILS(e.amount, e.currency, e.date), 0),
    }));
  }, [expenses, recurringIncomeSkips, fxTick]);

  return (
    <div className="flex flex-col gap-4" dir={dir}>
      <MonthlySurplusInsights />
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
            <div className="flex flex-row flex-nowrap items-center gap-2 overflow-x-auto">
              <Select
                value={timeframeMode}
                onValueChange={(v) => setTimeframeMode(v as "month" | "year" | "all")}
              >
                <SelectTrigger className="min-h-11 w-[10rem] shrink-0">
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
                  triggerClassName="w-auto min-w-[9.5rem] max-w-[12.5rem] shrink-0"
                />
              ) : null}
              {timeframeMode === "year" ? (
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="min-h-11 w-[8rem] shrink-0">
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
          <div
            className={cn(
              "rounded-lg border px-3 py-2",
              monthlyBudgetOver
                ? "border-red-500/35 bg-red-500/5"
                : effectiveMonthlyBudgetTotal > 0
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border/70 bg-card/20",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {lang === "he" ? "תקציב חודשי כולל" : "Monthly total budget"}
              </p>
              <span
                className={cn(
                  "size-2 rounded-full",
                  effectiveMonthlyBudgetTotal <= 0
                    ? "bg-muted-foreground/50"
                    : monthlyBudgetOver
                      ? "bg-red-500"
                      : "bg-emerald-500",
                )}
                aria-hidden
              />
            </div>
            {effectiveMonthlyBudgetTotal > 0 ? (
              <>
                <p
                  className={cn(
                    "text-sm font-medium tabular-nums leading-relaxed",
                    monthlyBudgetOver ? "text-red-400" : "text-emerald-400",
                  )}
                >
                  {monthlyBudgetOver
                    ? lang === "he"
                      ? `אין יתרה • חריגה ${formatIls(financeSummary.expense - effectiveMonthlyBudgetTotal)}`
                      : `No remaining • over ${formatIls(financeSummary.expense - effectiveMonthlyBudgetTotal)}`
                    : lang === "he"
                      ? `נותר ${formatIls(monthlyBudgetRemaining)}`
                      : `${formatIls(monthlyBudgetRemaining)} remaining`}
                </p>
                <p
                  className={cn(
                    "w-full text-xs tabular-nums leading-relaxed text-muted-foreground",
                    dir === "rtl" ? "text-right" : "text-left",
                  )}
                  dir="ltr"
                >
                  {formatIls(financeSummary.expense)} /{" "}
                  {formatIls(effectiveMonthlyBudgetTotal)}
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {lang === "he" ? "לא הוגדר תקציב חודשי כולל" : "No monthly total budget set"}
              </p>
            )}
          </div>

          <div className="space-y-2" role="group" aria-label={t.chartToggleHint}>
            <p className="text-sm font-medium leading-relaxed text-muted-foreground">
              {t.chartToggleHint}
            </p>
            <div className="flex rounded-lg border border-border bg-muted/40 p-1">
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
            </div>
          </div>

          {chartMode === "pie" ? (
            <div className="w-full space-y-4" aria-label={t.chartPie}>
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-base leading-relaxed text-muted-foreground">
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
                  <PieBreakdownLegend
                    items={pieData.map((d) => ({
                      key: d.name,
                      name: d.name,
                      fill: d.fill,
                      iconKey: d.iconKey,
                    }))}
                    dir={dir}
                    ariaLabel={t.chartPie}
                    showMoreLabel={t.dashboardRecentShowMore}
                    showLessLabel={t.dashboardRecentShowLess}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2" aria-label={t.chartBars}>
              <p className="text-sm font-medium uppercase tracking-wider leading-relaxed text-muted-foreground">
                {t.byCategory}
              </p>
              {expenseBarChartData.length === 0 ? (
                <p className="py-8 text-center text-base leading-relaxed text-muted-foreground">
                  {t.pieEmpty}
                </p>
              ) : (
                <div
                  className="w-full rounded-xl border border-border/60 bg-muted/30 p-2"
                  dir="ltr"
                >
                  <div
                    className="w-full"
                    style={{ height: expenseBarChartHeight }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={expenseBarChartData}
                        layout="vertical"
                        margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                      >
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) =>
                            formatIls(typeof v === "number" ? v : Number(v))
                          }
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={108}
                          reversed
                          tick={{ fontSize: 11 }}
                          interval={0}
                          tickFormatter={(v) => {
                            const s = String(v);
                            return s.length > 16 ? `${s.slice(0, 14)}…` : s;
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted) / 0.22)" }}
                          content={(tooltipProps) => (
                            <ExpenseBarsTooltip
                              active={tooltipProps.active}
                              payload={tooltipProps.payload}
                              label={tooltipProps.label}
                              dir={dir}
                              spentLabel={t.spent}
                            />
                          )}
                        />
                        <Bar dataKey="spent" radius={[0, 5, 5, 0]} maxBarSize={18}>
                          {expenseBarChartData.map((e) => (
                            <Cell key={e.name} fill={e.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wider leading-relaxed text-muted-foreground">
              {t.budgetSection}
            </p>
            <ul
              className="grid grid-cols-2 gap-3 items-stretch"
              aria-live="polite"
            >
              {categoryGridRowsVisible.map((r) => {
                const fillWidth =
                  r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : 0;
                const overfill = r.over ? 100 : fillWidth;
                const remaining = Math.max(0, r.budget - r.spent);
                const noBudgetBarPct =
                  r.budget <= 0 && maxSpend > 0 && r.spent > 0
                    ? Math.max(5, Math.min(100, (r.spent / maxSpend) * 100))
                    : 0;
                const barWidthPct = r.budget > 0 ? overfill : noBudgetBarPct;
                const overBy = r.over
                  ? Math.max(0, r.spent - r.budget)
                  : 0;
                return (
                  <li
                    key={`budget-${r.categoryId}`}
                    className="flex min-h-0 min-w-0"
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-lg border border-border/50 bg-card/60 px-2.5 py-2 text-center transition-colors",
                        "hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        r.over && "border-red-500/35",
                      )}
                      dir={dir}
                      onClick={() =>
                        onCategoryDrillDown(
                          r.categoryId,
                          selectedMonth === ALL_TIME
                            ? formatYearMonth(new Date())
                            : selectedMonth,
                        )
                      }
                    >
                      <div className="flex shrink-0 items-center justify-center gap-1.5">
                        <CategoryGlyph
                          iconKey={r.iconKey}
                          className="size-3.5 shrink-0 opacity-80"
                        />
                        <span className="min-w-0 truncate text-sm font-medium leading-snug">
                          {r.name}
                        </span>
                      </div>
                      <div className="flex flex-col justify-center gap-0.5">
                        {r.budget > 0 ? (
                          <>
                            <p className="text-base font-semibold tabular-nums leading-tight text-foreground">
                              {formatIls(r.spent)}
                            </p>
                            <p className="text-xs tabular-nums leading-relaxed text-muted-foreground">
                              {t.remaining} {formatIls(remaining)}
                              <span className="text-muted-foreground/80">
                                {" "}
                                · {t.budget} {formatIls(r.budget)}
                              </span>
                            </p>
                            {r.over ? (
                              <p className="text-[0.7rem] font-medium leading-snug text-red-500">
                                {t.budgetOverBy.replace(
                                  "{{amount}}",
                                  formatIls(overBy),
                                )}
                              </p>
                            ) : null}
                          </>
                        ) : r.spent > 0 ? (
                          <>
                            <p className="text-base font-semibold tabular-nums leading-tight text-foreground">
                              {formatIls(r.spent)}
                            </p>
                            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                              {t.noCategoryBudgetHint}
                            </p>
                            <p className="text-[0.65rem] leading-relaxed text-muted-foreground/70">
                              {t.spendShareOfTopCategory}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t.noCategoryBudgetHint}
                          </p>
                        )}
                      </div>
                      <div
                        className="mt-0.5 h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-secondary/90"
                        role="presentation"
                      >
                        <div
                          className="h-full rounded-full transition-[width] duration-700 ease-out"
                          style={{
                            width: `${barWidthPct}%`,
                            backgroundColor: r.over
                              ? "rgb(220 38 38)"
                              : r.budget > 0 || r.spent > 0
                                ? r.color
                                : "rgb(156 163 175 / 0.45)",
                          }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {rows.length > CATEGORY_GRID_INITIAL ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-sm leading-relaxed text-muted-foreground"
                onClick={toggleCategoryGridExpanded}
              >
                {showAllCategoryGrids
                  ? t.dashboardRecentShowLess
                  : t.dashboardRecentShowMore}
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-wider leading-relaxed text-muted-foreground">
              {t.incomeBreakdown}
            </p>
            <div className="w-full rounded-xl border border-border/60 bg-muted/30 p-2" dir="ltr">
              {incomeBreakdown.length === 0 ? (
                <p className="py-8 text-center text-base leading-relaxed text-muted-foreground" dir={dir}>
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
                                key={entry.categoryId}
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
                  <PieBreakdownLegend
                    items={incomeBreakdown.map((d) => ({
                      key: d.categoryId,
                      name: d.name,
                      fill: d.fill,
                      iconKey: d.iconKey,
                    }))}
                    dir={dir}
                    ariaLabel={t.incomeBreakdown}
                    showMoreLabel={t.dashboardRecentShowMore}
                    showLessLabel={t.dashboardRecentShowLess}
                  />
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wider leading-relaxed text-muted-foreground">
              {t.recentExpenses}
            </p>
            {recentSorted.length === 0 ? (
              <p className="text-base leading-relaxed text-muted-foreground">
                {t.recentEmpty}
              </p>
            ) : (
              <ul className="space-y-2">
                {recentDisplayed.map((e) => {
                  const methods =
                    e.type === "income"
                      ? destinationAccounts
                      : paymentMethods;
                  const cat = resolveTransactionCategory(
                    e.categoryId,
                    e.type,
                    expenseCategories,
                    incomeSources,
                  );
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
                          <span className="text-base font-semibold tabular-nums leading-relaxed">
                            {formatIls(convertToILS(e.amount, e.currency, e.date))}
                          </span>
                          <span className="text-sm leading-relaxed text-muted-foreground">
                            {dateLabel}
                          </span>
                        </div>
                        {e.installments > 1 && parseProjectedRecurringId(e.id) == null ? (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {t.installmentLabel} {e.installmentIndex} {t.ofLabel} {e.installments}
                          </p>
                        ) : null}
                        {e.recurringMonthly === true || parseProjectedRecurringId(e.id) != null ? (
                          <p className="flex items-center gap-1 text-sm leading-relaxed text-muted-foreground">
                            <RefreshCw className="size-3 shrink-0" aria-hidden />
                            <span>
                              {e.type === "income" ? t.recurringIncome : t.recurringExpense}
                            </span>
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 text-base leading-relaxed text-muted-foreground">
                          {!isShekelCurrency(e.currency, currencies) ? (
                            <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5">
                              {formatCurrencyCompact(e.amount, e.currency, currencies)}
                            </span>
                          ) : null}
                          {cat ? (
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              <CategoryGlyph iconKey={cat.iconKey} className="size-3.5" />
                              <ColorBadge color={cat.color} />
                              <span className="leading-relaxed">
                                {e.type === "income"
                                  ? localizedIncomeSourceName(cat.id, cat.name, lang)
                                  : localizedExpenseCategoryName(cat.id, cat.name, lang)}
                              </span>
                            </span>
                          ) : null}
                          {pm ? (
                            <span className="text-muted-foreground/80">
                              ·{" "}
                              {e.type === "income"
                                ? localizedDestinationAccountName(pm.id, pm.name, lang)
                                : localizedPaymentMethodName(pm.id, pm.name, lang)}
                            </span>
                          ) : null}
                        </div>
                        {e.note ? (
                          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
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
                    className="w-full text-sm leading-relaxed text-muted-foreground"
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
                    className="w-full text-sm leading-relaxed text-muted-foreground"
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
              <p className="text-sm font-medium uppercase tracking-wider leading-relaxed text-muted-foreground">
                {t.trendsTitle}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
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
                          <div className="flex flex-col gap-2 rounded-md border border-border bg-popover px-3 py-2 text-base leading-relaxed shadow-md" dir={dir}>
                            {ym ? <p className="text-sm leading-relaxed text-muted-foreground">{hebrewMonthYearLabel(ym)}</p> : null}
                            <div className="inline-flex items-center gap-1 rounded-md border border-emerald-700/45 bg-emerald-800/[0.18] px-2 py-1 tabular-nums text-foreground">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: TREND_BAR_FILL.income }}
                              />
                              הכנסות: {formatIls(income)}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-md border border-red-800/45 bg-red-950/[0.22] px-2 py-1 tabular-nums text-foreground">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: TREND_BAR_FILL.expense }}
                              />
                              הוצאות: {formatIls(expense)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ paddingTop: 4 }}
                      content={(legendProps) => (
                        <TrendBarChartLegend payload={legendProps.payload} dir={dir} />
                      )}
                    />
                    <Bar
                      dataKey="expense"
                      name={t.summaryExpense}
                      fill={TREND_BAR_FILL.expense}
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="income"
                      name={t.summaryIncome}
                      fill={TREND_BAR_FILL.income}
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const PIE_LEGEND_INITIAL = 8;

type PieBreakdownLegendItem = {
  key: string;
  name: string;
  fill: string;
  iconKey: string;
};

function PieBreakdownLegend({
  items,
  dir,
  ariaLabel,
  showMoreLabel,
  showLessLabel,
}: {
  items: PieBreakdownLegendItem[];
  dir: "rtl" | "ltr";
  ariaLabel: string;
  showMoreLabel: string;
  showLessLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = items.length > PIE_LEGEND_INITIAL;
  const visible =
    expanded || !needsToggle
      ? items
      : items.slice(0, PIE_LEGEND_INITIAL);
  return (
    <div className="space-y-2 px-1" dir={dir}>
      <ul
        className="mx-auto grid w-full max-w-lg grid-cols-2 gap-2"
        aria-label={ariaLabel}
      >
        {visible.map((d) => (
          <li
            key={d.key}
            className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
          >
            <div
              className="grid w-full grid-cols-[1.25rem_0.625rem_minmax(0,1fr)] items-center gap-2.5"
              dir={dir}
            >
              <CategoryGlyph
                iconKey={d.iconKey}
                className="size-3.5 shrink-0 justify-self-center text-muted-foreground"
              />
              <span
                className="size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
                style={{ backgroundColor: d.fill }}
                aria-hidden
              />
              <span className="min-w-0 break-words text-sm font-medium leading-snug">
                {d.name}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {needsToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-sm leading-relaxed text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? showLessLabel : showMoreLabel}
        </Button>
      ) : null}
    </div>
  );
}

function TrendBarChartLegend({
  payload,
  dir,
}: {
  payload?: ReadonlyArray<{
    value?: string;
    dataKey?: unknown;
    color?: string;
  }>;
  dir: "rtl" | "ltr";
}) {
  if (!payload?.length) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2 px-1 pt-1 sm:gap-3"
      dir={dir}
    >
      {payload.map((entry, index) => {
        const dk = entry.dataKey;
        const key =
          dk === "income" || dk === "expense"
            ? dk
            : typeof dk === "string" || typeof dk === "number"
              ? String(dk)
              : "";
        const isIncome = key === "income";
        const Icon = isIncome ? TrendingUp : TrendingDown;
        return (
          <div
            key={key || `legend-${index}`}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium leading-snug shadow-sm sm:text-sm",
              isIncome
                ? "border-emerald-500/45 bg-emerald-500/[0.11] text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-500/18 dark:text-emerald-100"
                : "border-red-500/45 bg-red-500/[0.11] text-red-800 dark:border-red-400/40 dark:bg-red-500/18 dark:text-red-100",
            )}
          >
            <Icon className="size-3.5 shrink-0 opacity-95 sm:size-4" aria-hidden />
            <span>{entry.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExpenseBarsTooltip({
  active,
  payload,
  label,
  dir,
  spentLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: unknown; name?: unknown }>;
  label?: unknown;
  dir: "rtl" | "ltr";
  spentLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0]?.value ?? 0);
  const name =
    label != null && String(label).length > 0
      ? String(label)
      : payload[0]?.name != null
        ? String(payload[0].name)
        : "";
  return (
    <div
      className="pointer-events-none z-50 max-w-[16rem] rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-md"
      dir={dir}
    >
      {name ? (
        <p className="text-sm font-semibold leading-snug text-foreground">{name}</p>
      ) : null}
      <p
        className={cn(
          "tabular-nums text-sm leading-relaxed text-foreground",
          name ? "mt-1" : "",
        )}
      >
        <span className="text-muted-foreground">{spentLabel}: </span>
        {formatIls(v)}
      </p>
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
      className="rounded-md border border-border bg-popover px-3 py-2 text-base leading-relaxed text-popover-foreground shadow-md"
      dir={dir}
    >
      <p className="font-semibold">{name}</p>
      <p className="tabular-nums">{formatIls(value)}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
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
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
      <p className="text-sm leading-relaxed text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums leading-relaxed",
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
