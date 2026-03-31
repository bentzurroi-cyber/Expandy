import { useLayoutEffect, useMemo, useState, useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthYearPicker } from "@/components/common/MonthYearPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import type { Expense } from "@/data/mock";
import { convertToILS } from "@/lib/fx";
import { formatCurrencyCompact, formatDateDDMMYYYY, formatIls } from "@/lib/format";
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
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CATEGORY_ALL = "__all__";
const EXPENSE_CATEGORY_PREFIX = "exp:";
const INCOME_CATEGORY_PREFIX = "inc:";
const METHOD_FILTER_ALL = "__method_all__";
const DEST_FILTER_ALL = "__dest_all__";

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

function clampDayForMonth(year: number, month1to12: number, day: number): number {
  const last = new Date(year, month1to12, 0).getDate();
  return Math.max(1, Math.min(last, day));
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
    updateExpense,
  } = useExpenses();
  const ALL_TIME = "__all_time__" as const;
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | typeof ALL_TIME>(() =>
    formatYearMonth(new Date()),
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_ALL);
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

  useLayoutEffect(() => {
    if (!preset) return;
    setSelectedMonth(preset.month);
    setCategoryFilter(`${EXPENSE_CATEGORY_PREFIX}${preset.categoryId}`);
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

  const projectedExpenses = useMemo(() => {
    const valid = expenses.filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.date === "string" &&
        typeof e.categoryId === "string" &&
        typeof e.paymentMethodId === "string" &&
        typeof e.amount === "number" &&
        Number.isFinite(e.amount),
    );
    const out = [...valid];
    const ids = new Set(out.map((e) => e.id));
    const templates = valid.filter((e) => e.recurringMonthly === true);
    const baseViewYm = selectedMonth === ALL_TIME ? formatYearMonth(new Date()) : selectedMonth;
    const [vy, vm] = baseViewYm.split("-").map(Number);
    const viewDate = new Date(vy, vm - 1, 1);
    const targetYms =
      selectedMonth === ALL_TIME
        ? [...new Set(valid.map((e) => e.date.slice(0, 7)))]
        : [selectedMonth];

    for (const tmpl of templates) {
      const baseYm = tmpl.date.slice(0, 7);
      const [by, bm] = baseYm.split("-").map(Number);
      if (!Number.isFinite(by) || !Number.isFinite(bm)) continue;
      const baseDate = new Date(by, bm - 1, 1);
      for (const ym of targetYms) {
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const [ty, tm] = ym.split("-").map(Number);
        const targetDate = new Date(ty, tm - 1, 1);
        const monthsFromBase =
          (targetDate.getFullYear() - baseDate.getFullYear()) * 12 +
          (targetDate.getMonth() - baseDate.getMonth());
        const monthsFromView =
          (targetDate.getFullYear() - viewDate.getFullYear()) * 12 +
          (targetDate.getMonth() - viewDate.getMonth());
        if (monthsFromBase < 0) continue;
        if (monthsFromView > 12) continue; // cap projection horizon
        const id = `${tmpl.id}-installment-${monthsFromBase + 1}`;
        if (ids.has(id)) continue;
        const srcDay = Number(tmpl.date.slice(8, 10)) || 1;
        const safeDay = clampDayForMonth(ty, tm, srcDay);
        const tmplInst = safeHistoryInstallments(tmpl);
        out.push({
          ...tmpl,
          id,
          date: `${ym}-${String(safeDay).padStart(2, "0")}`,
          recurringMonthly: false,
          installments: Math.max(1, tmplInst.installments),
          installmentIndex: Math.max(1, monthsFromBase + 1),
          note:
            (typeof tmpl.note === "string" ? tmpl.note.trim() : "") ||
            `תשלום ${Math.max(1, monthsFromBase + 1)} מתוך ${Math.max(1, tmplInst.installments)}`,
        });
        ids.add(id);
      }
    }
    return out;
  }, [expenses, selectedMonth, ALL_TIME]);

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
        return (
          categoryFilter === CATEGORY_ALL ||
          (categoryFilter.startsWith(EXPENSE_CATEGORY_PREFIX) &&
            rowType === "expense" &&
            e.categoryId === categoryFilter.slice(EXPENSE_CATEGORY_PREFIX.length)) ||
          (categoryFilter.startsWith(INCOME_CATEGORY_PREFIX) &&
            rowType === "income" &&
            e.categoryId === categoryFilter.slice(INCOME_CATEGORY_PREFIX.length))
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
    categoryFilter,
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
  }, [selectedMonth, categoryFilter, paymentMethodFilter, destinationFilter, search]);

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
              <Label htmlFor="hist-cat" className="text-xs font-medium text-muted-foreground">
                {t.category}
              </Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="hist-cat" className="min-h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={CATEGORY_ALL} textValue={t.allCategories}>
                    <SelectItemText>{t.allCategories}</SelectItemText>
                  </SelectItem>
                  <SelectGroup>
                    <SelectLabel>{t.historyGroupIncome}</SelectLabel>
                    {incomeSources.map((c) => {
                      const label = localizedIncomeSourceName(c.id, c.name, lang);
                      return (
                        <SelectItem
                          key={`inc-${c.id}`}
                          value={`${INCOME_CATEGORY_PREFIX}${c.id}`}
                          textValue={label}
                        >
                          <span className="flex items-center gap-2">
                            <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                            <ColorBadge color={c.color} />
                            <SelectItemText>{label}</SelectItemText>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t.historyGroupExpense}</SelectLabel>
                    {expenseCategories.map((c) => {
                      const label = localizedExpenseCategoryName(c.id, c.name, lang);
                      return (
                        <SelectItem
                          key={`exp-${c.id}`}
                          value={`${EXPENSE_CATEGORY_PREFIX}${c.id}`}
                          textValue={label}
                        >
                          <span className="flex items-center gap-2">
                            <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                            <ColorBadge color={c.color} />
                            <SelectItemText>{label}</SelectItemText>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
            const verified = e.isVerified === true;
            const { installments: instCount, installmentIndex: instIdx } = safeHistoryInstallments(e);
            const installmentText =
              rowType === "expense" && instCount > 1
                ? t.historyInstallmentText
                    .replace("{{index}}", String(instIdx))
                    .replace("{{total}}", String(instCount))
                : null;
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
                        {e.recurringMonthly || (e.type === "expense" && e.installments > 1) ? (
                          <span className="mt-1 inline-flex items-center gap-1 text-sm leading-relaxed text-muted-foreground">
                            <RefreshCw className="size-3" />
                            <span>Recurring</span>
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
                      {currencyCode !== "ILS" ? (
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
                <button
                  type="button"
                  className={cn(
                    "shrink-0 self-center rounded-lg p-2.5 text-muted-foreground transition-colors",
                    "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    verified && "text-green-500",
                    !verified && "opacity-50",
                  )}
                  aria-label={verified ? t.verifiedAriaVerified : t.verifiedAriaUnverified}
                  aria-pressed={verified}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    updateExpense(e.id, { isVerified: !verified });
                  }}
                >
                  <Check className="size-4 stroke-[2.5]" />
                </button>
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
    </div>
  );
}
