import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Compass,
  Info,
  Landmark,
  Plus,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetsContext";
import { useBudgets } from "@/context/BudgetContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useFxTick } from "@/context/FxContext";
import { useSavingsGoals, type SavingsGoal } from "@/context/SavingsGoalsContext";
import { useI18n } from "@/context/I18nContext";
import { en } from "@/i18n/en";
import { he } from "@/i18n/he";
import { assetBaseId } from "@/lib/assetRowId";
import { convertToILS, getFxRateSync, prefetchFxRate, warmupFxRates } from "@/lib/fx";
import {
  localizedAssetTypeName,
  localizedDestinationAccountName,
  localizedExpenseCategoryName,
  localizedIncomeSourceName,
  localizedPaymentMethodName,
} from "@/lib/defaultEntityLabels";
import {
  canonicalCurrencyCode,
  formatCurrencyCompact,
  formatDateDDMMYYYY,
  formatIls,
  formatIlsWholeCeil,
  isShekelCurrency,
} from "@/lib/format";
import type { ReviewAssetRow } from "@/lib/fetchHouseholdAssetsLatest";
import {
  fetchHouseholdAssetsForMonth,
} from "@/lib/fetchHouseholdAssetsLatest";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import {
  MONTHLY_SNAPSHOT_VERSION,
  upsertMonthlySnapshot,
} from "@/lib/financialReviewSnapshot";
import {
  formatYearMonth,
  hebrewMonthYearLabel,
  isoDateInYearMonth,
  previousYearMonth,
  type YearMonth,
} from "@/lib/month";
import {
  allocateSurplusToGoals,
  allocateSurplusToMonthlyGapsFirst,
  computeMonthSurplusIls,
  type GoalForAllocation,
} from "@/lib/monthlySurplusInsights";
import {
  surplusAdviceFromT,
  type SurplusAdviceStrings,
} from "@/lib/surplusAdviceFromT";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { fireSavingsGoalConfetti } from "@/lib/goalConfetti";
import { DEFAULT_CURRENCY, type AssetAccount, type CurrencyDef, type Expense } from "@/data/mock";
import { parseProjectedRecurringId } from "@/lib/expenseIds";
import { resolveTransactionCategory } from "@/lib/transactionCategoryDisplay";
import { toast } from "sonner";

const adviceBundle = (bundle: SurplusAdviceStrings): SurplusAdviceStrings => ({
  monthlyInsightAdviceSplit: bundle.monthlyInsightAdviceSplit,
  monthlyInsightAdviceSavings: bundle.monthlyInsightAdviceSavings,
  monthlyInsightAdviceInv: bundle.monthlyInsightAdviceInv,
  monthlyInsightAdviceGeneric: bundle.monthlyInsightAdviceGeneric,
});

const RECON_CATEGORY_PREVIEW_LIMIT = 5;
const RECON_EXP_PREFIX = "exp:";
const RECON_INC_PREFIX = "inc:";

function colorWithAlpha(color: unknown, alphaHex: string): string | null {
  const c = typeof color === "string" ? color.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return `${c}${alphaHex}`;
  return null;
}

function normalizeReconEntryType(e: Pick<Expense, "type"> | null | undefined): "expense" | "income" {
  return e?.type === "income" ? "income" : "expense";
}

function safeReconInstallments(e: Expense): { installments: number; installmentIndex: number } {
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

function fallbackAssetsFromContext(accounts: AssetAccount[]): ReviewAssetRow[] {
  const seen = new Set<string>();
  const out: ReviewAssetRow[] = [];
  for (const a of accounts) {
    const base = assetBaseId(a.id);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({
      baseId: base,
      name: a.name,
      type: a.type,
      balance: a.balance,
      currency: a.currency ?? "ILS",
      color: a.color,
    });
  }
  out.sort((x, y) => x.name.localeCompare(y.name, "he"));
  return out;
}

function pctTowardTarget(current: number, target: number): number {
  if (target <= 0.009) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function pctOfTarget(amount: number, target: number): number {
  if (target <= 0.009) return 0;
  return Math.min(100, Math.round((amount / target) * 100));
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function AssetTypeIcon({ type }: { type: string }) {
  const cls = "size-5 shrink-0";
  if (type === "portfolio")
    return <TrendingUp className={cn(cls, "text-sky-600/85 dark:text-sky-400/90")} aria-hidden />;
  if (type === "pension")
    return <Landmark className={cn(cls, "text-violet-600/85 dark:text-violet-400/90")} aria-hidden />;
  return <Wallet className={cn(cls, "text-emerald-600/85 dark:text-emerald-400/90")} aria-hidden />;
}

function assetTypeLabel(
  a: ReviewAssetRow,
  assetTypes: Array<{ id: string; name: string }>,
  lang: "he" | "en",
): string {
  const opt = assetTypes.find((t) => t.id === a.type);
  return localizedAssetTypeName(a.type, opt?.name ?? a.type, lang);
}

function CategoryTintRow({
  accentHex,
  children,
  className,
}: {
  accentHex: string;
  children: ReactNode;
  className?: string;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accentHex.trim()) ? accentHex.trim() : "#64748b";
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-border/15", className)}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.22] dark:opacity-[0.18]"
        style={{
          background: `linear-gradient(118deg, ${hex} 0%, transparent 58%)`,
        }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </div>
  );
}

type FinancialReviewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FinancialReviewModal({ open, onOpenChange }: FinancialReviewModalProps) {
  const fxTick = useFxTick();
  const { t, dir, lang } = useI18n();
  const { user, profile } = useAuth();
  const { currentAssets, persistAssetRowForMonth, assetTypes, removeAccountFromMonth } = useAssets();
  const {
    expensesForMonth,
    materializeRecurringForMonth,
    expenseCategories,
    addExpense,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    updateExpenseAsync,
    removeExpense,
    currencies,
    sortExpenses,
  } = useExpenses();
  const { getBudget } = useBudgets();
  const { goals, depositAmount, updateGoal, refresh: refreshSavingsGoals } = useSavingsGoals();

  const householdId = useMemo(
    () => normalizeHouseholdCode(profile?.household_id ?? ""),
    [profile?.household_id],
  );

  const calendarMonth: YearMonth = useMemo(() => formatYearMonth(new Date()), [open]);
  const reviewMonth: YearMonth = useMemo(
    () => previousYearMonth(calendarMonth),
    [calendarMonth],
  );

  const monthTitle =
    lang === "he" ? hebrewMonthYearLabel(reviewMonth) : reviewMonth;
  const calendarMonthTitle =
    lang === "he" ? hebrewMonthYearLabel(calendarMonth) : calendarMonth;

  const requestCloseFinancialReview = useCallback(() => {
    setExitConfirmOpen(true);
  }, []);

  const confirmCloseFinancialReview = useCallback(() => {
    setExitConfirmOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleFinancialReviewDialogOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      requestCloseFinancialReview();
    },
    [onOpenChange, requestCloseFinancialReview],
  );

  useEffect(() => {
    if (!open || !isValidHouseholdCode(householdId)) return;
    void materializeRecurringForMonth(reviewMonth);
  }, [open, householdId, materializeRecurringForMonth, reviewMonth]);

  const [step, setStep] = useState(0);
  const [draftBalances, setDraftBalances] = useState<Record<string, number>>({});
  const [draftBalanceInputText, setDraftBalanceInputText] = useState<Record<string, string>>({});
  const [incomeFormOpen, setIncomeFormOpen] = useState(false);
  const [incomeDraftAmount, setIncomeDraftAmount] = useState("");
  const [incomeDraftLabel, setIncomeDraftLabel] = useState("");
  const [incomeDraftCategoryId, setIncomeDraftCategoryId] = useState("");
  const [incomeDraftDate, setIncomeDraftDate] = useState("");
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [reconCategoryFilters, setReconCategoryFilters] = useState<string[]>([]);
  const [reconPayerFilters, setReconPayerFilters] = useState<string[]>([]);
  const [reconSearch, setReconSearch] = useState("");
  const [reconSort, setReconSort] = useState<"newest" | "oldest" | "amountDesc" | "amountAsc">("newest");
  const [reconShowAll, setReconShowAll] = useState(false);
  const [reconShowAllIncomeCats, setReconShowAllIncomeCats] = useState(false);
  const [reconShowAllExpenseCats, setReconShowAllExpenseCats] = useState(false);
  const [reconShowAllPayers, setReconShowAllPayers] = useState(false);
  const [reconSelectedIds, setReconSelectedIds] = useState<Set<string>>(() => new Set());
  const [reconBusyId, setReconBusyId] = useState<string | null>(null);
  const [reconBulkBusy, setReconBulkBusy] = useState(false);
  const [reviewedOpen, setReviewedOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingAmount, setMissingAmount] = useState("");
  const [missingNote, setMissingNote] = useState("");
  const [missingType, setMissingType] = useState<"income" | "expense">("expense");
  const [missingCategoryId, setMissingCategoryId] = useState("");
  const [missingPayerId, setMissingPayerId] = useState("");
  const [missingDate, setMissingDate] = useState("");
  const [missingSaving, setMissingSaving] = useState(false);
  const [budgetShowAll, setBudgetShowAll] = useState(false);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [pendingOverwrite, setPendingOverwrite] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [dbAssetRows, setDbAssetRows] = useState<ReviewAssetRow[] | null>(null);
  const [prevMonthBalanceByBase, setPrevMonthBalanceByBase] = useState<
    Record<string, number | null>
  >({});
  const prevOpen = useRef(false);
  const currentAssetsRef = useRef(currentAssets);
  currentAssetsRef.current = currentAssets;

  const [balanceInputCurrency, setBalanceInputCurrency] = useState<Record<string, string>>({});
  const [incomeDraftCurrency, setIncomeDraftCurrency] = useState(DEFAULT_CURRENCY);
  const [assetStepBusy, setAssetStepBusy] = useState(false);
  const [trashBusyBaseId, setTrashBusyBaseId] = useState<string | null>(null);
  /** After user removes rows locally, do not repopulate from context when the list becomes empty. */
  const [suppressReviewAssetFallback, setSuppressReviewAssetFallback] = useState(false);
  const [incomeDeleteBusyId, setIncomeDeleteBusyId] = useState<string | null>(null);

  const currenciesRef = useRef(currencies);
  currenciesRef.current = currencies;

  useEffect(() => {
    if (!open) setAssetsLoading(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      prevOpen.current = false;
      setDbAssetRows(null);
      setPrevMonthBalanceByBase({});
      setSuppressReviewAssetFallback(false);
      return;
    }
    if (!prevOpen.current) {
      setStep(0);
      setIncomeFormOpen(false);
      setIncomeDraftAmount("");
      setIncomeDraftLabel("");
      setIncomeDraftCategoryId("");
      setIncomeDraftCurrency(DEFAULT_CURRENCY);
      setIncomeDraftDate(isoDateInYearMonth(reviewMonth, new Date()));
      setReconCategoryFilters([]);
      setReconPayerFilters([]);
      setReconSearch("");
      setReconSort("newest");
      setReconShowAll(false);
      setReconShowAllIncomeCats(false);
      setReconShowAllExpenseCats(false);
      setReconShowAllPayers(false);
      setReconSelectedIds(new Set());
      setReconBusyId(null);
      setReconBulkBusy(false);
      setReviewedOpen(false);
      setMissingOpen(false);
      setMissingAmount("");
      setMissingNote("");
      setMissingType("expense");
      setMissingCategoryId("");
      setMissingPayerId("");
      setMissingDate(isoDateInYearMonth(reviewMonth, new Date()));
      setMissingSaving(false);
      setBudgetShowAll(false);
      setOverwriteConfirmOpen(false);
      setPendingOverwrite(false);
      setExitConfirmOpen(false);
    }
    prevOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !isValidHouseholdCode(householdId)) return;
    let cancelled = false;
    void (async () => {
      setAssetsLoading(true);
      try {
        const [prevRows, currRows] = await Promise.all([
          fetchHouseholdAssetsForMonth(householdId, reviewMonth),
          fetchHouseholdAssetsForMonth(householdId, calendarMonth),
        ]);
        if (cancelled) return;
        const useRows =
          currRows.length > 0
            ? currRows
            : prevRows.length > 0
              ? prevRows
              : fallbackAssetsFromContext(currentAssetsRef.current);
        setDbAssetRows(useRows);
        setSuppressReviewAssetFallback(false);
        const prevByBase = new Map(prevRows.map((r) => [r.baseId, r] as const));
        const currByBase = new Map(currRows.map((r) => [r.baseId, r] as const));
        const prevDisplay: Record<string, number | null> = {};
        for (const a of useRows) {
          const p = prevByBase.get(a.baseId);
          prevDisplay[a.baseId] = p != null ? Math.ceil(Number(p.balance) || 0) : null;
        }
        setPrevMonthBalanceByBase(prevDisplay);

        const entryDate = isoDateLocal(new Date());
        const drafts: Record<string, number> = {};
        const draftTexts: Record<string, string> = {};
        const inputCcy: Record<string, string> = {};
        const pairs: { date: string; currency: string }[] = [];

        for (const a of useRows) {
          const c = currByBase.get(a.baseId);
          const p = prevByBase.get(a.baseId);
          const v = c
            ? round2(Number(c.balance) || 0)
            : p
              ? round2(Number(p.balance) || 0)
              : round2(Number(a.balance) || 0);
          drafts[a.baseId] = v;
          draftTexts[a.baseId] = formatNumericInput(String(v));
          const rawCcy =
            (typeof c?.currency === "string" && c.currency.trim()) ||
            (typeof p?.currency === "string" && p.currency.trim()) ||
            (typeof a.currency === "string" && a.currency.trim()) ||
            "ILS";
          const ac = canonicalCurrencyCode(rawCcy, currenciesRef.current);
          inputCcy[a.baseId] = ac;
          pairs.push({ date: entryDate, currency: ac });
        }
        for (const code of ["ILS", "USD", "EUR", "GBP"]) {
          pairs.push({ date: entryDate, currency: code });
        }
        for (const c of currenciesRef.current) {
          const code = typeof c.code === "string" ? c.code.trim() : "";
          if (/^[A-Z]{3}$/.test(code)) pairs.push({ date: entryDate, currency: code });
        }

        setDraftBalances(drafts);
        setDraftBalanceInputText(draftTexts);
        setBalanceInputCurrency(inputCcy);

        await warmupFxRates(pairs);
        if (cancelled) return;
      } catch {
        /* network / FX — stop spinner so the flow is not stuck */
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, householdId, reviewMonth, calendarMonth]);

  const displayAssets = useMemo((): ReviewAssetRow[] => {
    if (dbAssetRows === null) return [];
    if (dbAssetRows.length > 0) return dbAssetRows;
    if (suppressReviewAssetFallback) return [];
    return fallbackAssetsFromContext(currentAssets);
  }, [dbAssetRows, currentAssets, suppressReviewAssetFallback]);

  /** מטבעות ייחודיים לפי קוד קנוני (ILS אחד לכל מ-alias של שקל / ₪ / NIS) */
  const assetStepCurrencyOptions = useMemo((): CurrencyDef[] => {
    const canonSet = new Set<string>();
    for (const c of currencies) {
      canonSet.add(canonicalCurrencyCode(c.code, currencies));
    }
    for (const a of displayAssets) {
      canonSet.add(
        canonicalCurrencyCode(
          balanceInputCurrency[a.baseId] || a.currency || "ILS",
          currencies,
        ),
      );
    }
    const sorted = [...canonSet].sort((x, y) => x.localeCompare(y));
    return sorted.map((code) => {
      const fromList = currencies.find(
        (c) => canonicalCurrencyCode(c.code, currencies) === code,
      );
      return (
        fromList ?? {
          code,
          labelHe: code,
          symbol: code,
          iconKey: "dollar-sign",
        }
      );
    });
  }, [balanceInputCurrency, currencies, displayAssets]);

  const rateDate = `${reviewMonth}-01`;
  const rows = useMemo(
    () => (isValidHouseholdCode(householdId) ? expensesForMonth(reviewMonth) : []),
    [expensesForMonth, householdId, reviewMonth],
  );

  const incomeRowsForMonth = useMemo(
    () => rows.filter((e) => e && e.type === "income"),
    [rows],
  );
  const reviewedRows = useMemo(() => rows.filter((e) => e?.isReviewed === true), [rows]);
  const unreviewedRows = useMemo(() => rows.filter((e) => e?.isReviewed !== true), [rows]);

  const reconCategoryFilterSet = useMemo(() => new Set(reconCategoryFilters), [reconCategoryFilters]);
  const reconPayerFilterSet = useMemo(() => new Set(reconPayerFilters), [reconPayerFilters]);

  const incomeCategoryValuesRecon = useMemo(
    () => incomeSources.map((c) => `${RECON_INC_PREFIX}${c.id}`),
    [incomeSources],
  );
  const expenseCategoryValuesRecon = useMemo(
    () => expenseCategories.map((c) => `${RECON_EXP_PREFIX}${c.id}`),
    [expenseCategories],
  );

  const reconCategoryLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of incomeSources) {
      map.set(`${RECON_INC_PREFIX}${c.id}`, localizedIncomeSourceName(c.id, c.name, lang));
    }
    for (const c of expenseCategories) {
      map.set(`${RECON_EXP_PREFIX}${c.id}`, localizedExpenseCategoryName(c.id, c.name, lang));
    }
    return map;
  }, [expenseCategories, incomeSources, lang]);

  const reconCategoryFilterSummary = useMemo(() => {
    if (reconCategoryFilters.length === 0) return t.financialReviewReconFilterAllCategories;
    if (reconCategoryFilters.length === 1) {
      return reconCategoryLabelByValue.get(reconCategoryFilters[0]!) ?? t.financialReviewReconFilterAllCategories;
    }
    return `${reconCategoryFilters.length} ${t.category}`;
  }, [reconCategoryFilters, reconCategoryLabelByValue, t.category, t.financialReviewReconFilterAllCategories]);

  const allPayerIdsRecon = useMemo(() => {
    const ids = new Set<string>();
    for (const p of paymentMethods) ids.add(p.id);
    for (const d of destinationAccounts) ids.add(d.id);
    return [...ids];
  }, [destinationAccounts, paymentMethods]);

  const reconPayerFilterSummary = useMemo(() => {
    if (reconPayerFilters.length === 0) return t.financialReviewReconFilterAllPayers;
    if (reconPayerFilters.length === 1) {
      const id = reconPayerFilters[0]!;
      const pm = paymentMethods.find((p) => p.id === id);
      if (pm) return localizedPaymentMethodName(pm.id, pm.name, lang);
      const da = destinationAccounts.find((p) => p.id === id);
      if (da) return localizedDestinationAccountName(da.id, da.name, lang);
      return t.financialReviewReconFilterAllPayers;
    }
    return `${reconPayerFilters.length} ${t.paymentMethod}`;
  }, [destinationAccounts, lang, paymentMethods, reconPayerFilters, t.financialReviewReconFilterAllPayers, t.paymentMethod]);

  const toggleReconCategoryFilter = useCallback((value: string) => {
    setReconCategoryFilters((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  }, []);

  const toggleAllReconIncomeCategories = useCallback(() => {
    setReconCategoryFilters((prev) => {
      const set = new Set(prev);
      const allOn = incomeCategoryValuesRecon.length > 0 && incomeCategoryValuesRecon.every((v) => set.has(v));
      if (allOn) {
        return prev.filter((x) => !incomeCategoryValuesRecon.includes(x));
      }
      return [...new Set([...prev, ...incomeCategoryValuesRecon])];
    });
  }, [incomeCategoryValuesRecon]);

  const toggleAllReconExpenseCategories = useCallback(() => {
    setReconCategoryFilters((prev) => {
      const set = new Set(prev);
      const allOn = expenseCategoryValuesRecon.length > 0 && expenseCategoryValuesRecon.every((v) => set.has(v));
      if (allOn) {
        return prev.filter((x) => !expenseCategoryValuesRecon.includes(x));
      }
      return [...new Set([...prev, ...expenseCategoryValuesRecon])];
    });
  }, [expenseCategoryValuesRecon]);

  const toggleReconPayerFilter = useCallback((id: string) => {
    setReconPayerFilters((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleAllReconPayers = useCallback(() => {
    setReconPayerFilters((prev) => {
      if (prev.length === 0) return [...allPayerIdsRecon];
      if (prev.length === allPayerIdsRecon.length) return [];
      return [...allPayerIdsRecon];
    });
  }, [allPayerIdsRecon]);

  const filteredUnreviewedBase = useMemo(() => {
    const q = reconSearch.trim().toLowerCase();
    return unreviewedRows.filter((e) => {
      if (reconCategoryFilterSet.size > 0) {
        const rowType = normalizeReconEntryType(e);
        const key =
          rowType === "income"
            ? `${RECON_INC_PREFIX}${e.categoryId}`
            : `${RECON_EXP_PREFIX}${e.categoryId}`;
        if (!reconCategoryFilterSet.has(key)) return false;
      }
      if (reconPayerFilterSet.size > 0 && !reconPayerFilterSet.has(e.paymentMethodId)) {
        return false;
      }
      if (q) {
        try {
          const cat = resolveTransactionCategory(
            e.categoryId,
            normalizeReconEntryType(e),
            expenseCategories,
            incomeSources,
          );
          const catName = (cat?.name ?? "").toLowerCase();
          const note = typeof e.note === "string" ? e.note : "";
          if (!note.toLowerCase().includes(q) && !catName.includes(q)) return false;
        } catch {
          const note = typeof e?.note === "string" ? e.note : "";
          if (!note.toLowerCase().includes(q)) return false;
        }
      }
      return true;
    });
  }, [
    expenseCategories,
    incomeSources,
    reconCategoryFilterSet,
    reconPayerFilterSet,
    reconSearch,
    unreviewedRows,
  ]);

  const filteredUnreviewedRows = useMemo(
    () => sortExpenses(filteredUnreviewedBase, reconSort),
    [filteredUnreviewedBase, reconSort, sortExpenses],
  );

  const visibleReconIncomeCategories = useMemo(
    () =>
      reconShowAllIncomeCats
        ? incomeSources
        : incomeSources.slice(0, RECON_CATEGORY_PREVIEW_LIMIT),
    [incomeSources, reconShowAllIncomeCats],
  );
  const visibleReconExpenseCategories = useMemo(
    () =>
      reconShowAllExpenseCats
        ? expenseCategories
        : expenseCategories.slice(0, RECON_CATEGORY_PREVIEW_LIMIT),
    [expenseCategories, reconShowAllExpenseCats],
  );

  const visibleReconPayers = useMemo(() => {
    const combined = [
      ...paymentMethods.map((p) => ({ ...p, payerKind: "pm" as const })),
      ...destinationAccounts.map((p) => ({ ...p, payerKind: "dest" as const })),
    ];
    return reconShowAllPayers ? combined : combined.slice(0, 10);
  }, [destinationAccounts, paymentMethods, reconShowAllPayers]);

  const reviewProgressPct = useMemo(() => {
    if (rows.length === 0) return 100;
    return Math.round((reviewedRows.length / rows.length) * 100);
  }, [reviewedRows.length, rows.length]);

  const incomeFromTransactionsRaw = useMemo(() => {
    let inc = 0;
    for (const e of rows) {
      if (!e || typeof e.amount !== "number" || !Number.isFinite(e.amount)) continue;
      if (e.type !== "income") continue;
      inc += convertToILS(e.amount, e.currency ?? "ILS", rateDate);
    }
    return inc;
  }, [rateDate, rows]);

  const expenseIlsRaw = useMemo(() => {
    let exp = 0;
    for (const e of rows) {
      if (!e || typeof e.amount !== "number" || !Number.isFinite(e.amount)) continue;
      if (e.type === "expense") exp += convertToILS(e.amount, e.currency ?? "ILS", rateDate);
    }
    return exp;
  }, [rateDate, rows]);

  const incomeIlsRaw = incomeFromTransactionsRaw;
  const incomeCeil = Math.ceil(incomeIlsRaw);
  const expenseCeil = Math.ceil(expenseIlsRaw);

  const surplus = useMemo(
    () => computeMonthSurplusIls(rows, rateDate, (amt, ccy, d) => convertToILS(amt, ccy, d)),
    [rateDate, rows],
  );
  const surplusCeil = Math.ceil(surplus);

  const topExpenseCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) {
      if (!e || e.type !== "expense") continue;
      if (typeof e.amount !== "number" || !Number.isFinite(e.amount)) continue;
      const ils = convertToILS(e.amount, e.currency ?? "ILS", rateDate);
      const id = typeof e.categoryId === "string" ? e.categoryId : "";
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + ils);
    }
    return [...map.entries()]
      .map(([categoryId, amountIls]) => {
        const cat = expenseCategories.find((c) => c.id === categoryId);
        const name = cat
          ? localizedExpenseCategoryName(cat.id, cat.name, lang)
          : categoryId;
        return {
          categoryId,
          name,
          amountIls: Math.ceil(amountIls),
          color: cat?.color ?? "#fb7185",
        };
      })
      .filter((x) => x.amountIls > 0)
      .sort((a, b) => b.amountIls - a.amountIls)
      .slice(0, 3);
  }, [expenseCategories, lang, rateDate, rows]);
  const budgetVsActualRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) {
      if (!e || e.type !== "expense") continue;
      const ils = convertToILS(e.amount, e.currency ?? "ILS", rateDate);
      map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + ils);
    }
    return [...map.entries()]
      .map(([categoryId, actualIls]) => {
        const cat = expenseCategories.find((c) => c.id === categoryId);
        const budgetIls = Math.max(0, getBudget(categoryId, reviewMonth));
        return {
          categoryId,
          name: cat ? localizedExpenseCategoryName(cat.id, cat.name, lang) : categoryId,
          actualIls: Math.ceil(actualIls),
          budgetIls: Math.ceil(budgetIls),
          over: actualIls > budgetIls + 0.009,
        };
      })
      .sort((a, b) => b.actualIls - a.actualIls);
  }, [expenseCategories, getBudget, lang, rateDate, reviewMonth, rows]);

  const goalsForAllocation: GoalForAllocation[] = useMemo(
    () =>
      goals.map((g) => ({
        id: g.id,
        name: g.name,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        isInvestmentPortfolio: g.isInvestmentPortfolio,
        color: g.color,
        icon: g.icon,
        priority: g.priority,
        targetMode: g.targetMode,
      })),
    [goals],
  );

  const goalsBehindMonthlyPlan = useMemo(
    () =>
      goals.filter((g) => {
        if (g.monthlyMode === "surplus") {
          const room =
            g.targetMode === "open" || g.currentAmount < g.targetAmount - 0.009;
          return surplus > 0.009 && room;
        }
        return (
          g.monthlyContribution > 0.009 &&
          g.monthlyCurrent < g.monthlyContribution - 0.009
        );
      }),
    [goals, surplus],
  );

  const monthlyCatchUpInputs = useMemo(
    () =>
      goalsBehindMonthlyPlan.map((g) => ({
        id: g.id,
        monthlyContribution: g.monthlyContribution,
        monthlyCurrent: g.monthlyCurrent,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        priority: g.priority,
        monthlyMode: g.monthlyMode,
        targetMode: g.targetMode,
      })),
    [goalsBehindMonthlyPlan],
  );

  const { surplusAfterMonthly, monthlyByGoalId } = useMemo(
    () => allocateSurplusToMonthlyGapsFirst(surplus, monthlyCatchUpInputs),
    [monthlyCatchUpInputs, surplus],
  );

  const compassAllocation = useMemo(
    () => allocateSurplusToGoals(surplusAfterMonthly, goalsForAllocation),
    [goalsForAllocation, surplusAfterMonthly],
  );

  const totalMonthlyCatchUpAllocated = useMemo(
    () =>
      Object.values(monthlyByGoalId).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [monthlyByGoalId],
  );

  const monthlyPriorityRows = useMemo(() => {
    const rows: {
      goal: SavingsGoal;
      monthly: number;
      compass: number;
      total: number;
    }[] = [];
    for (const g of goals) {
      const monthly = monthlyByGoalId[g.id] ?? 0;
      if (monthly <= 0.009) continue;
      let compass = 0;
      if (compassAllocation.savingsGoal?.id === g.id) {
        compass += compassAllocation.amountToSavings;
      }
      if (compassAllocation.investmentGoal?.id === g.id) {
        compass += compassAllocation.amountToInvestment;
      }
      const total = Math.round((monthly + compass) * 100) / 100;
      rows.push({ goal: g, monthly, compass, total });
    }
    rows.sort((a, b) => b.monthly - a.monthly);
    return rows;
  }, [compassAllocation, goals, monthlyByGoalId]);

  const monthlyRowSignature = useMemo(
    () => monthlyPriorityRows.map((r) => `${r.goal.id}:${r.total}`).join("|"),
    [monthlyPriorityRows],
  );

  const savMonthlyPrefilled =
    compassAllocation.savingsGoal != null
      ? (monthlyByGoalId[compassAllocation.savingsGoal.id] ?? 0)
      : 0;
  const invMonthlyPrefilled =
    compassAllocation.investmentGoal != null
      ? (monthlyByGoalId[compassAllocation.investmentGoal.id] ?? 0)
      : 0;
  const compassSavingsRowVisible =
    Boolean(compassAllocation.savingsGoal) &&
    compassAllocation.amountToSavings > 0.009 &&
    savMonthlyPrefilled <= 0.009;
  const compassInvestmentRowVisible =
    Boolean(compassAllocation.investmentGoal) &&
    compassAllocation.amountToInvestment > 0.009 &&
    invMonthlyPrefilled <= 0.009;

  const [amountSav, setAmountSav] = useState("");
  const [amountInv, setAmountInv] = useState("");
  const [monthlyDepositDrafts, setMonthlyDepositDrafts] = useState<Record<string, string>>(
    {},
  );
  const [depositing, setDepositing] = useState<string | null>(null);
  const [savingArchive, setSavingArchive] = useState(false);
  const [invDepositFollowUp, setInvDepositFollowUp] = useState<{
    goalId: string;
    closeAfterMonthClose: boolean;
    goalsPatched: SavingsGoal[];
    reachedTarget: boolean;
  } | null>(null);

  const parsedSavInput = useMemo(() => {
    const p = parseNumericInput(amountSav);
    return p != null && Number.isFinite(p) ? Math.ceil(p) : 0;
  }, [amountSav]);
  const previewSavDeposit = compassSavingsRowVisible
    ? parsedSavInput > 0
      ? parsedSavInput
      : Math.ceil(compassAllocation.amountToSavings)
    : 0;

  const parsedInvInput = useMemo(() => {
    const p = parseNumericInput(amountInv);
    return p != null && Number.isFinite(p) ? Math.ceil(p) : 0;
  }, [amountInv]);
  const previewInvDeposit = compassInvestmentRowVisible
    ? parsedInvInput > 0
      ? parsedInvInput
      : Math.ceil(compassAllocation.amountToInvestment)
    : 0;

  const adviceDisplay = useMemo(() => {
    if (surplus <= 0.009) return "";
    const remainderAdvice = surplusAdviceFromT(
      adviceBundle(t),
      compassAllocation,
      surplusAfterMonthly,
    );
    if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly > 0.009) {
      return `${t.financialReviewAdviceAfterMonthlyPrefix.replace(
        "{{amount}}",
        formatIlsWholeCeil(totalMonthlyCatchUpAllocated),
      )} ${remainderAdvice}`.trim();
    }
    if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly <= 0.009) {
      return t.financialReviewAdviceMonthlyOnly.replace(
        "{{amount}}",
        formatIlsWholeCeil(surplus),
      );
    }
    return remainderAdvice;
  }, [
    compassAllocation,
    surplus,
    surplusAfterMonthly,
    t.financialReviewAdviceAfterMonthlyPrefix,
    t.financialReviewAdviceMonthlyOnly,
    totalMonthlyCatchUpAllocated,
  ]);

  const barMax = Math.max(incomeCeil, expenseCeil, 1);
  const incomeBarPct = incomeCeil > 0 ? Math.min(100, (incomeCeil / barMax) * 100) : 0;
  const expenseBarPct = expenseCeil > 0 ? Math.min(100, (expenseCeil / barMax) * 100) : 0;
  const netIlsRaw = incomeIlsRaw - expenseIlsRaw;
  const netPositive = netIlsRaw >= 0;

  const defaultIncomeDestinationId = useMemo(() => {
    const d = profile?.default_destination_account_id?.trim();
    if (d && destinationAccounts.some((a) => a.id === d)) return d;
    return destinationAccounts[0]?.id ?? "";
  }, [destinationAccounts, profile?.default_destination_account_id]);

  useEffect(() => {
    if (!open) return;
    setAmountSav(
      compassSavingsRowVisible
        ? formatNumericInput(String(Math.ceil(compassAllocation.amountToSavings)))
        : "",
    );
    setAmountInv(
      compassInvestmentRowVisible
        ? formatNumericInput(String(Math.ceil(compassAllocation.amountToInvestment)))
        : "",
    );
  }, [
    compassAllocation.amountToInvestment,
    compassAllocation.amountToSavings,
    compassInvestmentRowVisible,
    compassSavingsRowVisible,
    open,
  ]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const row of monthlyPriorityRows) {
      next[row.goal.id] = formatNumericInput(String(Math.ceil(row.total)));
    }
    setMonthlyDepositDrafts(next);
  }, [open, monthlyRowSignature]);

  /**
   * Step 1 — persist edited balances for **the current calendar month only** (`calendarMonth`),
   * via `persistAssetRowForMonth`. Closed / prior months are not written here; history stays intact.
   */
  const applyDraftBalancesAsync = useCallback(async (): Promise<boolean> => {
    if (!displayAssets.length) return true;
    const entryDate = isoDateLocal(new Date());
    const pairs: { date: string; currency: string }[] = [{ date: entryDate, currency: "ILS" }];
    for (const a of displayAssets) {
      const entryCcy = canonicalCurrencyCode(
        balanceInputCurrency[a.baseId] || a.currency || "ILS",
        currencies,
      );
      pairs.push({ date: entryDate, currency: entryCcy });
    }
    await warmupFxRates(pairs);

    let allOk = true;
    for (const a of displayAssets) {
      const baseId = a.baseId;
      const raw = draftBalances[baseId];
      const amt =
        raw === undefined || !Number.isFinite(Number(raw)) ? 0 : Math.abs(Number(raw));
      const entryCcy = canonicalCurrencyCode(
        balanceInputCurrency[baseId] || a.currency || "ILS",
        currencies,
      );
      const draftIls = round2(convertToILS(amt, entryCcy, entryDate));

      const rateEntry = getFxRateSync(entryCcy, entryDate);
      const newBalNative =
        entryCcy === "ILS"
          ? Math.max(0, round2(draftIls))
          : Math.max(0, round2(draftIls / rateEntry));

      const persistBal = Math.max(0, round2(newBalNative));
      const persistRes = await persistAssetRowForMonth({
        baseId,
        ym: calendarMonth,
        balance: persistBal,
        name: a.name,
        type: a.type,
        currency: entryCcy,
        color: a.color,
        balanceDate: entryDate,
      });
      if (!persistRes.ok) {
        toast.error(persistRes.error);
        allOk = false;
      }
    }
    return allOk;
  }, [
    balanceInputCurrency,
    calendarMonth,
    currencies,
    displayAssets,
    draftBalances,
    persistAssetRowForMonth,
  ]);

  const onTrashAssetRow = useCallback(
    async (a: ReviewAssetRow) => {
      setTrashBusyBaseId(a.baseId);
      try {
        const res = await removeAccountFromMonth(a.baseId, calendarMonth);
        if (!res.ok) return;

        let nextRows: ReviewAssetRow[] | undefined;
        setDbAssetRows((prev) => {
          if (prev === null) return prev;
          const baseList =
            prev.length > 0 ? prev : fallbackAssetsFromContext(currentAssetsRef.current);
          nextRows = baseList.filter((r) => r.baseId !== a.baseId);
          return nextRows;
        });
        if (nextRows !== undefined && nextRows.length === 0) setSuppressReviewAssetFallback(true);
        setDraftBalances((prev) => {
          const next = { ...prev };
          delete next[a.baseId];
          return next;
        });
        setDraftBalanceInputText((prev) => {
          const next = { ...prev };
          delete next[a.baseId];
          return next;
        });
        setBalanceInputCurrency((prev) => {
          const next = { ...prev };
          delete next[a.baseId];
          return next;
        });
        setPrevMonthBalanceByBase((prev) => {
          const next = { ...prev };
          delete next[a.baseId];
          return next;
        });

        toast.success(t.financialReviewAssetRemovedFromMonthToast);
      } finally {
        setTrashBusyBaseId(null);
      }
    },
    [calendarMonth, removeAccountFromMonth, t.financialReviewAssetRemovedFromMonthToast],
  );

  const deleteReviewIncome = useCallback(
    async (expenseId: string) => {
      setIncomeDeleteBusyId(expenseId);
      try {
        const r = await removeExpense(expenseId);
        if (!r.ok) toast.error(r.error);
        else toast.success(t.financialReviewIncomeDeletedToast);
      } finally {
        setIncomeDeleteBusyId(null);
      }
    },
    [removeExpense, t.financialReviewIncomeDeletedToast],
  );

  const mergedAssetsPayload = useCallback(() => {
    const entryDate = isoDateLocal(new Date());
    return displayAssets.map((a) => {
      const raw = draftBalances[a.baseId] ?? a.balance;
      const amt =
        typeof raw === "number" && Number.isFinite(raw) ? Math.abs(raw) : 0;
      const entryCcy = canonicalCurrencyCode(
        balanceInputCurrency[a.baseId] || a.currency || "ILS",
        currencies,
      );
      const draftIls = Math.ceil(convertToILS(amt, entryCcy, entryDate));
      const rateEntry = getFxRateSync(entryCcy, entryDate);
      const native =
        entryCcy === "ILS"
          ? Math.max(0, draftIls)
          : Math.max(0, Math.round((draftIls / rateEntry) * 100) / 100);
      return {
        id: a.baseId,
        name: a.name,
        type: a.type,
        balance: entryCcy === "ILS" ? Math.ceil(native) : native,
        currency: entryCcy,
      };
    });
  }, [balanceInputCurrency, currencies, displayAssets, draftBalances, fxTick]);

  const buildMonthlySnapshotPayload = useCallback(
    (goalsForStatus: SavingsGoal[]) => {
      const assets = mergedAssetsPayload();
      const adviceHe =
        surplus > 0.009
          ? (() => {
              const remainderAdvice = surplusAdviceFromT(
                adviceBundle(he),
                compassAllocation,
                surplusAfterMonthly,
              );
              if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly > 0.009) {
                return `${he.financialReviewSnapshotAfterMonthlyLine.replace(
                  "{{amount}}",
                  formatIlsWholeCeil(totalMonthlyCatchUpAllocated),
                )} ${remainderAdvice}`.trim();
              }
              if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly <= 0.009) {
                return he.financialReviewAdviceMonthlyOnly.replace(
                  "{{amount}}",
                  formatIlsWholeCeil(surplus),
                );
              }
              return remainderAdvice;
            })()
          : "";
      const adviceEn =
        surplus > 0.009
          ? (() => {
              const remainderAdvice = surplusAdviceFromT(
                adviceBundle(en),
                compassAllocation,
                surplusAfterMonthly,
              );
              if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly > 0.009) {
                return `${en.financialReviewSnapshotAfterMonthlyLine.replace(
                  "{{amount}}",
                  formatIlsWholeCeil(totalMonthlyCatchUpAllocated),
                )} ${remainderAdvice}`.trim();
              }
              if (totalMonthlyCatchUpAllocated > 0.009 && surplusAfterMonthly <= 0.009) {
                return en.financialReviewAdviceMonthlyOnly.replace(
                  "{{amount}}",
                  formatIlsWholeCeil(surplus),
                );
              }
              return remainderAdvice;
            })()
          : "";
      return {
        version: MONTHLY_SNAPSHOT_VERSION,
        reviewMonth,
        closedAt: new Date().toISOString(),
        assets,
        incomeIls: incomeCeil,
        incomeFromTransactionsIls: Math.ceil(incomeFromTransactionsRaw),
        incomeManualOverrideIls: null as number | null,
        expenseIls: expenseCeil,
        surplusIls: surplusCeil,
        adviceHe,
        adviceEn,
        topExpenseCategories: topExpenseCategories.map((c) => ({
          categoryId: c.categoryId,
          name: c.name,
          amountIls: c.amountIls,
        })),
        savingsGoalsStatus: goalsForStatus.map((g) => ({
          id: g.id,
          name: g.name,
          monthlyContribution: Math.ceil(g.monthlyContribution),
          monthlyCurrent: Math.ceil(g.monthlyCurrent),
          targetAmount: Math.ceil(g.targetAmount),
          currentAmount: Math.ceil(g.currentAmount),
          isInvestmentPortfolio: g.isInvestmentPortfolio,
        })),
      };
    },
    [
      compassAllocation,
      expenseCeil,
      incomeCeil,
      incomeFromTransactionsRaw,
      mergedAssetsPayload,
      reviewMonth,
      surplus,
      surplusAfterMonthly,
      surplusCeil,
      topExpenseCategories,
      totalMonthlyCatchUpAllocated,
    ],
  );

  const persistMonthlySnapshot = useCallback(
    async (goalsForStatus?: SavingsGoal[]) => {
      if (!user?.id || !isValidHouseholdCode(householdId)) {
        return { ok: false as const, error: "No user or household" };
      }
      const payload = buildMonthlySnapshotPayload(goalsForStatus ?? goals);
      return upsertMonthlySnapshot(householdId, user.id, payload);
    },
    [buildMonthlySnapshotPayload, goals, householdId, user?.id],
  );

  const saveArchiveNow = useCallback(async () => {
    setSavingArchive(true);
    try {
      const assetsOk = await applyDraftBalancesAsync();
      if (!assetsOk) return;
      const res = await persistMonthlySnapshot();
      if (res.ok) {
        toast.success(t.financialReviewSavedToast);
        onOpenChange(false);
      } else {
        toast.error(res.error);
      }
    } finally {
      setSavingArchive(false);
    }
  }, [
    applyDraftBalancesAsync,
    onOpenChange,
    persistMonthlySnapshot,
    t.financialReviewSavedToast,
  ]);
  const saveArchive = useCallback(async () => {
    if (!pendingOverwrite) {
      const { count, error } = await supabase
        .from("monthly_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId)
        .eq("review_month", reviewMonth);
      if (error) {
        toast.error(error.message);
        return;
      }
      if ((count ?? 0) > 0) {
        setOverwriteConfirmOpen(true);
        return;
      }
    }
    await saveArchiveNow();
    setPendingOverwrite(false);
  }, [householdId, pendingOverwrite, reviewMonth, saveArchiveNow]);

  const runMonthCloseArchive = useCallback(
    async (goalsPatched: SavingsGoal[]) => {
      setSavingArchive(true);
      try {
        const assetsOk = await applyDraftBalancesAsync();
        if (!assetsOk) return;
        const snap = await persistMonthlySnapshot(goalsPatched);
        if (snap.ok) {
          void fireSavingsGoalConfetti();
          toast.success(t.financialReviewMonthCloseCelebrateToast);
          onOpenChange(false);
        } else {
          toast.error(snap.error);
        }
      } finally {
        setSavingArchive(false);
      }
    },
    [
      applyDraftBalancesAsync,
      onOpenChange,
      persistMonthlySnapshot,
      t.financialReviewMonthCloseCelebrateToast,
    ],
  );

  const submitReviewIncomeLine = useCallback(async () => {
    if (!incomeSources.length) {
      toast.error(t.financialReviewIncomeNeedCategory);
      return;
    }
    if (!defaultIncomeDestinationId) {
      toast.error(t.financialReviewIncomeNeedDestination);
      return;
    }
    const amtRaw = parseNumericInput(incomeDraftAmount.trim());
    const amt =
      amtRaw != null && Number.isFinite(amtRaw) ? Math.round(Math.abs(amtRaw) * 100) / 100 : 0;
    if (amt <= 0) {
      toast.error(t.savingsGoalDepositAmountInvalid);
      return;
    }
    const catId = incomeDraftCategoryId || incomeSources[0]!.id;
    if (!incomeSources.some((c) => c.id === catId)) {
      toast.error(t.financialReviewIncomeNeedCategory);
      return;
    }
    const note = incomeDraftLabel.trim();
    /** Book exactly on the user-picked date (default is a date inside the reviewed month). */
    const incomeDate = /^\d{4}-\d{2}-\d{2}$/.test(incomeDraftDate)
      ? incomeDraftDate
      : isoDateInYearMonth(reviewMonth, new Date());
    await prefetchFxRate(incomeDraftCurrency.trim() || DEFAULT_CURRENCY, incomeDate);
    setIncomeSaving(true);
    try {
      const res = await addExpense({
        date: incomeDate,
        amount: amt,
        currency: incomeDraftCurrency.trim() || DEFAULT_CURRENCY,
        categoryId: catId,
        paymentMethodId: defaultIncomeDestinationId,
        note,
        type: "income",
        installments: 1,
        installmentIndex: 1,
        recurringMonthly: false,
      });
      if (res.ok) {
        toast.success(
          t.financialReviewIncomeAddedToast.replace("{{month}}", monthTitle),
        );
        setIncomeFormOpen(false);
        setIncomeDraftAmount("");
        setIncomeDraftLabel("");
        setIncomeDraftCategoryId(incomeSources[0]?.id ?? "");
        setIncomeDraftDate(isoDateInYearMonth(reviewMonth, new Date()));
      } else {
        toast.error(res.error);
      }
    } finally {
      setIncomeSaving(false);
    }
  }, [
    addExpense,
    defaultIncomeDestinationId,
    incomeDraftAmount,
    incomeDraftCategoryId,
    incomeDraftCurrency,
    incomeDraftDate,
    incomeDraftLabel,
    incomeSources,
    monthTitle,
    reviewMonth,
    t.financialReviewIncomeAddedToast,
    t.financialReviewIncomeNeedCategory,
    t.financialReviewIncomeNeedDestination,
    t.savingsGoalDepositAmountInvalid,
  ]);
  const markExpenseReviewed = useCallback(
    async (id: string) => {
      setReconBusyId(id);
      try {
        const res = await updateExpenseAsync(id, { isReviewed: true });
        if (!res.ok) toast.error(res.error);
        else
          setReconSelectedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
      } finally {
        setReconBusyId(null);
      }
    },
    [updateExpenseAsync],
  );

  const markExpenseUnreviewed = useCallback(
    async (id: string) => {
      setReconBusyId(id);
      try {
        const res = await updateExpenseAsync(id, { isReviewed: false });
        if (!res.ok) toast.error(res.error);
      } finally {
        setReconBusyId(null);
      }
    },
    [updateExpenseAsync],
  );

  const approveSelectedRecon = useCallback(async () => {
    const ids = [...reconSelectedIds];
    if (ids.length === 0) return;
    setReconBulkBusy(true);
    try {
      for (const id of ids) {
        const res = await updateExpenseAsync(id, { isReviewed: true });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
      }
      setReconSelectedIds(new Set());
    } finally {
      setReconBulkBusy(false);
    }
  }, [reconSelectedIds, updateExpenseAsync]);
  const addMissingExpense = useCallback(async () => {
    const parsed = parseNumericInput(missingAmount);
    const amount = parsed != null && Number.isFinite(parsed) ? Math.round(Math.abs(parsed) * 100) / 100 : 0;
    if (amount <= 0) return toast.error(lang === "he" ? "סכום לא תקין" : "Invalid amount");
    const categoryId =
      missingCategoryId || (missingType === "income" ? incomeSources[0]?.id : expenseCategories[0]?.id) || "";
    if (!categoryId) return toast.error(lang === "he" ? "בחר קטגוריה" : "Pick a category");
    const defaultPayer =
      missingType === "income" ? destinationAccounts[0]?.id : paymentMethods[0]?.id;
    const paymentMethodId = missingPayerId || defaultPayer || "";
    if (!paymentMethodId) {
      return toast.error(
        missingType === "income"
          ? lang === "he"
            ? "הוסיפו חשבון יעד בהגדרות"
            : "Add a destination account in settings"
          : lang === "he"
            ? "הוסיפו אמצעי תשלום בהגדרות"
            : "Add a payment method in settings",
      );
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(missingDate)
      ? missingDate
      : isoDateInYearMonth(reviewMonth, new Date());
    setMissingSaving(true);
    try {
      const res = await addExpense({
        date,
        amount,
        currency: DEFAULT_CURRENCY,
        categoryId,
        paymentMethodId,
        note: missingNote.trim(),
        type: missingType,
        installments: 1,
        installmentIndex: 1,
        recurringMonthly: false,
      });
      if (!res.ok) return toast.error(res.error);
      setMissingAmount("");
      setMissingNote("");
      setMissingOpen(false);
    } finally {
      setMissingSaving(false);
    }
  }, [
    addExpense,
    destinationAccounts,
    expenseCategories,
    incomeSources,
    lang,
    missingAmount,
    missingCategoryId,
    missingDate,
    missingNote,
    missingPayerId,
    missingType,
    paymentMethods,
    reviewMonth,
  ]);

  useEffect(() => {
    if (!missingOpen) return;
    const payers = missingType === "income" ? destinationAccounts : paymentMethods;
    if (payers.length && !payers.some((p) => p.id === missingPayerId)) {
      setMissingPayerId(payers[0]!.id);
    }
    const cats = missingType === "income" ? incomeSources : expenseCategories;
    if (cats.length && !cats.some((c) => c.id === missingCategoryId)) {
      setMissingCategoryId(cats[0]!.id);
    }
  }, [
    missingOpen,
    missingType,
    destinationAccounts,
    paymentMethods,
    incomeSources,
    expenseCategories,
    missingPayerId,
    missingCategoryId,
  ]);

  const missingCategoryOptionsList =
    missingType === "income" ? incomeSources : expenseCategories;
  const missingPayerOptionsList =
    missingType === "income" ? destinationAccounts : paymentMethods;
  const selectedMissingCategoryRow =
    missingCategoryOptionsList.find((c) => c.id === missingCategoryId) ?? null;
  const selectedMissingPayerRow =
    missingPayerOptionsList.find((p) => p.id === missingPayerId) ?? null;

  const runDeposit = useCallback(
    async (goalId: string, raw: string, closeAfterMonthClose?: boolean) => {
      const p = parseNumericInput(raw);
      const amt = p != null && Number.isFinite(p) ? Math.ceil(p) : 0;
      if (amt <= 0) {
        toast.error(t.savingsGoalDepositAmountInvalid);
        return;
      }
      setDepositing(goalId);
      try {
        const res = await depositAmount(goalId, amt);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // Prevent duplicate suggestions in this month-close session after a successful deposit.
        await refreshSavingsGoals();
        const g = goals.find((x) => x.id === goalId);
        const goalsPatched = g
          ? goals.map((x) =>
              x.id === goalId
                ? {
                    ...x,
                    currentAmount: Math.round((x.currentAmount + amt) * 100) / 100,
                    monthlyCurrent: Math.round((x.monthlyCurrent + amt) * 100) / 100,
                  }
                : x,
            )
          : goals;
        if (g?.isInvestmentPortfolio) {
          setInvDepositFollowUp({
            goalId,
            closeAfterMonthClose: !!closeAfterMonthClose,
            goalsPatched,
            reachedTarget: res.reachedTarget,
          });
          return;
        }
        if (closeAfterMonthClose) {
          await runMonthCloseArchive(goalsPatched);
        } else {
          toast.success(t.savingsGoalDepositedToast);
          if (res.reachedTarget) void fireSavingsGoalConfetti();
        }
      } finally {
        setDepositing(null);
      }
    },
    [depositAmount, goals, refreshSavingsGoals, runMonthCloseArchive, t],
  );

  const onInvTransferConfirmed = useCallback(
    async (physicallyTransferred: boolean) => {
      const ctx = invDepositFollowUp;
      if (!ctx) return;
      setInvDepositFollowUp(null);
      if (physicallyTransferred) {
        await updateGoal(ctx.goalId, { monthlyInvestmentTransferAck: true });
      }
      if (ctx.closeAfterMonthClose) {
        await runMonthCloseArchive(ctx.goalsPatched);
      } else {
        toast.success(t.savingsGoalDepositedToast);
        if (physicallyTransferred || ctx.reachedTarget) void fireSavingsGoalConfetti();
      }
    },
    [invDepositFollowUp, runMonthCloseArchive, t.savingsGoalDepositedToast, updateGoal],
  );

  const stepLabels = [
    t.financialReviewStepAssets,
    t.financialReviewReconStep,
    t.financialReviewStepSummary,
    t.financialReviewStepSurplus,
  ];

  const goToStep = useCallback((i: number) => {
    setStep(Math.max(0, Math.min(3, i)));
  }, []);

  const saveAssetBalances = useCallback(async () => {
    if (!displayAssets.length) return;
    setAssetStepBusy(true);
    try {
      const ok = await applyDraftBalancesAsync();
      if (ok) toast.success(t.financialReviewAssetsSavedToast);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAssetStepBusy(false);
    }
  }, [
    applyDraftBalancesAsync,
    displayAssets.length,
    t.financialReviewAssetsSavedToast,
  ]);

  const goNext = () => void goToStep(step + 1);

  const goBack = () => void goToStep(step - 1);

  if (!isValidHouseholdCode(householdId)) return null;

  const deficitAmountLabel = formatIlsWholeCeil(Math.abs(surplus));

  const compassSplitAngle =
    compassAllocation.amountToSavings + compassAllocation.amountToInvestment > 0.009
      ? (compassAllocation.amountToSavings /
          (compassAllocation.amountToSavings + compassAllocation.amountToInvestment)) *
        180
      : 90;

  return (
    <>
    <Dialog open={open} onOpenChange={handleFinancialReviewDialogOpenChange}>
      <DialogContent
        className="no-scrollbar max-h-[min(92dvh,760px)] gap-0 overflow-y-auto rounded-[1.75rem] border-border/50 p-0 shadow-xl sm:max-w-lg"
        dir={dir}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          requestCloseFinancialReview();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestCloseFinancialReview();
        }}
      >
        <DialogHeader className="space-y-2 border-b border-border/40 px-8 py-10">
          <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
            {t.financialReviewModalTitle}
          </DialogTitle>
          <p className="text-sm font-normal leading-relaxed text-muted-foreground">
            {t.financialReviewMonthLabel.replace("{{month}}", monthTitle)}
          </p>
        </DialogHeader>

        <div className="px-8 py-10">
          <ol className="mb-12 flex justify-between gap-4">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => void goToStep(i)}
                  disabled={assetStepBusy}
                  aria-label={t.financialReviewStepperGoTo
                    .replace("{{n}}", String(i + 1))
                    .replace("{{label}}", stepLabels[i] ?? "")}
                  aria-current={step === i ? "step" : undefined}
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300",
                    "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    step === i
                      ? "scale-105 bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-2 ring-primary/35 ring-offset-2 ring-offset-background"
                      : step > i
                        ? "bg-primary/15 text-primary hover:bg-primary/25"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {i + 1}
                </button>
                <span
                  className={cn(
                    "text-center text-[11px] font-medium leading-snug",
                    step === i ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {stepLabels[i]}
                </span>
              </li>
            ))}
          </ol>

          <div key={step} className="animate-financial-review-step space-y-10">
            {step === 0 ? (
              <>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t.financialReviewAssetsHint}
                </p>
                {assetsLoading ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t.financialReviewLoadingAssets}
                  </p>
                ) : displayAssets.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {lang === "he" ? "אין נכסים להצגה." : "No assets yet."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-6">
                    <details className="rounded-2xl border border-border/20 bg-muted/10 p-4 sm:p-5">
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">
                        {t.financialReviewAssetsPrevMonthTitle.replace(
                          "{{month}}",
                          lang === "he" ? hebrewMonthYearLabel(reviewMonth) : reviewMonth,
                        )}
                      </summary>
                      <ul className="mt-5 flex flex-col gap-6">
                        {displayAssets.map((a) => {
                          const prevVal = prevMonthBalanceByBase[a.baseId];
                          return (
                            <li
                              key={`prev-${a.baseId}`}
                              className="flex flex-col gap-3 border-b border-border/25 pb-6 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <div
                                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted/40"
                                  style={
                                    a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)
                                      ? { backgroundColor: `${a.color}22` }
                                      : undefined
                                  }
                                >
                                  <AssetTypeIcon type={a.type} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                  <p className="break-words text-[15px] font-medium leading-snug text-foreground sm:truncate">
                                    {a.name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {assetTypeLabel(a, assetTypes, lang)}
                                  </p>
                                </div>
                              </div>
                              <p
                                className="flex h-11 w-full min-w-0 items-center justify-end rounded-xl border border-transparent bg-background/40 px-3 text-[15px] font-medium tabular-nums text-foreground sm:w-auto sm:min-w-[6.5rem] sm:shrink-0"
                                dir="ltr"
                              >
                                {prevVal != null ? formatIlsWholeCeil(prevVal) : "—"}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </details>

                    <details className="rounded-2xl border border-border/20 bg-muted/10 p-4 sm:p-5" open>
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">
                        {t.financialReviewAssetsCurrMonthTitle.replace(
                          "{{month}}",
                          calendarMonthTitle,
                        )}
                      </summary>
                      <ul className="mt-5 flex flex-col gap-6">
                        {displayAssets.map((a) => {
                          const inputCcy = canonicalCurrencyCode(
                            balanceInputCurrency[a.baseId] || a.currency || "ILS",
                            currencies,
                          );
                          const draftN = draftBalances[a.baseId];
                          const fallbackBal = a.balance;
                          const amountForDisplay =
                            typeof draftN === "number" && Number.isFinite(draftN)
                              ? draftN
                              : typeof fallbackBal === "number" && Number.isFinite(fallbackBal)
                                ? round2(fallbackBal)
                                : 0;
                          const textValue =
                            draftBalanceInputText[a.baseId] ??
                            formatNumericInput(String(amountForDisplay));
                          return (
                            <li
                              key={`curr-${a.baseId}`}
                              className="flex flex-col gap-3 border-b border-border/25 pb-6 transition-opacity duration-200 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <div
                                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted/40"
                                  style={
                                    a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)
                                      ? { backgroundColor: `${a.color}22` }
                                      : undefined
                                  }
                                >
                                  <AssetTypeIcon type={a.type} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                  <p className="break-words text-[15px] font-medium leading-snug text-foreground sm:truncate">
                                    {a.name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {assetTypeLabel(a, assetTypes, lang)}
                                  </p>
                                </div>
                              </div>
                              <div
                                className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:max-w-none sm:shrink-0"
                                dir="ltr"
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-9 shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
                                  disabled={trashBusyBaseId === a.baseId || assetStepBusy}
                                  aria-label={t.financialReviewTrashRemoveAssetFromMonth}
                                  onClick={() => void onTrashAssetRow(a)}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                                <Select
                                  value={inputCcy}
                                  onValueChange={(code) => {
                                    const norm = canonicalCurrencyCode(code, currencies);
                                    setBalanceInputCurrency((prev) => ({
                                      ...prev,
                                      [a.baseId]: norm,
                                    }));
                                  }}
                                >
                                  <SelectTrigger
                                    dir="ltr"
                                    className="h-11 w-[4.75rem] shrink-0 rounded-xl px-2.5 text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent position="popper" dir="ltr">
                                    {assetStepCurrencyOptions.map((c) => (
                                      <SelectItem key={c.code} value={c.code} textValue={c.code}>
                                        <SelectItemText>{c.code}</SelectItemText>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  className="h-11 min-w-0 flex-1 rounded-xl border border-border/25 bg-background/80 text-end text-[15px] tabular-nums focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-[7.5rem] sm:flex-none sm:shrink-0"
                                  value={textValue}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const formatted = formatNumericInput(raw);
                                    setDraftBalanceInputText((prev) => ({
                                      ...prev,
                                      [a.baseId]: formatted,
                                    }));
                                    const p = parseNumericInput(formatted);
                                    if (p != null && Number.isFinite(p)) {
                                      setDraftBalances((prev) => ({
                                        ...prev,
                                        [a.baseId]: round2(p),
                                      }));
                                    }
                                  }}
                                  aria-label={a.name}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                    <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-xl"
                        disabled={
                          assetStepBusy || assetsLoading || displayAssets.length === 0
                        }
                        onClick={() => void saveAssetBalances()}
                      >
                        {t.financialReviewAssetsSaveChanges}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {step === 1 ? (
              <div className="space-y-6" dir={dir}>
                {/* Progress */}
                <div className="space-y-2.5 rounded-2xl border border-border/30 bg-muted/20 p-4 transition-all duration-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                      {t.financialReviewReconProgress}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.financialReviewReconProgressCount
                        .replace("{{reviewed}}", String(reviewedRows.length))
                        .replace("{{total}}", String(rows.length))}{" "}
                      ({reviewProgressPct}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted/70 shadow-inner">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-primary via-primary/90 to-primary/70 shadow-sm transition-all duration-500 ease-out"
                      style={{ width: `${reviewProgressPct}%` }}
                    />
                  </div>
                </div>

                {/* Filters — History-style toolbar */}
                <div className="-mx-1 rounded-2xl border border-border/50 bg-gradient-to-b from-muted/30 to-background px-3 py-3 sm:px-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t.financialReviewReconToolbarFilters}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="fr-recon-search" className="text-xs font-medium text-muted-foreground">
                        {t.searchNotes}
                      </Label>
                      <Input
                        id="fr-recon-search"
                        type="search"
                        placeholder={t.searchNotesPlaceholder}
                        value={reconSearch}
                        onChange={(e) => setReconSearch(e.target.value)}
                        autoComplete="off"
                        className="h-10 rounded-xl"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">{t.category}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" className="h-10 w-full justify-between rounded-xl">
                            <span className="truncate">{reconCategoryFilterSummary}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2" dir={dir}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={() => setReconCategoryFilters([])}
                          >
                            <span>{t.allCategories}</span>
                            {reconCategoryFilters.length === 0 ? <Check className="size-4" aria-hidden /> : null}
                          </button>
                          <div className="my-2 h-px bg-border/70" />
                          <p className="px-2 py-1 text-xs text-muted-foreground">{t.historyGroupIncome}</p>
                          <button
                            type="button"
                            className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={toggleAllReconIncomeCategories}
                          >
                            <span>{t.historyTypeIncome}</span>
                            {incomeCategoryValuesRecon.length > 0 &&
                            incomeCategoryValuesRecon.every((v) => reconCategoryFilterSet.has(v)) ? (
                              <Check className="size-4" aria-hidden />
                            ) : null}
                          </button>
                          {visibleReconIncomeCategories.map((c) => {
                            const value = `${RECON_INC_PREFIX}${c.id}`;
                            const label = localizedIncomeSourceName(c.id, c.name, lang);
                            const on = reconCategoryFilterSet.has(value);
                            return (
                              <button
                                key={`fr-inc-${c.id}`}
                                type="button"
                                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                                onClick={() => toggleReconCategoryFilter(value)}
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
                          {incomeSources.length > RECON_CATEGORY_PREVIEW_LIMIT ? (
                            <button
                              type="button"
                              className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-accent"
                              onClick={() => setReconShowAllIncomeCats((v) => !v)}
                            >
                              {reconShowAllIncomeCats ? t.iconPickerHide : t.iconPickerShowMore}
                            </button>
                          ) : null}
                          <div className="my-2 h-px bg-border/70" />
                          <p className="px-2 py-1 text-xs text-muted-foreground">{t.historyGroupExpense}</p>
                          <button
                            type="button"
                            className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={toggleAllReconExpenseCategories}
                          >
                            <span>{t.historyTypeExpense}</span>
                            {expenseCategoryValuesRecon.length > 0 &&
                            expenseCategoryValuesRecon.every((v) => reconCategoryFilterSet.has(v)) ? (
                              <Check className="size-4" aria-hidden />
                            ) : null}
                          </button>
                          {visibleReconExpenseCategories.map((c) => {
                            const value = `${RECON_EXP_PREFIX}${c.id}`;
                            const label = localizedExpenseCategoryName(c.id, c.name, lang);
                            const on = reconCategoryFilterSet.has(value);
                            return (
                              <button
                                key={`fr-exp-${c.id}`}
                                type="button"
                                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                                onClick={() => toggleReconCategoryFilter(value)}
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
                          {expenseCategories.length > RECON_CATEGORY_PREVIEW_LIMIT ? (
                            <button
                              type="button"
                              className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-accent"
                              onClick={() => setReconShowAllExpenseCats((v) => !v)}
                            >
                              {reconShowAllExpenseCats ? t.iconPickerHide : t.iconPickerShowMore}
                            </button>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">{t.paymentMethod}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" className="h-10 w-full justify-between rounded-xl">
                            <span className="truncate">{reconPayerFilterSummary}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2" dir={dir}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={() => setReconPayerFilters([])}
                          >
                            <span>{t.financialReviewReconFilterAllPayers}</span>
                            {reconPayerFilters.length === 0 ? <Check className="size-4" aria-hidden /> : null}
                          </button>
                          <button
                            type="button"
                            className="mb-2 mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                            onClick={toggleAllReconPayers}
                          >
                            <span>{t.financialReviewReconPayerSelectAll}</span>
                            {allPayerIdsRecon.length > 0 &&
                            reconPayerFilters.length === allPayerIdsRecon.length ? (
                              <Check className="size-4" aria-hidden />
                            ) : null}
                          </button>
                          <div className="my-2 h-px bg-border/70" />
                          {visibleReconPayers.map((p) => {
                            const on = reconPayerFilterSet.has(p.id);
                            const label =
                              p.payerKind === "dest"
                                ? localizedDestinationAccountName(p.id, p.name, lang)
                                : localizedPaymentMethodName(p.id, p.name, lang);
                            return (
                              <button
                                key={`fr-pay-${p.id}`}
                                type="button"
                                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                                onClick={() => toggleReconPayerFilter(p.id)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <CategoryGlyph iconKey={p.iconKey} className="size-3.5" />
                                  <ColorBadge color={p.color} />
                                  <span className="truncate">{label}</span>
                                </span>
                                {on ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                              </button>
                            );
                          })}
                          {paymentMethods.length + destinationAccounts.length > 10 ? (
                            <button
                              type="button"
                              className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-accent"
                              onClick={() => setReconShowAllPayers((v) => !v)}
                            >
                              {reconShowAllPayers ? t.iconPickerHide : t.iconPickerShowMore}
                            </button>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor="fr-recon-sort" className="text-xs font-medium text-muted-foreground">
                        {t.historySortLabel}
                      </Label>
                      <Select value={reconSort} onValueChange={(v) => setReconSort(v as typeof reconSort)}>
                        <SelectTrigger
                          id="fr-recon-sort"
                          className="min-h-10 w-full rounded-xl focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                        >
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

                {reconSelectedIds.size > 0 ? (
                  <Button
                    type="button"
                    className="h-11 w-full rounded-xl transition-all duration-300"
                    disabled={reconBulkBusy}
                    onClick={() => void approveSelectedRecon()}
                  >
                    {t.financialReviewReconApproveSelected.replace("{{n}}", String(reconSelectedIds.size))}
                  </Button>
                ) : null}

                {/* Unreviewed list */}
                {unreviewedRows.length === 0 && rows.length > 0 ? (
                  <div className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] py-14 text-center dark:bg-emerald-500/10">
                    <CheckCircle2 className="size-16 text-emerald-500 drop-shadow-sm" aria-hidden />
                    <p className="max-w-xs text-base font-medium text-emerald-800 dark:text-emerald-300">
                      {t.financialReviewReconEmpty}
                    </p>
                  </div>
                ) : filteredUnreviewedRows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{t.financialReviewReconNoFilterResults}</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-3">
                      {(reconShowAll ? filteredUnreviewedRows : filteredUnreviewedRows.slice(0, 8)).map((e) => {
                        const rowType = normalizeReconEntryType(e);
                        let cat: ReturnType<typeof resolveTransactionCategory> = null;
                        try {
                          cat = resolveTransactionCategory(
                            e.categoryId,
                            rowType,
                            expenseCategories,
                            incomeSources,
                          );
                        } catch {
                          cat = null;
                        }
                        const catLabel = cat
                          ? rowType === "income"
                            ? localizedIncomeSourceName(cat.id, cat.name, lang)
                            : localizedExpenseCategoryName(cat.id, cat.name, lang)
                          : null;
                        const pm = paymentMethods.find((p) => p.id === e.paymentMethodId);
                        const da = destinationAccounts.find((p) => p.id === e.paymentMethodId);
                        const payerLabel = pm
                          ? localizedPaymentMethodName(pm.id, pm.name, lang)
                          : da
                            ? localizedDestinationAccountName(da.id, da.name, lang)
                            : null;
                        const categoryTitle = catLabel ?? "—";
                        const noteSubtitle =
                          typeof e.note === "string" && e.note.trim() ? e.note.trim() : null;
                        const dateStr = typeof e.date === "string" ? e.date : "";
                        const dateLabel = dateStr ? formatDateDDMMYYYY(dateStr) : "—";
                        const { installments: instCount, installmentIndex: instIdx } = safeReconInstallments(e);
                        const isProjectedRecurring = parseProjectedRecurringId(e.id) != null;
                        const installmentText =
                          rowType === "expense" && instCount > 1 && !isProjectedRecurring
                            ? t.historyInstallmentText
                                .replace("{{index}}", String(instIdx))
                                .replace("{{total}}", String(instCount))
                            : null;
                        const recurringBadge = e.recurringMonthly === true || isProjectedRecurring;
                        const currencyCode =
                          typeof e.currency === "string" && e.currency.trim() ? e.currency : "ILS";
                        const amountSafe =
                          typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : 0;
                        const checked = reconSelectedIds.has(e.id);
                        return (
                          <li key={e.id} className="w-full">
                            <div
                              dir={dir}
                              className={cn(
                                "flex w-full items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-all duration-300",
                              )}
                            >
                              {/* Data anchored to the right in RTL (first flex group) */}
                              <div className="flex min-w-0 flex-1 items-center gap-4">
                                <label className="flex shrink-0 cursor-pointer items-center">
                                  <input
                                    type="checkbox"
                                    className="size-4 rounded border-input text-primary accent-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:ring-offset-0"
                                    checked={checked}
                                    onChange={() =>
                                      setReconSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(e.id)) next.delete(e.id);
                                        else next.add(e.id);
                                        return next;
                                      })
                                    }
                                    aria-label={t.financialReviewReconApproveBtn}
                                  />
                                </label>

                                {cat ? (
                                  <span
                                    className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground"
                                    style={{
                                      backgroundColor: colorWithAlpha(cat.color, "1A") ?? undefined,
                                    }}
                                  >
                                    <span
                                      className="absolute start-1.5 top-1.5 size-2 rounded-full bg-muted-foreground/50"
                                      style={{
                                        backgroundColor:
                                          typeof cat.color === "string" &&
                                          /^#[0-9a-fA-F]{6}$/.test(cat.color)
                                            ? cat.color
                                            : undefined,
                                      }}
                                      aria-hidden
                                    />
                                    <CategoryGlyph iconKey={cat.iconKey} className="size-4" />
                                  </span>
                                ) : (
                                  <span className="size-10 shrink-0 rounded-full bg-muted/70" />
                                )}

                                <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1.5 text-start">
                                  <div className="flex min-w-0 max-w-full items-center gap-2">
                                    <span className="min-w-0 truncate text-base font-medium text-foreground">
                                      {categoryTitle}
                                    </span>
                                    {recurringBadge ? (
                                      <span className="shrink-0 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        {rowType === "income" ? t.recurringIncome : t.recurringExpense}
                                      </span>
                                    ) : null}
                                    {instCount > 1 ? (
                                      <span className="shrink-0 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        {t.financialReviewReconInstallmentsShort}
                                      </span>
                                    ) : null}
                                  </div>
                                  {noteSubtitle ? (
                                    <p className="line-clamp-2 w-full max-w-full break-words text-sm leading-snug text-muted-foreground">
                                      {noteSubtitle}
                                    </p>
                                  ) : null}
                                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                                    {payerLabel ? (
                                      <span className="min-w-0 truncate">{payerLabel}</span>
                                    ) : null}
                                    {payerLabel ? (
                                      <span className="shrink-0 text-muted-foreground/45" aria-hidden>
                                        •
                                      </span>
                                    ) : null}
                                    <span className="shrink-0 tabular-nums" dir="ltr">
                                      {dateLabel}
                                    </span>
                                    {installmentText ? (
                                      <>
                                        <span className="shrink-0 text-muted-foreground/45" aria-hidden>
                                          •
                                        </span>
                                        <span className="min-w-0 truncate">{installmentText}</span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              {/* Amount + approve on the opposite side (left in RTL) */}
                              <div className="flex shrink-0 flex-col items-end gap-2" dir="ltr">
                                <span
                                  className={cn(
                                    "whitespace-nowrap text-end text-base font-medium tabular-nums",
                                    rowType === "income" ? "text-green-500" : "text-red-500",
                                  )}
                                >
                                  {rowType === "income" ? "+ " : "- "}
                                  {formatIls(convertToILS(amountSafe, currencyCode, dateStr || "1970-01-01"))}
                                </span>
                                {!isShekelCurrency(currencyCode, currencies) ? (
                                  <span className="whitespace-nowrap text-end text-sm tabular-nums text-muted-foreground">
                                    {formatCurrencyCompact(amountSafe, currencyCode, currencies)}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className={cn(
                                    "inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-transparent px-2.5 py-1 text-xs font-medium text-primary transition-colors",
                                    "hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 focus-visible:ring-offset-0",
                                    "disabled:pointer-events-none disabled:opacity-50",
                                  )}
                                  disabled={reconBusyId === e.id || reconBulkBusy}
                                  onClick={() => void markExpenseReviewed(e.id)}
                                >
                                  <Check className="size-3.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
                                  {t.financialReviewReconApproveBtn}
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {filteredUnreviewedRows.length > 8 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full rounded-xl text-sm"
                        onClick={() => setReconShowAll((v) => !v)}
                      >
                        {reconShowAll ? t.financialReviewReconShowLess : `${t.financialReviewReconShowMore} (${filteredUnreviewedRows.length - 8})`}
                      </Button>
                    ) : null}
                  </>
                )}

                {/* ── Reviewed accordion ── */}
                {reviewedRows.length > 0 ? (
                  <details
                    className="rounded-2xl border border-border/25 bg-muted/10 transition-all duration-300"
                    open={reviewedOpen}
                    onToggle={(ev) => setReviewedOpen(ev.currentTarget.open)}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                        {t.financialReviewReconReviewedSection}
                      </span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {reviewedRows.length}
                      </span>
                    </summary>
                    <ul className="flex flex-col divide-y divide-border/20 px-4 pb-3">
                      {reviewedRows.map((e) => {
                        const rowType = normalizeReconEntryType(e);
                        let cat: ReturnType<typeof resolveTransactionCategory> = null;
                        try {
                          cat = resolveTransactionCategory(
                            e.categoryId,
                            rowType,
                            expenseCategories,
                            incomeSources,
                          );
                        } catch {
                          cat = null;
                        }
                        const catLabel = cat
                          ? rowType === "income"
                            ? localizedIncomeSourceName(cat.id, cat.name, lang)
                            : localizedExpenseCategoryName(cat.id, cat.name, lang)
                          : null;
                        const categoryTitleRv = catLabel ?? "—";
                        const noteSubtitleRv =
                          typeof e.note === "string" && e.note.trim() ? e.note.trim() : null;
                        const ilsAmt = convertToILS(e.amount, e.currency ?? "ILS", rateDate);
                        return (
                          <li key={`rv-${e.id}`} className="flex items-center justify-between gap-2 py-2.5">
                            <span className="flex min-w-0 flex-1 items-start gap-2">
                              {cat ? (
                                <span
                                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/50"
                                  style={{
                                    backgroundColor: colorWithAlpha(cat.color, "22") ?? undefined,
                                  }}
                                >
                                  <CategoryGlyph iconKey={cat.iconKey} className="size-3.5" />
                                </span>
                              ) : null}
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {categoryTitleRv}
                                </span>
                                <span className="min-h-[1.25rem] text-xs text-muted-foreground">
                                  {noteSubtitleRv ? (
                                    <span className="line-clamp-2 break-words">{noteSubtitleRv}</span>
                                  ) : null}
                                </span>
                              </span>
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                dir="ltr"
                                className={cn(
                                  "text-sm font-semibold tabular-nums",
                                  rowType === "income"
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400",
                                )}
                              >
                                {rowType === "income" ? "+" : "−"}
                                {formatIlsWholeCeil(ilsAmt)}
                              </span>
                              <button
                                type="button"
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground"
                                aria-label={t.financialReviewReconUndoAria}
                                disabled={reconBusyId === e.id}
                                onClick={() => void markExpenseUnreviewed(e.id)}
                              >
                                <ArrowLeft className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden />
                                <span className="max-sm:sr-only">{t.financialReviewReconUndo}</span>
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}

                {/* ── Add Missing Expense form ── */}
                <div className="overflow-hidden rounded-2xl border border-dashed border-primary/35 bg-gradient-to-br from-primary/[0.04] via-background to-primary/[0.02] shadow-sm transition-all duration-300">
                  {!missingOpen ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 px-4 py-4 text-sm font-medium text-primary transition-colors duration-200 hover:bg-primary/8"
                      onClick={() => {
                        setMissingOpen(true);
                        setMissingType("expense");
                        setMissingCategoryId(expenseCategories[0]?.id ?? "");
                        setMissingPayerId(paymentMethods[0]?.id ?? "");
                        setMissingDate(isoDateInYearMonth(reviewMonth, new Date()));
                      }}
                    >
                      <Plus className="size-4" aria-hidden />
                      {t.financialReviewReconAddMissing}
                    </button>
                  ) : (
                    <div className="space-y-4 px-4 py-5 sm:px-5">
                      <p className="text-center text-sm font-semibold text-foreground sm:text-start">
                        {t.financialReviewReconAddMissingTitle}
                      </p>
                      {/* Row 1: Type toggle */}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">{t.financialReviewReconMissingType}</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {(["expense", "income"] as const).map((tp) => (
                            <button
                              key={tp}
                              type="button"
                              onClick={() => {
                                setMissingType(tp);
                                if (tp === "income") {
                                  setMissingCategoryId(incomeSources[0]?.id ?? "");
                                  setMissingPayerId(destinationAccounts[0]?.id ?? "");
                                } else {
                                  setMissingCategoryId(expenseCategories[0]?.id ?? "");
                                  setMissingPayerId(paymentMethods[0]?.id ?? "");
                                }
                              }}
                              className={cn(
                                "rounded-xl border py-2.5 text-sm font-medium transition-all duration-200",
                                missingType === tp
                                  ? "border-primary bg-primary/12 text-primary shadow-sm"
                                  : "border-border/40 bg-background text-muted-foreground hover:bg-muted/50",
                              )}
                            >
                              {tp === "expense" ? t.entryExpense : t.entryIncome}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Row 2: Note + Amount */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="fr-mis-note" className="text-xs text-muted-foreground">{t.financialReviewReconMissingNote}</Label>
                          <Input
                            id="fr-mis-note"
                            value={missingNote}
                            onChange={(e) => setMissingNote(e.target.value)}
                            className="h-10 rounded-xl focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="fr-mis-amt" className="text-xs text-muted-foreground">{t.financialReviewReconMissingAmount}</Label>
                          <Input
                            id="fr-mis-amt"
                            dir="ltr"
                            inputMode="decimal"
                            className="h-10 rounded-xl text-end tabular-nums focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                            value={missingAmount}
                            onChange={(e) => setMissingAmount(formatNumericInput(e.target.value))}
                          />
                        </div>
                      </div>
                      {/* Row 3: Category + Payer */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {t.financialReviewReconMissingCategory}
                          </Label>
                          <Select value={missingCategoryId} onValueChange={setMissingCategoryId}>
                            <SelectTrigger
                              className="min-h-10 w-full rounded-xl focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                            >
                              <span className="flex min-w-0 flex-1 items-center gap-3">
                                <span className="flex shrink-0 items-center gap-1.5">
                                  {selectedMissingCategoryRow ? (
                                    <>
                                      <CategoryGlyph
                                        iconKey={selectedMissingCategoryRow.iconKey}
                                        className="size-3.5 shrink-0"
                                      />
                                      <ColorBadge color={selectedMissingCategoryRow.color} />
                                    </>
                                  ) : null}
                                </span>
                                <SelectValue placeholder={t.financialReviewReconMissingCategory} />
                              </span>
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {missingCategoryOptionsList.map((c) => {
                                const clabel =
                                  missingType === "income"
                                    ? localizedIncomeSourceName(c.id, c.name, lang)
                                    : localizedExpenseCategoryName(c.id, c.name, lang);
                                return (
                                  <SelectItem key={c.id} value={c.id} textValue={clabel}>
                                    <span className="flex min-w-0 items-center gap-3">
                                      <span className="flex shrink-0 items-center gap-1.5">
                                        <CategoryGlyph iconKey={c.iconKey} className="size-3.5" />
                                        <ColorBadge color={c.color} />
                                      </span>
                                      <SelectItemText className="min-w-0">{clabel}</SelectItemText>
                                    </span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {missingType === "income" ? t.destinationAccount : t.paymentMethod}
                          </Label>
                          <Select value={missingPayerId} onValueChange={setMissingPayerId}>
                            <SelectTrigger
                              className="min-h-10 w-full rounded-xl focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                            >
                              <span className="flex min-w-0 flex-1 items-center gap-3">
                                <span className="flex shrink-0 items-center gap-1.5">
                                  {selectedMissingPayerRow ? (
                                    <>
                                      <CategoryGlyph
                                        iconKey={selectedMissingPayerRow.iconKey}
                                        className="size-3.5 shrink-0"
                                      />
                                      <ColorBadge color={selectedMissingPayerRow.color} />
                                    </>
                                  ) : null}
                                </span>
                                <SelectValue
                                  placeholder={
                                    missingType === "income"
                                      ? t.destinationAccount
                                      : t.paymentMethod
                                  }
                                />
                              </span>
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {missingPayerOptionsList.map((p) => {
                                const plabel =
                                  missingType === "income"
                                    ? localizedDestinationAccountName(p.id, p.name, lang)
                                    : localizedPaymentMethodName(p.id, p.name, lang);
                                return (
                                  <SelectItem key={p.id} value={p.id} textValue={plabel}>
                                    <span className="flex min-w-0 items-center gap-3">
                                      <span className="flex shrink-0 items-center gap-1.5">
                                        <CategoryGlyph iconKey={p.iconKey} className="size-3.5" />
                                        <ColorBadge color={p.color} />
                                      </span>
                                      <SelectItemText className="min-w-0">{plabel}</SelectItemText>
                                    </span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {/* Row 4: Date */}
                      <div className="space-y-1.5">
                        <DatePickerField
                          id="fr-missing-date"
                          label={t.financialReviewReconMissingDate}
                          value={missingDate}
                          onChange={setMissingDate}
                        />
                      </div>
                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <Button type="button" variant="ghost" className="flex-1 rounded-xl" onClick={() => setMissingOpen(false)}>
                          {t.financialReviewReconMissingCancel}
                        </Button>
                        <Button type="button" className="flex-1 rounded-xl" disabled={missingSaving} onClick={() => void addMissingExpense()}>
                          {t.financialReviewReconMissingSave}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-10">
                <div className="space-y-4">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    {t.financialReviewIncomesSummaryTitle}
                  </p>
                  {incomeRowsForMonth.length === 0 ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t.financialReviewNoIncomeNote}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {incomeRowsForMonth.map((e) => {
                        const cat = incomeSources.find((c) => c.id === e.categoryId);
                        const catName = cat
                          ? localizedIncomeSourceName(cat.id, cat.name, lang)
                          : e.categoryId;
                        const ils = convertToILS(e.amount, e.currency ?? "ILS", rateDate);
                        const tint = cat?.color ?? "#22c55e";
                        return (
                          <li key={e.id}>
                            <CategoryTintRow accentHex={tint}>
                              <div className="flex items-center justify-between gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {e.note.trim() ? e.note : catName}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">{catName}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                                    disabled={incomeDeleteBusyId === e.id || assetStepBusy}
                                    aria-label={t.financialReviewDeleteIncome}
                                    onClick={() => void deleteReviewIncome(e.id)}
                                  >
                                    <Trash2 className="size-4" aria-hidden />
                                  </Button>
                                  <span
                                    className="min-w-[4.5rem] text-end text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                                    dir="ltr"
                                  >
                                    {formatIlsWholeCeil(ils)}
                                  </span>
                                </div>
                              </div>
                            </CategoryTintRow>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] px-4 py-3 dark:bg-emerald-500/10">
                    <span className="text-sm font-medium text-foreground">
                      {t.financialReviewIncomesTotal}
                    </span>
                    <span
                      className="text-base font-semibold tabular-nums text-emerald-800 dark:text-emerald-300"
                      dir="ltr"
                    >
                      {formatIlsWholeCeil(incomeIlsRaw)}
                    </span>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-border/15 bg-muted/10 px-5 py-5">
                  {!incomeFormOpen ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-2xl border-dashed border-primary/35 py-6 text-primary hover:bg-primary/5"
                        disabled={!incomeSources.length || !defaultIncomeDestinationId}
                        onClick={() => {
                          setIncomeFormOpen(true);
                          setIncomeDraftCategoryId(incomeSources[0]?.id ?? "");
                          setIncomeDraftDate((prev) =>
                            /^\d{4}-\d{2}-\d{2}$/.test(prev)
                              ? prev
                              : isoDateInYearMonth(reviewMonth, new Date()),
                          );
                        }}
                      >
                        <Plus className="me-2 size-4" aria-hidden />
                        {t.financialReviewAddIncome}
                      </Button>
                      {(!incomeSources.length || !defaultIncomeDestinationId) && (
                        <p className="text-center text-xs text-muted-foreground">
                          {!incomeSources.length
                            ? t.financialReviewIncomeNeedCategory
                            : t.financialReviewIncomeNeedDestination}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="fr-inc-amt">{t.financialReviewIncomeAmount}</Label>
                          <Input
                            id="fr-inc-amt"
                            dir="ltr"
                            inputMode="decimal"
                            className="h-11 rounded-xl text-end tabular-nums"
                            value={incomeDraftAmount}
                            onChange={(e) =>
                              setIncomeDraftAmount(formatNumericInput(e.target.value))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="fr-inc-ccy">{t.financialReviewIncomeCurrency}</Label>
                          <Select
                            value={incomeDraftCurrency}
                            onValueChange={setIncomeDraftCurrency}
                          >
                            <SelectTrigger id="fr-inc-ccy" className="h-11 rounded-xl">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {currencies.map((c) => (
                                <SelectItem key={c.code} value={c.code} textValue={c.code}>
                                  <SelectItemText>{c.code}</SelectItemText>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <DatePickerField
                            id="fr-inc-date"
                            label={t.financialReviewIncomeDate}
                            value={
                              /^\d{4}-\d{2}-\d{2}$/.test(incomeDraftDate)
                                ? incomeDraftDate
                                : isoDateInYearMonth(reviewMonth, new Date())
                            }
                            onChange={setIncomeDraftDate}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="fr-inc-note">{t.financialReviewIncomeDescription}</Label>
                          <Input
                            id="fr-inc-note"
                            className="h-11 rounded-xl"
                            placeholder={t.financialReviewIncomeDescriptionPlaceholder}
                            value={incomeDraftLabel}
                            onChange={(e) => setIncomeDraftLabel(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label>{t.financialReviewIncomeCategory}</Label>
                          <Select
                            value={incomeDraftCategoryId || incomeSources[0]?.id}
                            onValueChange={setIncomeDraftCategoryId}
                          >
                            <SelectTrigger className="h-11 rounded-xl">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {incomeSources.map((c) => (
                                <SelectItem key={c.id} value={c.id} textValue={c.name}>
                                  <SelectItemText>
                                    {localizedIncomeSourceName(c.id, c.name, lang)}
                                  </SelectItemText>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="rounded-xl"
                          disabled={incomeSaving}
                          onClick={() => void submitReviewIncomeLine()}
                        >
                          {t.financialReviewIncomeSaveAdd}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="rounded-xl"
                          disabled={incomeSaving}
                          onClick={() => {
                            setIncomeFormOpen(false);
                            setIncomeDraftAmount("");
                            setIncomeDraftLabel("");
                            setIncomeDraftCurrency(DEFAULT_CURRENCY);
                            setIncomeDraftDate(isoDateInYearMonth(reviewMonth, new Date()));
                          }}
                        >
                          {t.savingsGoalCancel}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative overflow-hidden rounded-[1.75rem] border border-border/20 bg-gradient-to-b from-muted/20 via-background to-muted/10 px-6 py-10 shadow-sm">
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/[0.07] to-transparent dark:from-emerald-400/[0.09]"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-rose-500/[0.06] to-transparent dark:from-rose-400/[0.08]"
                    aria-hidden
                  />
                  <p className="relative text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    {t.financialReviewOverviewNetTitle}
                  </p>
                  <div className="relative mx-auto mt-10 max-w-[16rem] text-center">
                    <p
                      className={cn(
                        "text-4xl font-bold tracking-tight tabular-nums sm:text-5xl",
                        netPositive
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                      dir="ltr"
                    >
                      {netPositive ? "" : "−"}
                      {formatIlsWholeCeil(Math.abs(netIlsRaw))}
                    </p>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      {netPositive
                        ? t.financialReviewOverviewSurplusCaption
                        : t.financialReviewOverviewDeficitCaption}
                    </p>
                  </div>
                  <div className="relative mt-12 space-y-8">
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t.financialReviewChartIncome}</span>
                        <span className="tabular-nums text-emerald-700/95 dark:text-emerald-400/95">
                          {formatIlsWholeCeil(incomeIlsRaw)}
                        </span>
                      </div>
                      <div className="h-4 overflow-hidden rounded-full bg-emerald-950/10 dark:bg-emerald-950/30">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-emerald-400/90 to-emerald-600/80 shadow-sm shadow-emerald-500/20 transition-all duration-700 dark:from-emerald-400/70 dark:to-emerald-500/60"
                          style={{ width: `${incomeBarPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t.financialReviewChartExpense}</span>
                        <span className="tabular-nums text-rose-700/90 dark:text-rose-400/95">
                          {formatIlsWholeCeil(expenseIlsRaw)}
                        </span>
                      </div>
                      <div className="h-4 overflow-hidden rounded-full bg-rose-950/10 dark:bg-rose-950/25">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-rose-300/95 to-rose-500/75 shadow-sm shadow-rose-400/15 transition-all duration-700 dark:from-rose-400/65 dark:to-rose-500/50"
                          style={{ width: `${expenseBarPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {topExpenseCategories.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {t.financialReviewTopExpenseTitle}
                    </p>
                    <ul className="flex flex-col gap-3">
                      {topExpenseCategories.map((c, idx) => (
                        <li key={c.categoryId}>
                          <CategoryTintRow accentHex={c.color}>
                            <div className="flex items-center justify-between gap-4 px-4 py-4">
                              <span className="text-xs font-medium text-muted-foreground">
                                {idx + 1}.
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                                {c.name}
                              </span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-800/85 dark:text-rose-300/90">
                                {formatIlsWholeCeil(c.amountIls)}
                              </span>
                            </div>
                          </CategoryTintRow>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {budgetVsActualRows.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {t.financialReviewBudgetVsActualTitle}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {(budgetShowAll ? budgetVsActualRows : budgetVsActualRows.slice(0, 5)).map((row) => {
                        const pct = row.budgetIls > 0
                          ? Math.min(100, Math.round((row.actualIls / row.budgetIls) * 100))
                          : 100;
                        return (
                          <li key={`bgt-${row.categoryId}`} className={cn(
                            "rounded-xl border px-3 py-2.5",
                            row.over
                              ? "border-rose-500/25 bg-rose-500/[0.04] dark:bg-rose-500/[0.07]"
                              : "border-emerald-500/20 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.06]",
                          )}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{row.name}</span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                                  row.over
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
                                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
                                )}>
                                  {row.over ? t.financialReviewBudgetOver : t.financialReviewBudgetUnder}
                                </span>
                                <span className={cn("text-xs tabular-nums", row.over ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")} dir="ltr">
                                  {formatIlsWholeCeil(row.actualIls)} / {formatIlsWholeCeil(row.budgetIls)}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/50">
                              <div
                                className={cn("h-full rounded-full transition-all duration-500", row.over ? "bg-rose-500" : "bg-emerald-500")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {budgetVsActualRows.length > 5 ? (
                      <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setBudgetShowAll((v) => !v)}>
                        {budgetShowAll ? t.financialReviewBudgetShowLess : t.financialReviewBudgetShowMore}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-12">
                <div className="flex items-center justify-between rounded-xl border border-border/25 px-3 py-2">
                  <span className="text-sm font-medium">{t.financialReviewSaveArchive}</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="inline-flex items-center justify-center rounded-full p-1 text-muted-foreground hover:text-foreground">
                        <Info className="size-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs text-sm" dir={dir}>
                      {t.financialReviewSnapshotInfoTooltip}
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    {t.financialReviewSurplusLabel}
                  </p>
                  <p
                    className={cn(
                      "text-3xl font-semibold tracking-tight tabular-nums",
                      surplusCeil >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-rose-700/90 dark:text-rose-400",
                    )}
                  >
                    {surplusCeil >= 0 ? "" : "−"}
                    {formatIlsWholeCeil(Math.abs(surplus))}
                  </p>
                </div>

                {surplus <= 0.009 ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t.financialReviewDeficitMindfulness.replace("{{amount}}", deficitAmountLabel)}
                  </p>
                ) : (
                  <>
                    <div
                      className={cn(
                        "relative rounded-3xl border border-border/40",
                        "bg-gradient-to-br from-amber-500/10 via-background to-emerald-500/10 px-4 py-8 sm:px-6",
                      )}
                    >
                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
                        <div className="absolute -end-8 -top-8 size-32 rounded-full bg-amber-400/12 blur-2xl" />
                        <div className="absolute -bottom-10 -start-10 size-36 rounded-full bg-emerald-400/10 blur-2xl" />
                      </div>
                      <div className="relative z-[1] flex flex-col items-center gap-5 overflow-visible">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                          <Compass className="size-7" aria-hidden />
                        </div>
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                              {t.financialReviewCompassTitle}
                            </p>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="rounded-full p-1 text-muted-foreground outline-none ring-offset-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={t.financialReviewCompassInfoAria}
                                >
                                  <Info className="size-4" aria-hidden />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[min(20rem,calc(100vw-2rem))] text-sm leading-relaxed"
                                align="center"
                                side="bottom"
                                sideOffset={8}
                              >
                                {t.financialReviewCompassTooltip}
                              </PopoverContent>
                            </Popover>
                          </div>
                          <p className="max-w-md px-1 text-center text-xs leading-relaxed text-muted-foreground">
                            {t.financialReviewCompassSummaryLine}
                          </p>
                        </div>
                        <div
                          className="relative mx-auto h-24 w-48 overflow-hidden rounded-t-full border border-emerald-500/20 bg-muted/20"
                          aria-hidden
                        >
                          <div
                            className="absolute inset-0 rounded-t-full opacity-90"
                            style={{
                              background: `conic-gradient(from 180deg at 50% 100%, rgb(16 185 129 / 0.55) 0deg, rgb(16 185 129 / 0.55) ${compassSplitAngle}deg, rgb(14 165 233 / 0.45) ${compassSplitAngle}deg, rgb(14 165 233 / 0.45) 180deg)`,
                            }}
                          />
                          <div className="absolute bottom-0 start-1/2 h-[46%] w-px origin-bottom bg-foreground/40" />
                        </div>
                        <p className="text-center text-sm leading-relaxed text-muted-foreground">
                          {adviceDisplay}
                        </p>
                      </div>
                    </div>

                    {monthlyPriorityRows.length > 0 && surplusCeil > 0 ? (
                      <div className="space-y-5">
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          {t.financialReviewMonthlyGoalsTitle}
                        </p>
                        <ul className="flex flex-col gap-4">
                          {monthlyPriorityRows.map((row) => {
                            const g = row.goal;
                            const draftRaw = monthlyDepositDrafts[g.id] ?? "";
                            const parsedDraft = parseNumericInput(draftRaw);
                            const previewDeposit =
                              parsedDraft != null && Number.isFinite(parsedDraft)
                                ? Math.ceil(parsedDraft)
                                : Math.ceil(row.total);
                            const merged =
                              row.monthly > 0.009 && row.compass > 0.009;
                            return (
                              <li
                                key={g.id}
                                className="flex flex-col gap-4 rounded-2xl border border-border/35 bg-background/60 px-6 py-6 sm:flex-row sm:items-end sm:justify-between"
                              >
                                <div className="min-w-0 flex-1 space-y-2">
                                  <LabelMini icon={g.icon} color={g.color}>
                                    {g.name}
                                  </LabelMini>
                                  {merged ? (
                                    <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                                      {t.financialReviewGoalMergedCaption}
                                    </p>
                                  ) : null}
                                  {g.targetAmount > 0.009 && previewDeposit > 0 ? (
                                    <p className="text-xs leading-relaxed text-muted-foreground">
                                      {t.financialReviewGoalProgressRange
                                        .replace(
                                          "{{fromPct}}",
                                          String(pctTowardTarget(g.currentAmount, g.targetAmount)),
                                        )
                                        .replace(
                                          "{{toPct}}",
                                          String(
                                            pctTowardTarget(
                                              g.currentAmount + previewDeposit,
                                              g.targetAmount,
                                            ),
                                          ),
                                        )}
                                      {" · "}
                                      {t.financialReviewGoalDepositDelta.replace(
                                        "{{pct}}",
                                        String(pctOfTarget(previewDeposit, g.targetAmount)),
                                      )}
                                    </p>
                                  ) : null}
                                  <Input
                                    className="h-11 max-w-[9rem] rounded-xl"
                                    value={monthlyDepositDrafts[g.id] ?? ""}
                                    onChange={(e) =>
                                      setMonthlyDepositDrafts((prev) => ({
                                        ...prev,
                                        [g.id]: formatNumericInput(e.target.value),
                                      }))
                                    }
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0 rounded-xl border-emerald-500/30 text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-300"
                                  disabled={depositing === g.id || savingArchive}
                                  onClick={() =>
                                    void runDeposit(g.id, monthlyDepositDrafts[g.id] ?? "", true)
                                  }
                                >
                                  {t.monthlyInsightDeposit}
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}

                    {compassSavingsRowVisible || compassInvestmentRowVisible ? (
                      <div className="space-y-5 rounded-2xl border border-border/35 bg-muted/10 px-6 py-8">
                        <p className="text-sm text-muted-foreground">{t.financialReviewDepositHint}</p>
                        {compassSavingsRowVisible && compassAllocation.savingsGoal ? (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-0 flex-1 space-y-2">
                              <LabelMini
                                icon={compassAllocation.savingsGoal.icon}
                                color={compassAllocation.savingsGoal.color}
                              >
                                {compassAllocation.savingsGoal.name}
                              </LabelMini>
                              {compassAllocation.savingsGoal.targetAmount > 0.009 &&
                              previewSavDeposit > 0 ? (
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {t.financialReviewGoalProgressRange
                                    .replace(
                                      "{{fromPct}}",
                                      String(
                                        pctTowardTarget(
                                          compassAllocation.savingsGoal.currentAmount,
                                          compassAllocation.savingsGoal.targetAmount,
                                        ),
                                      ),
                                    )
                                    .replace(
                                      "{{toPct}}",
                                      String(
                                        pctTowardTarget(
                                          compassAllocation.savingsGoal.currentAmount +
                                            previewSavDeposit,
                                          compassAllocation.savingsGoal.targetAmount,
                                        ),
                                      ),
                                    )}
                                  {" · "}
                                  {t.financialReviewGoalDepositDelta.replace(
                                    "{{pct}}",
                                    String(
                                      pctOfTarget(
                                        previewSavDeposit,
                                        compassAllocation.savingsGoal.targetAmount,
                                      ),
                                    ),
                                  )}
                                </p>
                              ) : null}
                              <Input
                                className="h-11 max-w-[9rem] rounded-xl"
                                value={amountSav}
                                onChange={(e) => setAmountSav(formatNumericInput(e.target.value))}
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="rounded-xl"
                              disabled={
                                depositing === compassAllocation.savingsGoal.id || savingArchive
                              }
                              onClick={() =>
                                void runDeposit(compassAllocation.savingsGoal!.id, amountSav, true)
                              }
                            >
                              {t.monthlyInsightDeposit}
                            </Button>
                          </div>
                        ) : null}
                        {compassInvestmentRowVisible && compassAllocation.investmentGoal ? (
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-0 flex-1 space-y-2">
                              <LabelMini
                                icon={compassAllocation.investmentGoal.icon}
                                color={compassAllocation.investmentGoal.color}
                              >
                                {compassAllocation.investmentGoal.name}
                              </LabelMini>
                              {compassAllocation.investmentGoal.targetAmount > 0.009 &&
                              previewInvDeposit > 0 ? (
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  {t.financialReviewGoalProgressRange
                                    .replace(
                                      "{{fromPct}}",
                                      String(
                                        pctTowardTarget(
                                          compassAllocation.investmentGoal.currentAmount,
                                          compassAllocation.investmentGoal.targetAmount,
                                        ),
                                      ),
                                    )
                                    .replace(
                                      "{{toPct}}",
                                      String(
                                        pctTowardTarget(
                                          compassAllocation.investmentGoal.currentAmount +
                                            previewInvDeposit,
                                          compassAllocation.investmentGoal.targetAmount,
                                        ),
                                      ),
                                    )}
                                  {" · "}
                                  {t.financialReviewGoalDepositDelta.replace(
                                    "{{pct}}",
                                    String(
                                      pctOfTarget(
                                        previewInvDeposit,
                                        compassAllocation.investmentGoal.targetAmount,
                                      ),
                                    ),
                                  )}
                                </p>
                              ) : null}
                              <Input
                                className="h-11 max-w-[9rem] rounded-xl"
                                value={amountInv}
                                onChange={(e) => setAmountInv(formatNumericInput(e.target.value))}
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="rounded-xl"
                              disabled={
                                depositing === compassAllocation.investmentGoal.id || savingArchive
                              }
                              onClick={() =>
                                void runDeposit(compassAllocation.investmentGoal!.id, amountInv, true)
                              }
                            >
                              {t.monthlyInsightDeposit}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : goals.length > 0 &&
                      surplus > 0.009 &&
                      monthlyPriorityRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t.monthlyInsightNoAutoSplit}</p>
                    ) : null}
                    {goals.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t.monthlyInsightNoGoals}</p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-3 border-t border-border/40 px-8 py-8 sm:flex-row sm:justify-between">
          <div className="flex w-full gap-2 sm:w-auto">
            {step > 0 ? (
              <Button type="button" variant="ghost" className="rounded-xl" onClick={goBack}>
                {t.financialReviewBack}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl"
                onClick={requestCloseFinancialReview}
              >
                {t.savingsGoalCancel}
              </Button>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
            {step < 3 ? (
              <Button
                type="button"
                className="rounded-xl"
                disabled={assetStepBusy}
                onClick={goNext}
              >
                {step === 0 ? t.financialReviewConfirmBalances : t.financialReviewNext}
              </Button>
            ) : (
              <Button
                type="button"
                className="rounded-xl"
                disabled={savingArchive}
                onClick={() => void saveArchive()}
              >
                {t.financialReviewSaveArchive}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={invDepositFollowUp != null}>
      <AlertDialogContent className="max-w-md" dir={dir}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.savingsGoalInvestmentTransferTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.savingsGoalInvestmentTransferDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void onInvTransferConfirmed(false)}>
            {t.savingsGoalInvestmentTransferNo}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => void onInvTransferConfirmed(true)}>
            {t.savingsGoalInvestmentTransferYes}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={overwriteConfirmOpen} onOpenChange={setOverwriteConfirmOpen}>
      <AlertDialogContent className="max-w-md" dir={dir}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.financialReviewSnapshotOverwriteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.financialReviewSnapshotOverwriteDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.savingsGoalCancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setPendingOverwrite(true);
              setOverwriteConfirmOpen(false);
              void saveArchive();
            }}
          >
            {t.financialReviewSnapshotOverwriteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
      <AlertDialogContent className="max-w-md" dir={dir}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.financialReviewExitConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.financialReviewExitConfirmDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.savingsGoalCancel}</AlertDialogCancel>
          <AlertDialogAction onClick={confirmCloseFinancialReview}>
            {t.financialReviewExitConfirmAction}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function LabelMini({
  children,
  icon,
  color,
}: {
  children: ReactNode;
  icon: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}22`, color }}
      >
        <CategoryGlyph iconKey={icon} className="size-3.5" />
      </span>
      <span className="truncate text-sm font-medium">{children}</span>
    </div>
  );
}
