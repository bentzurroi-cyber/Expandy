import { useLayoutEffect, useMemo, useState, useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthYearPicker } from "@/components/common/MonthYearPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import type { Expense } from "@/data/mock";
import { convertToILS } from "@/lib/fx";
import {
  formatCurrencyCompact,
  formatDateDDMMYYYY,
  formatIls,
  isShekelCurrency,
} from "@/lib/format";
import { resolveTransactionCategory } from "@/lib/transactionCategoryDisplay";
import {
  localizedDestinationAccountName,
  localizedExpenseCategoryName,
  localizedIncomeSourceName,
  localizedPaymentMethodName,
} from "@/lib/defaultEntityLabels";
import {
  formatYearMonth,
  type YearMonth,
} from "@/lib/month";
import { capReceiptUrls } from "@/lib/receiptConstants";
import { parseProjectedRecurringId } from "@/lib/expenseIds";
import { mergeProjectedRecurringExpenses } from "@/lib/recurringProjection";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FinancialReviewArchivePanel } from "@/components/financialReview/FinancialReviewArchivePanel";

const CATEGORY_ALL = "__all__";
const EXPENSE_CATEGORY_PREFIX = "exp:";
const INCOME_CATEGORY_PREFIX = "inc:";
const METHOD_FILTER_ALL = "__method_all__";
const DEST_FILTER_ALL = "__dest_all__";
const CATEGORY_PREVIEW_LIMIT = 5;

/** Older / partial rows may omit `type` or `receiptUrls`; keep History rendering safe. */
function normalizeHistoryEntryType(e: Pick<Expense, "type"> | null | undefined): "expense" | "income" {
  return e?.type === "income" ? "income" : "expense";
}

function safeHistoryReceiptUrls(e: Expense | null | undefined): string[] {
  const raw = e?.receiptUrls;
  if (!Array.isArray(raw)) return [];
  return capReceiptUrls(raw);
}

function safeHistoryInstallments(e: Expense): { installments: number; installmentIndex: number } {
  const installmentsRaw = e?.installments;
  const idxRaw = e?.installmentIndex;
  const installments =
    typeof installmentsRaw === "number" && Number.isFinite(installmentsRaw)
      ? Math.max(1, Math.floor(installmentsRaw))
      : 1;
  const installmentIndex =
    typeof idxRaw === "number" && Number.isFinite(idxRaw) ? Math.max(1, Math.floor(idxRaw)) : 1;
  return { installments, installmentIndex };
}

export type HistoryPreset = {
  month: YearMonth;
  categoryId: string;
} | null;

type HistoryViewProps = {
  preset: HistoryPreset;
  onPresetConsumed: () => void;
  onEditExpense: (e: Expense) => void;
};

export function HistoryView({
  preset,
  onPresetConsumed,
  onEditExpense,
}: HistoryViewProps) {
  useFxTick();
  const { t, dir, lang } = useI18n();
  const {
    expenses,
    sortExpenses,
    expenseCategories,
    incomeSources,
    paymentMethods,
    destinationAccounts,
    currencies,
    recurringIncomeSkips,
  } = useExpenses();
  const ALL_TIME = "__all_time__" as const;
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | typeof ALL_TIME>(() =>
    formatYearMonth(new Date()),
  );
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [entryTypeFilter, setEntryTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [showAllIncomeCategories, setShowAllIncomeCategories] = useState(false);
  const [showAllExpenseCategories, setShowAllExpenseCategories] = useState(false);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>(METHOD_FILTER_ALL);
  const [destinationFilter, setDestinationFilter] = useState<string>(DEST_FILTER_ALL);
  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState<10 | 20 | 50 | "all">(10);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "amountDesc" | "amountAsc">(
    "newest",
  );
  const [receiptGallery, setReceiptGallery] = useState<{
    urls: string[];
    index: number;
  } | null>(null);
  const receiptSwipeStartX = useRef<number | null>(null);
  const [historyPanel, setHistoryPanel] = useState<"transactions" | "reviews">("transactions");

  useLayoutEffect(() => {
    if (!preset) return;
    setSelectedMonth(preset.month);
    setCategoryFilters([`${EXPENSE_CATEGORY_PREFIX}${preset.categoryId}`]);
    onPresetConsumed();
  }, [preset, onPresetConsumed]);

  useEffect(() => {
    if (
      paymentMethodFilter !== METHOD_FILTER_ALL &&
      !paymentMethods.some((m) => m.id === paymentMethodFilter)
    ) {
      setPaymentMethodFilter(METHOD_FILTER_ALL);
    }
  }, [paymentMethodFilter, paymentMethods]);

  useEffect(() => {
    if (
      destinationFilter !== DEST_FILTER_ALL &&
      !destinationAccounts.some((m) => m.id === destinationFilter)
    ) {
      setDestinationFilter(DEST_FILTER_ALL);
    }
  }, [destinationFilter, destinationAccounts]);

  const categoryFilterSet = useMemo(() => new Set(categoryFilters), [categoryFilters]);
  const incomeCategoryValues = useMemo(
    () => incomeSources.map((c) => `${INCOME_CATEGORY_PREFIX}${c.id}`),
    [incomeSources],
  );
  const expenseCategoryValues = useMemo(
    () => expenseCategories.map((c) => `${EXPENSE_CATEGORY_PREFIX}${c.id}`),
    [expenseCategories],
  );

  const categoryLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeSources) {
      const key = `${INCOME_CATEGORY_PREFIX}${c.id}`;
      map.set(key, localizedIncomeSourceName(c.id, c.name, lang));
    }
    for (const c of expenseCategories) {
      const key = `${EXPENSE_CATEGORY_PREFIX}${c.id}`;
      map.set(key, localizedExpenseCategoryName(c.id, c.name, lang));
    }
    return map;
  }, [expenseCategories, incomeSources, lang]);

  const categoryFilterSummary = useMemo(() => {
    if (categoryFilters.length === 0) return t.allCategories;
    if (categoryFilters.length === 1) {
      return categoryLabelByValue.get(categoryFilters[0]!) ?? t.allCategories;
    }
    return `${categoryFilters.length} ${t.category}`;
  }, [categoryFilters, categoryLabelByValue, t.allCategories, t.category]);

  const toggleCategoryFilter = useMemo(
    () => (value: string) => {
      setCategoryFilters((prev) =>
        prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
      );
    },
    [],
  );

  const toggleAllIncomeCategories = useMemo(
    () => () => {
      setCategoryFilters((prev) => {
        const hasAll = incomeCategoryValues.length > 0 && incomeCategoryValues.every((v) => prev.includes(v));
        if (hasAll) return prev.filter((x) => !incomeCategoryValues.includes(x));
        const next = new Set(prev);
        for (const v of incomeCategoryValues) next.add(v);
        return [...next];
      });
    },
    [incomeCategoryValues],
  );

  const toggleAllExpenseCategories = useMemo(
    () => () => {
      setCategoryFilters((prev) => {
        const hasAll =
          expenseCategoryValues.length > 0 && expenseCategoryValues.every((v) => prev.includes(v));
        if (hasAll) return prev.filter((x) => !expenseCategoryValues.includes(x));
        const next = new Set(prev);
        for (const v of expenseCategoryValues) next.add(v);
        return [...next];
      });
    },
    [expenseCategoryValues],
  );

  const visibleIncomeSources = useMemo(
    () =>
      showAllIncomeCategories
        ? incomeSources
        : incomeSources.slice(0, CATEGORY_PREVIEW_LIMIT),
    [incomeSources, showAllIncomeCategories],
  );
  const visibleExpenseCategories = useMemo(
    () =>
      showAllExpenseCategories
        ? expenseCategories
        : expenseCategories.slice(0, CATEGORY_PREVIEW_LIMIT),
    [expenseCategories, showAllExpenseCategories],
  );

  const projectedExpenses = useMemo(() => {
    const anchor =
      selectedMonth === ALL_TIME ? formatYearMonth(new Date()) : selectedMonth;
    if (selectedMonth === ALL_TIME) {
      return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
        mode: "monthsFromData",
        viewAnchorYm: anchor,
        capHorizonFromAnchor: true,
      });
    }
    return mergeProjectedRecurringExpenses(expenses, recurringIncomeSkips, {
      mode: "explicitMonths",
      months: [selectedMonth],
      viewAnchorYm: anchor,
      capHorizonFromAnchor: false,
    });
  }, [expenses, selectedMonth, ALL_TIME, recurringIncomeSkips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base =
      selectedMonth === ALL_TIME
        ? projectedExpenses
        : projectedExpenses.filter((e) => e.date.startsWith(selectedMonth));
    return base
      .filter(
        (e) =>
          !!e &&
          typeof e.id === "string" &&
          typeof e.date === "string" &&
          typeof e.amount === "number" &&
          Number.isFinite(e.amount),
      )
      .filter((e) => {
        const rowType = normalizeHistoryEntryType(e);
        if (entryTypeFilter !== "all" && rowType !== entryTypeFilter) return false;
        return true;
      })
      .filter((e) => {
        const rowType = normalizeHistoryEntryType(e);
        if (categoryFilterSet.size === 0) return true;
        const key =
          rowType === "income"
            ? `${INCOME_CATEGORY_PREFIX}${e.categoryId}`
            : `${EXPENSE_CATEGORY_PREFIX}${e.categoryId}`;
        return (
          categoryFilterSet.has(CATEGORY_ALL) ||
          categoryFilterSet.has(key)
        );
      })
      .filter((e) => {
        const rowType = normalizeHistoryEntryType(e);
        if (paymentMethodFilter !== METHOD_FILTER_ALL) {
          if (rowType === "expense" && e.paymentMethodId !== paymentMethodFilter) {
            return false;
          }
        }
        if (destinationFilter !== DEST_FILTER_ALL) {
          if (rowType === "income" && e.paymentMethodId !== destinationFilter) {
            return false;
          }
        }
        return true;
      })
      .filter((e) => {
        if (!q) return true;
        try {
          const cat = resolveTransactionCategory(
            e.categoryId,
            normalizeHistoryEntryType(e),
            expenseCategories,
            incomeSources,
          );
          const catName = (cat?.name ?? "").toLowerCase();
          const note = typeof e.note === "string" ? e.note : "";
          return note.toLowerCase().includes(q) || catName.includes(q);
        } catch {
          const note = typeof e?.note === "string" ? e.note : "";
          return note.toLowerCase().includes(q);
        }
      });
  }, [
    ALL_TIME,
    projectedExpenses,
    selectedMonth,
    categoryFilterSet,
    entryTypeFilter,
    search,
    incomeSources,
    expenseCategories,
    paymentMethodFilter,
    destinationFilter,
  ]);

  const sortedFiltered = useMemo(
    () => sortExpenses(filtered, sortBy),
    [filtered, sortBy, sortExpenses],
  );

  const totalPages = useMemo(() => {
    if (rowsPerPage === "all") return 1;
    return Math.max(1, Math.ceil(sortedFiltered.length / rowsPerPage));
  }, [sortedFiltered.length, rowsPerPage]);

  useEffect(() => {
    setPage(0);
  }, [selectedMonth, categoryFilters, entryTypeFilter, paymentMethodFilter, destinationFilter, search]);

  useEffect(() => {
    setPage(0);
  }, [rowsPerPage]);

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  const pagedFiltered = useMemo(() => {
    if (rowsPerPage === "all") return sortedFiltered;
    const start = page * rowsPerPage;
    return sortedFiltered.slice(start, start + rowsPerPage);
  }, [sortedFiltered, page, rowsPerPage]);

  function colorWithAlpha(color: unknown, alphaHex: string): string | null {
    const c = typeof color === "string" ? color.trim() : "";
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return `${c}${alphaHex}`;
    return null;
  }

  return (
    <div className="flex flex-col gap-3" dir={dir}>
      <h1 className="sr-only">{t.historyTitle}</h1>
      <div className="flex gap-1 rounded-2xl border border-border/60 bg-muted/25 p-1">
        <button
          type="button"
          onClick={() => setHistoryPanel("transactions")}
          className={cn(
            "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            historyPanel === "transactions"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.historyTabTransactions}
        </button>
        <button
          type="button"
          onClick={() => setHistoryPanel("reviews")}
          className={cn(
            "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
            historyPanel === "reviews"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.historyTabReviews}
        </button>
      </div>

      {historyPanel === "reviews" ? (
        <FinancialReviewArchivePanel />
      ) : (
        <>
      <div className="-mx-4 border-b border-border/80 bg-gradient-to-b from-muted/25 to-background px-4 py-3">
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {t.historyTitle}
            </h2>
            <span className="text-xs text-muted-foreground">{t.historyToolbarFilters}</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="hist-search" className="text-xs font-medium text-muted-foreground">
                {t.searchNotes}
              </Label>
              <Input
                id="hist-search"
                type="search"
                placeholder={t.searchNotesPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-month" className="text-xs font-medium text-muted-foreground">
                {t.monthFilterLabel}
              </Label>
              <MonthYearPicker
                id="hist-month"
                value={selectedMonth === ALL_TIME ? "all" : selectedMonth}
                onChange={(v) => setSelectedMonth(v === "all" ? ALL_TIME : v)}
                label={t.monthFilterLabel}
                allTimeLabel={t.exportAllTime}
                dir={dir}
                triggerClassName="h-10 w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-type" className="text-xs font-medium text-muted-foreground">
                {t.historyTypeFilterLabel}
              </Label>
              <Select
                value={entryTypeFilter}
                onValueChange={(v) => setEntryTypeFilter(v as "all" | "income" | "expense")}
              >
                <SelectTrigger id="hist-type" className="min-h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all" textValue={t.historyTypeAll}>
                    <SelectItemText>{t.historyTypeAll}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="income" textValue={t.historyTypeIncome}>
                    <SelectItemText>{t.historyTypeIncome}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="expense" textValue={t.historyTypeExpense}>
                    <SelectItemText>{t.historyTypeExpense}</SelectItemText>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-cat" className="text-xs font-medium text-muted-foreground">
                {t.category}
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="hist-cat"
                    type="button"
                    variant="outline"
                    className="min-h-10 w-full justify-between"
                  >
                    <span className="truncate">{categoryFilterSummary}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[22rem] p-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => setCategoryFilters([])}
                  >
                    <span>{t.allCategories}</span>
                    {categoryFilters.length === 0 ? <Check className="size-4" aria-hidden /> : null}
                  </button>
                  <div className="my-2 h-px bg-border/70" />
                  <p className="px-2 py-1 text-xs text-muted-foreground">{t.historyGroupIncome}</p>
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={toggleAllIncomeCategories}
                  >
                    <span>{t.historyTypeIncome}</span>
                    {incomeCategoryValues.length > 0 &&
                    incomeCategoryValues.every((v) => categoryFilterSet.has(v)) ? (
                      <Check className="size-4" aria-hidden />
                    ) : null}
                  </button>
                  {visibleIncomeSources.map((c) => {
                    const value = `${INCOME_CATEGORY_PREFIX}${c.id}`;
                    const label = localizedIncomeSourceName(c.id, c.name, lang);
                    const on = categoryFilterSet.has(value);
                    return (
                      <button
                        key={`inc-${c.id}`}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => toggleCategoryFilter(value)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                          <ColorBadge color={c.color} />
                          <span className="truncate">{label}</span>
                        </span>
                        {on ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                      </button>
                    );
                  })}
                  {incomeSources.length > CATEGORY_PREVIEW_LIMIT ? (
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-accent"
                      onClick={() => setShowAllIncomeCategories((v) => !v)}
                    >
                      {showAllIncomeCategories ? t.iconPickerHide : t.iconPickerShowMore}
                    </button>
                  ) : null}
                  <div className="my-2 h-px bg-border/70" />
                  <p className="px-2 py-1 text-xs text-muted-foreground">{t.historyGroupExpense}</p>
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={toggleAllExpenseCategories}
                  >
                    <span>{t.historyTypeExpense}</span>
                    {expenseCategoryValues.length > 0 &&
                    expenseCategoryValues.every((v) => categoryFilterSet.has(v)) ? (
                      <Check className="size-4" aria-hidden />
                    ) : null}
                  </button>
                  {visibleExpenseCategories.map((c) => {
                    const value = `${EXPENSE_CATEGORY_PREFIX}${c.id}`;
                    const label = localizedExpenseCategoryName(c.id, c.name, lang);
                    const on = categoryFilterSet.has(value);
                    return (
                      <button
                        key={`exp-${c.id}`}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => toggleCategoryFilter(value)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                          <ColorBadge color={c.color} />
                          <span className="truncate">{label}</span>
                        </span>
                        {on ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                      </button>
                    );
                  })}
                  {expenseCategories.length > CATEGORY_PREVIEW_LIMIT ? (
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-accent"
                      onClick={() => setShowAllExpenseCategories((v) => !v)}
                    >
                      {showAllExpenseCategories ? t.iconPickerHide : t.iconPickerShowMore}
                    </button>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-pay" className="text-xs font-medium text-muted-foreground">
                {t.historyFilterPaymentLabel}
              </Label>
              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger id="hist-pay" className="min-h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={METHOD_FILTER_ALL} textValue={t.historyAllPaymentMethods}>
                    <SelectItemText>{t.historyAllPaymentMethods}</SelectItemText>
                  </SelectItem>
                  {paymentMethods.map((m) => {
                    const label = localizedPaymentMethodName(m.id, m.name, lang);
                    return (
                      <SelectItem key={m.id} value={m.id} textValue={label}>
                        <span className="flex items-center gap-2">
                          <CategoryGlyph iconKey={m.iconKey} className="size-3.5" />
                          <ColorBadge color={m.color} />
                          <SelectItemText>{label}</SelectItemText>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-dest" className="text-xs font-medium text-muted-foreground">
                {t.historyFilterDestinationLabel}
              </Label>
              <Select value={destinationFilter} onValueChange={setDestinationFilter}>
                <SelectTrigger id="hist-dest" className="min-h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={DEST_FILTER_ALL} textValue={t.historyAllDestinationAccounts}>
                    <SelectItemText>{t.historyAllDestinationAccounts}</SelectItemText>
                  </SelectItem>
                  {destinationAccounts.map((m) => {
                    const label = localizedDestinationAccountName(m.id, m.name, lang);
                    return (
                      <SelectItem key={m.id} value={m.id} textValue={label}>
                        <span className="flex items-center gap-2">
                          <CategoryGlyph iconKey={m.iconKey} className="size-3.5" />
                          <ColorBadge color={m.color} />
                          <SelectItemText>{label}</SelectItemText>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hist-sort" className="text-xs font-medium text-muted-foreground">
                {t.historySortLabel}
              </Label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger id="hist-sort" className="min-h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="newest" textValue={t.historySortNewest}>
                    <SelectItemText>{t.historySortNewest}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="oldest" textValue={t.historySortOldest}>
                    <SelectItemText>{t.historySortOldest}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="amountDesc" textValue={t.historySortAmountDesc}>
                    <SelectItemText>{t.historySortAmountDesc}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="amountAsc" textValue={t.historySortAmountAsc}>
                    <SelectItemText>{t.historySortAmountAsc}</SelectItemText>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <ul className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-2 px-0 sm:px-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t.historyEmpty}
          </p>
        ) : (
          pagedFiltered.map((e) => {
            const rowType = normalizeHistoryEntryType(e);
            let cat: ReturnType<typeof resolveTransactionCategory> = null;
            try {
              cat = resolveTransactionCategory(
                typeof e.categoryId === "string" ? e.categoryId : "",
                rowType,
                expenseCategories,
                incomeSources,
              );
            } catch {
              cat = null;
            }
            const dateStr = typeof e.date === "string" ? e.date : "";
            const dateLabel = dateStr ? formatDateDDMMYYYY(dateStr) : "—";
            const { installments: instCount, installmentIndex: instIdx } = safeHistoryInstallments(e);
            const isProjectedRecurring = parseProjectedRecurringId(e.id) != null;
            const installmentText =
              rowType === "expense" && instCount > 1 && !isProjectedRecurring
                ? t.historyInstallmentText
                    .replace("{{index}}", String(instIdx))
                    .replace("{{total}}", String(instCount))
                : null;
            const recurringBadge = e.recurringMonthly === true || isProjectedRecurring;
            const receiptUrls = safeHistoryReceiptUrls(e);
            const currencyCode = typeof e.currency === "string" && e.currency.trim() ? e.currency : "ILS";
            const amountSafe =
              typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : 0;
            return (
              <li key={e.id} className="flex w-full items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onEditExpense(e)}
                  className={cn(
                    "min-w-0 flex-1 text-start",
                    "rounded-xl border border-border/70 bg-card shadow-sm transition-colors",
                    "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  dir={dir}
                >
                  <div className="flex min-h-[3.5rem] w-full items-center justify-between px-4 py-4 sm:px-5 sm:py-5">
                    <div className="flex items-center gap-3">
                      {cat ? (
                        <span
                          className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground"
                          style={{
                            backgroundColor:
                              colorWithAlpha(cat.color, "1A") ?? undefined,
                          }}
                        >
                          <span
                            className="absolute start-1.5 top-1.5 size-2 rounded-full bg-muted-foreground/50"
                            style={{
                              backgroundColor:
                                typeof cat.color === "string" && /^#[0-9a-fA-F]{6}$/.test(cat.color)
                                  ? cat.color
                                  : undefined,
                            }}
                            aria-hidden
                          />
                          <CategoryGlyph
                            iconKey={cat.iconKey}
                            className="size-4"
                          />
                        </span>
                      ) : (
                        <span className="size-10 shrink-0 rounded-full bg-muted/70" />
                      )}

                      <div className="flex min-w-0 flex-col items-start text-right">
                        <span className="min-w-0 truncate text-base font-semibold leading-relaxed">
                          {cat
                            ? rowType === "income"
                              ? localizedIncomeSourceName(cat.id, cat.name, lang)
                              : localizedExpenseCategoryName(cat.id, cat.name, lang)
                            : "—"}
                        </span>
                        <span className="truncate text-sm text-muted-foreground">
                          {typeof e.note === "string" && e.note.trim() ? e.note : "—"}
                        </span>
                        {installmentText ? (
                          <span className="truncate text-sm leading-relaxed text-muted-foreground">
                            {installmentText}
                          </span>
                        ) : null}
                        <span
                          className="mt-1 text-sm leading-relaxed tabular-nums text-gray-400"
                          dir="ltr"
                        >
                          {dateLabel}
                        </span>
                        {recurringBadge ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-sm leading-relaxed text-muted-foreground">
                            <RefreshCw className="size-3 shrink-0" aria-hidden />
                            <span>
                              {rowType === "income" ? t.recurringIncome : t.recurringExpense}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end" dir="ltr">
                      <span
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          rowType === "income" ? "text-green-500" : "text-red-500",
                        )}
                      >
                        {rowType === "income" ? "+ " : "- "}
                        {formatIls(convertToILS(amountSafe, currencyCode, dateStr || "1970-01-01"))}
                      </span>
                      {!isShekelCurrency(currencyCode, currencies) ? (
                        <span className="text-sm leading-relaxed tabular-nums text-muted-foreground">
                          {formatCurrencyCompact(amountSafe, currencyCode, currencies)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
                {receiptUrls.length ? (
                  <button
                    type="button"
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground/75 shadow-sm transition-colors",
                      "hover:bg-accent/40 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    aria-label={t.receiptViewAria}
                    onClick={() =>
                      setReceiptGallery({ urls: receiptUrls, index: 0 })
                    }
                  >
                    <ImageIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      <Dialog
        open={receiptGallery != null}
        onOpenChange={(open) => !open && setReceiptGallery(null)}
      >
        <DialogContent className="max-w-[min(100vw-2rem,36rem)] gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-start">
            <DialogTitle className="text-base font-medium">
              {receiptGallery && receiptGallery.urls.length > 1
                ? `${t.receiptDialogTitle} (${receiptGallery.index + 1}/${receiptGallery.urls.length})`
                : t.receiptDialogTitle}
            </DialogTitle>
          </DialogHeader>
          <div
            className="relative flex max-h-[min(75dvh,28rem)] items-center justify-center bg-muted/20 p-4"
            onTouchStart={(e) => {
              receiptSwipeStartX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const start = receiptSwipeStartX.current;
              receiptSwipeStartX.current = null;
              if (start == null || !receiptGallery || receiptGallery.urls.length < 2) return;
              const end = e.changedTouches[0]?.clientX;
              if (end == null) return;
              const dx = end - start;
              if (Math.abs(dx) < 48) return;
              setReceiptGallery((g) => {
                if (!g || g.urls.length < 2) return g;
                if (dx > 0) {
                  const next = (g.index - 1 + g.urls.length) % g.urls.length;
                  return { ...g, index: next };
                }
                const next = (g.index + 1) % g.urls.length;
                return { ...g, index: next };
              });
            }}
          >
            {receiptGallery?.urls[receiptGallery.index] ? (
              <img
                src={receiptGallery.urls[receiptGallery.index]}
                alt=""
                className="max-h-[min(75dvh,28rem)] w-full object-contain"
                draggable={false}
              />
            ) : null}
            {receiptGallery && receiptGallery.urls.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute start-2 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
                  aria-label={t.historyPagePrev}
                  onClick={() =>
                    setReceiptGallery((g) =>
                      g && g.urls.length > 1
                        ? {
                            ...g,
                            index: (g.index - 1 + g.urls.length) % g.urls.length,
                          }
                        : g,
                    )
                  }
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute end-2 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-md"
                  aria-label={t.historyPageNext}
                  onClick={() =>
                    setReceiptGallery((g) =>
                      g && g.urls.length > 1
                        ? { ...g, index: (g.index + 1) % g.urls.length }
                        : g,
                    )
                  }
                >
                  <ChevronRight className="size-5" />
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {filtered.length > 0 ? (
        <footer
          className="sticky bottom-0 z-10 mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
          dir="ltr"
        >
          <div className="flex items-center gap-2">
            <Label htmlFor="hist-rows" className="whitespace-nowrap text-sm leading-relaxed text-muted-foreground">
              {t.historyRowsPerPage}
            </Label>
            <Select
              value={rowsPerPage === "all" ? "all" : String(rowsPerPage)}
              onValueChange={(v) => {
                if (v === "all") setRowsPerPage("all");
                else setRowsPerPage(Number(v) as 10 | 20 | 50);
              }}
            >
              <SelectTrigger id="hist-rows" className="min-h-10 w-[5.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="10" textValue="10">
                  <SelectItemText>10</SelectItemText>
                </SelectItem>
                <SelectItem value="20" textValue="20">
                  <SelectItemText>20</SelectItemText>
                </SelectItem>
                <SelectItem value="50" textValue="50">
                  <SelectItemText>50</SelectItemText>
                </SelectItem>
                <SelectItem value="all" textValue="All">
                  <SelectItemText>{t.exportAllTime}</SelectItemText>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rowsPerPage !== "all" ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                disabled={page <= 0}
                aria-label={t.historyPagePrev}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[5rem] text-center text-sm leading-relaxed tabular-nums text-muted-foreground">
                {t.historyPageOf} {page + 1} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9"
                disabled={page >= totalPages - 1}
                aria-label={t.historyPageNext}
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : (
            <span className="text-sm leading-relaxed tabular-nums text-muted-foreground">
              {filtered.length}
            </span>
          )}
        </footer>
      ) : null}
        </>
      )}
    </div>
  );
}
