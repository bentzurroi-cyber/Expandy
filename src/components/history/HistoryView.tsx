import { useLayoutEffect, useMemo, useState, useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
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
  formatYearMonth,
  type YearMonth,
} from "@/lib/month";
import { cn } from "@/lib/utils";

const CATEGORY_ALL = "__all__";
const EXPENSE_CATEGORY_PREFIX = "exp:";
const INCOME_CATEGORY_PREFIX = "inc:";

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
  const { t, dir } = useI18n();
  const {
    expenses,
    sortExpenses,
    expenseCategories,
    incomeSources,
    currencies,
    updateExpense,
  } = useExpenses();
  const ALL_TIME = "__all_time__" as const;
  const [selectedMonth, setSelectedMonth] = useState<YearMonth | typeof ALL_TIME>(() =>
    formatYearMonth(new Date()),
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(CATEGORY_ALL);
  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState<10 | 20 | 50 | "all">(10);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "amountDesc" | "amountAsc">(
    "newest",
  );

  useLayoutEffect(() => {
    if (!preset) return;
    setSelectedMonth(preset.month);
    setCategoryFilter(`${EXPENSE_CATEGORY_PREFIX}${preset.categoryId}`);
    onPresetConsumed();
  }, [preset, onPresetConsumed]);

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

    for (const t of templates) {
      const baseYm = t.date.slice(0, 7);
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
        const id = `${t.id}-installment-${monthsFromBase + 1}`;
        if (ids.has(id)) continue;
        const srcDay = Number(t.date.slice(8, 10)) || 1;
        const safeDay = clampDayForMonth(ty, tm, srcDay);
        out.push({
          ...t,
          id,
          date: `${ym}-${String(safeDay).padStart(2, "0")}`,
          recurringMonthly: false,
          installments: Math.max(1, t.installments || 1),
          installmentIndex: Math.max(1, monthsFromBase + 1),
          note:
            (typeof t.note === "string" ? t.note.trim() : "") ||
            `תשלום ${Math.max(1, monthsFromBase + 1)} מתוך ${Math.max(1, t.installments || 1)}`,
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
      .filter(
        (e) =>
          categoryFilter === CATEGORY_ALL ||
          (categoryFilter.startsWith(EXPENSE_CATEGORY_PREFIX) &&
            e.type === "expense" &&
            e.categoryId === categoryFilter.slice(EXPENSE_CATEGORY_PREFIX.length)) ||
          (categoryFilter.startsWith(INCOME_CATEGORY_PREFIX) &&
            e.type === "income" &&
            e.categoryId === categoryFilter.slice(INCOME_CATEGORY_PREFIX.length)),
      )
      .filter((e) => {
        if (!q) return true;
        const cat = resolveTransactionCategory(
          e.categoryId,
          e.type,
          expenseCategories,
          incomeSources,
        );
        const catName = (cat?.name ?? "").toLowerCase();
        const note = typeof e.note === "string" ? e.note : "";
        return note.toLowerCase().includes(q) || catName.includes(q);
      });
  }, [
    ALL_TIME,
    projectedExpenses,
    selectedMonth,
    categoryFilter,
    search,
    incomeSources,
    expenseCategories,
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
  }, [selectedMonth, categoryFilter, search]);

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
      <div className="-mx-4 border-b border-border/80 bg-background px-4 py-3">
        <div className="mx-auto grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="hist-month">{t.monthFilterLabel}</Label>
            <div className="mt-2">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hist-cat">{t.category}</Label>
            <Select
              value={categoryFilter}
              onValueChange={setCategoryFilter}
            >
              <SelectTrigger id="hist-cat" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={CATEGORY_ALL} textValue={t.allCategories}>
                  <SelectItemText>{t.allCategories}</SelectItemText>
                </SelectItem>
                <SelectGroup>
                  <SelectLabel>הכנסות</SelectLabel>
                  {incomeSources.map((c) => (
                    <SelectItem
                      key={`inc-${c.id}`}
                      value={`${INCOME_CATEGORY_PREFIX}${c.id}`}
                      textValue={c.name}
                    >
                      <span className="flex items-center gap-2">
                        <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                        <ColorBadge color={c.color} />
                        <SelectItemText>{c.name}</SelectItemText>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>הוצאות</SelectLabel>
                  {expenseCategories.map((c) => (
                    <SelectItem
                      key={`exp-${c.id}`}
                      value={`${EXPENSE_CATEGORY_PREFIX}${c.id}`}
                      textValue={c.name}
                    >
                      <span className="flex items-center gap-2">
                        <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                        <ColorBadge color={c.color} />
                        <SelectItemText>{c.name}</SelectItemText>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hist-search">{t.searchNotes}</Label>
            <Input
              id="hist-search"
              type="search"
              placeholder={t.searchNotesPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hist-sort">מיון</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger id="hist-sort" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="newest" textValue="חדש לישן">
                  <SelectItemText>חדש לישן</SelectItemText>
                </SelectItem>
                <SelectItem value="oldest" textValue="ישן לחדש">
                  <SelectItemText>ישן לחדש</SelectItemText>
                </SelectItem>
                <SelectItem value="amountDesc" textValue="סכום: גבוה לנמוך">
                  <SelectItemText>סכום: גבוה לנמוך</SelectItemText>
                </SelectItem>
                <SelectItem value="amountAsc" textValue="סכום: נמוך לגבוה">
                  <SelectItemText>סכום: נמוך לגבוה</SelectItemText>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <ul className="mx-auto flex w-full max-w-lg flex-col gap-2 pb-2">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t.historyEmpty}
          </p>
        ) : (
          pagedFiltered.map((e) => {
            const cat = resolveTransactionCategory(
              e.categoryId,
              e.type,
              expenseCategories,
              incomeSources,
            );
            const dateLabel = formatDateDDMMYYYY(e.date);
            const verified = e.isVerified === true;
            const installmentText =
              e.type === "expense" && e.installments > 1
                ? t.historyInstallmentText
                    .replace("{{index}}", String(Math.max(1, e.installmentIndex)))
                    .replace("{{total}}", String(Math.max(1, e.installments)))
                : null;
            return (
              <li key={e.id} className="flex w-full items-stretch gap-1">
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
                            className="absolute start-1.5 top-1.5 size-2 rounded-full"
                            style={{ backgroundColor: cat.color }}
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
                        <span className="truncate text-base font-semibold leading-relaxed">
                          {cat?.name ?? "—"}
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
                          e.type === "income" ? "text-green-500" : "text-red-500",
                        )}
                      >
                        {e.type === "income" ? "+ " : "- "}
                        {formatIls(convertToILS(e.amount, e.currency, e.date))}
                      </span>
                      {e.currency !== "ILS" ? (
                        <span className="text-sm leading-relaxed tabular-nums text-muted-foreground">
                          {formatCurrencyCompact(e.amount, e.currency, currencies)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
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

      {filtered.length > 0 ? (
        <footer
          className="sticky bottom-0 z-10 mx-auto flex w-full max-w-lg flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
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
