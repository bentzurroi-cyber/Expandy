import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Coins, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExpenses } from "@/context/ExpensesContext";
import { DEFAULT_CURRENCY, MOCK_INCOME_SOURCES } from "@/data/mock";
import { useI18n } from "@/context/I18nContext";
import { currencyOptionLabel, formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { formatLocalIsoDate } from "@/lib/month";
import { ExpenseFormFields } from "./ExpenseFormFields";
import { AddCategoryDialog } from "./AddCategoryDialog";
import { AddNameDialog } from "@/components/common/AddNameDialog";
import { ManagePaymentMethodsDialog } from "./ManagePaymentMethodsDialog";
import { toast } from "sonner";
import { MAX_RECEIPT_IMAGES } from "@/lib/receiptConstants";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export function ExpenseEntryForm() {
  const { t, dir } = useI18n();
  const { profile } = useAuth();
  const {
    expenses,
    addExpense,
    expenseCategories,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    currencies,
    addExpenseCategory,
    addIncomeSource,
    addPaymentMethod,
    addDestinationAccount,
    updatePaymentMethod,
    deletePaymentMethod,
    updateDestinationAccount,
    deleteDestinationAccount,
    addCustomCurrency,
    reorderExpenseCategories,
    reorderIncomeSources,
    quickAccessCount,
    setQuickAccessCount,
  } = useExpenses();
  const defaultExpensePaymentMethodId = useMemo(() => {
    const d = profile?.default_payment_method_id?.trim();
    if (d && paymentMethods.some((m) => m.id === d)) return d;
    return paymentMethods[0]?.id ?? "";
  }, [profile?.default_payment_method_id, paymentMethods]);
  const defaultIncomeDestinationId = useMemo(() => {
    const d = profile?.default_destination_account_id?.trim();
    if (d && destinationAccounts.some((a) => a.id === d)) return d;
    return destinationAccounts[0]?.id ?? "";
  }, [profile?.default_destination_account_id, destinationAccounts]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [entryType, setEntryType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState<string>(
    expenseCategories[0]?.id ?? "",
  );
  const [paymentMethodId, setPaymentMethodId] = useState<string>("");
  const lastProfileDefaultPm = useRef<string | undefined>(undefined);
  const lastProfileDefaultDest = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (entryType === "expense") {
      if (!paymentMethods.length) return;
      const cur = profile?.default_payment_method_id?.trim() ?? "";
      if (cur && paymentMethods.some((m) => m.id === cur)) {
        if (lastProfileDefaultPm.current !== cur) {
          lastProfileDefaultPm.current = cur;
          setPaymentMethodId(cur);
        }
        return;
      }
      lastProfileDefaultPm.current = cur;
      setPaymentMethodId((prev) => prev || (paymentMethods[0]?.id ?? ""));
      return;
    }
    if (!destinationAccounts.length) return;
    const cur = profile?.default_destination_account_id?.trim() ?? "";
    if (cur && destinationAccounts.some((a) => a.id === cur)) {
      if (lastProfileDefaultDest.current !== cur) {
        lastProfileDefaultDest.current = cur;
        setPaymentMethodId(cur);
      }
      return;
    }
    lastProfileDefaultDest.current = cur;
    setPaymentMethodId((prev) => prev || (destinationAccounts[0]?.id ?? ""));
  }, [
    entryType,
    paymentMethods,
    destinationAccounts,
    profile?.default_payment_method_id,
    profile?.default_destination_account_id,
  ]);
  const [installments, setInstallments] = useState(1);
  const [recurringMonthly, setRecurringMonthly] = useState(false);
  const [note, setNote] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [txDate, setTxDate] = useState(() => formatLocalIsoDate(new Date()));
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addMethodOpen, setAddMethodOpen] = useState(false);
  const [addMethodKind, setAddMethodKind] = useState<"payment" | "destination">(
    "payment",
  );
  const [manageMethodsOpen, setManageMethodsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fabSentinelRef = useRef<HTMLDivElement>(null);
  const [fabAtRest, setFabAtRest] = useState(false);

  const currencyMeta = useMemo(() => {
    const c = currencies.find((x) => x.code === currency);
    return (
      c ?? {
        code: currency,
        labelHe: currency,
        symbol: "¤",
        iconKey: "badge-cent",
      }
    );
  }, [currencies, currency]);

  const receiptPreviewUrls = useMemo(
    () => receiptFiles.map((f) => URL.createObjectURL(f)),
    [receiptFiles],
  );

  useEffect(() => {
    return () => {
      for (const u of receiptPreviewUrls) URL.revokeObjectURL(u);
    };
  }, [receiptPreviewUrls]);

  // FAB ghost/solid: viewport intersection on a sentinel at the form end.
  // Does not change scroll containers — works for inner scroll or page scroll (same as before structurally).
  useLayoutEffect(() => {
    const sentinel = fabSentinelRef.current;
    if (!sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) setFabAtRest(e.isIntersecting);
      },
      {
        root: null,
        rootMargin: "0px 0px -88px 0px",
        threshold: 0,
      },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  const currencyOptions = useMemo(() => {
    const list = [...currencies];
    if (currency && !list.some((c) => c.code === currency)) {
      list.push({
        code: currency,
        labelHe: currency,
        symbol: "¤",
        iconKey: "badge-cent",
      });
    }
    return list;
  }, [currencies, currency]);

  function onCurrencySelect(value: string) {
    if (value === "__add_currency__") {
      const name = window.prompt(t.promptNewCurrencyName) ?? "";
      const code = addCustomCurrency(name);
      if (code) setCurrency(code);
      return;
    }
    setCurrency(value);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const parsed = parseNumericInput(amount);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      setHint(t.amountInvalid);
      return;
    }
    setSubmitting(true);
    try {
    const result = await addExpense({
      date: txDate,
      amount: Math.round(parsed * 100) / 100,
      currency,
      categoryId,
      paymentMethodId,
      note: note.trim(),
      type: entryType,
      installments: entryType === "expense" ? installments : 1,
      installmentIndex: 1,
      recurringMonthly,
      receiptFiles: receiptFiles.length ? receiptFiles : undefined,
    });
    if (!result.ok) {
      setHint(result.error);
      return;
    }
    setAmount("");
    setNote("");
    setInstallments(1);
    setRecurringMonthly(false);
    setReceiptFiles([]);
    if (receiptInputRef.current) receiptInputRef.current.value = "";
    setHint(null);
    toast.success("הנתונים הוזנו בהצלחה", { duration: 3000 });
    } finally {
      setSubmitting(false);
    }
  }

  const receiptAttachmentBlock = (
    <div className="space-y-3">
      <input
        ref={receiptInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const list = e.target.files;
          if (!list?.length) return;
          setReceiptFiles((prev) => {
            const next = [...prev];
            for (const f of list) {
              if (next.length >= MAX_RECEIPT_IMAGES) break;
              if (!f.type.startsWith("image/")) continue;
              next.push(f);
            }
            return next;
          });
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {receiptFiles.length < MAX_RECEIPT_IMAGES ? (
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-border bg-muted/70 px-3 py-2 text-sm font-medium text-foreground",
              "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t.receiptAddCompact}</span>
          </button>
        ) : null}
      </div>
      {receiptFiles.length ? (
        <div className="flex flex-wrap gap-2">
          {receiptFiles.map((f, i) => (
            <div
              key={`${f.name}-${i}-${f.size}`}
              className="group relative overflow-hidden rounded-xl ring-1 ring-border"
            >
              <img
                src={receiptPreviewUrls[i]}
                alt=""
                className="h-20 w-20 object-cover"
              />
              <button
                type="button"
                className="absolute end-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/70"
                aria-label={t.receiptClear}
                onClick={() =>
                  setReceiptFiles((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" dir={dir}>
      <h1 className="sr-only">{t.expenseTitle}</h1>
      <div className="relative flex min-h-0 flex-col">
        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 overflow-y-auto overflow-x-hidden rounded-2xl border shadow-2xl backdrop-blur-lg",
            "border-border bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100",
            "px-4 py-5 pb-1 sm:px-5",
          )}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1 dark:bg-zinc-900/60">
              <button
                type="button"
                className={cn(
                  "h-10 rounded-lg text-sm font-medium transition-colors",
                  entryType === "expense"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setEntryType("expense");
                  setCategoryId(expenseCategories[0]?.id ?? "");
                  setPaymentMethodId(defaultExpensePaymentMethodId);
                }}
              >
                {t.entryExpense}
              </button>
              <button
                type="button"
                className={cn(
                  "h-10 rounded-lg text-sm font-medium transition-colors",
                  entryType === "income"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setEntryType("income");
                  setCategoryId(MOCK_INCOME_SOURCES[0]?.id ?? "");
                  setPaymentMethodId(defaultIncomeDestinationId);
                  setInstallments(1);
                }}
              >
                {t.entryIncome}
              </button>
            </div>

            <section className="space-y-1 rounded-xl border border-border bg-muted/40 p-4 shadow-inner backdrop-blur-sm dark:bg-zinc-900/40">
              <div className="flex items-end justify-center gap-3 px-1 pt-1">
                <Input
                  id="entry-amount"
                  inputMode="decimal"
                  placeholder={t.amountPlaceholder}
                  value={amount}
                  onChange={(e) => setAmount(formatNumericInput(e.target.value))}
                  dir="ltr"
                  className={cn(
                    "h-auto w-full border-0 bg-transparent px-2 py-1 !text-center",
                    "text-6xl font-extrabold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50",
                    "shadow-none placeholder:!text-center placeholder:text-muted-foreground",
                    "focus-visible:ring-0 focus-visible:ring-offset-0",
                  )}
                  autoComplete="transaction-amount"
                />
              </div>
              <div className="mx-auto flex max-w-[18rem] items-center gap-2 border-b border-border pb-2 pt-2">
                <Coins className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Select value={currency} onValueChange={onCurrencySelect}>
                  <SelectTrigger
                    className={cn(
                      "h-10 min-h-0 flex-1 border-0 bg-transparent px-0 text-base text-foreground shadow-none",
                      "rounded-none ring-0 ring-offset-0 focus:ring-0 data-[placeholder]:text-muted-foreground",
                    )}
                  >
                    <SelectValue placeholder={currencyOptionLabel(currencyMeta)} />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    className="border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    {currencyOptions.map((c) => {
                      const label = currencyOptionLabel(c);
                      return (
                        <SelectItem key={c.code} value={c.code} textValue={label}>
                          <SelectItemText>{label}</SelectItemText>
                        </SelectItem>
                      );
                    })}
                    <>
                      <SelectSeparator className="bg-border" />
                      <SelectItem value="__add_currency__" textValue={t.addCurrency}>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <SelectItemText>{t.addCurrency}</SelectItemText>
                        </span>
                      </SelectItem>
                    </>
                  </SelectContent>
                </Select>
              </div>
              <DatePickerField
                id="entry-date"
                label={t.dateLabel}
                value={txDate}
                onChange={setTxDate}
                variant="entryMonochrome"
              />
            </section>

            <ExpenseFormFields
              idPrefix="entry"
              amount={amount}
              onAmountChange={setAmount}
              currency={currency}
              onCurrencyChange={setCurrency}
              categoryId={categoryId}
              onCategoryIdChange={setCategoryId}
              paymentMethodId={paymentMethodId}
              onPaymentMethodIdChange={setPaymentMethodId}
              entryType={entryType}
              note={note}
              onNoteChange={setNote}
              installments={installments}
              onInstallmentsChange={(next) => {
                setInstallments(next);
                if (next > 1) setRecurringMonthly(false);
              }}
              recurringMonthly={recurringMonthly}
              onRecurringMonthlyChange={(next) => {
                setRecurringMonthly(next);
                if (next) setInstallments(1);
              }}
              categoryOptions={entryType === "income" ? incomeSources : expenseCategories}
              methods={entryType === "income" ? destinationAccounts : paymentMethods}
              currencies={currencies}
              onAddExpenseCategory={() => setAddCategoryOpen(true)}
              onAddIncomeSource={() => setAddCategoryOpen(true)}
              onAddDestinationAccount={() => {
                setAddMethodKind("destination");
                setAddMethodOpen(true);
              }}
              onAddPaymentMethod={() => {
                setAddMethodKind("payment");
                setAddMethodOpen(true);
              }}
              onManageDestinationAccounts={() => {
                setAddMethodKind("destination");
                setManageMethodsOpen(true);
              }}
              onManagePaymentMethods={() => {
                setAddMethodKind("payment");
                setManageMethodsOpen(true);
              }}
              onAddCurrency={() => {
                const name = window.prompt(t.promptNewCurrencyName) ?? "";
                const code = addCustomCurrency(name);
                if (code) setCurrency(code);
              }}
              showDate={false}
              onHint={setHint}
              showAmountCurrency={false}
              layout="list"
              categoryPicker="grid"
              entrySurface="monochrome"
              entryNotesExtra={receiptAttachmentBlock}
              onReorderCategories={
                entryType === "income"
                  ? reorderIncomeSources
                  : reorderExpenseCategories
              }
              quickAccessCount={quickAccessCount}
              onQuickAccessCountChange={setQuickAccessCount}
            />

            {hint ? (
              <p className="text-sm text-muted-foreground" role="status">
                {hint}
              </p>
            ) : null}
            <div
              ref={fabSentinelRef}
              className="pointer-events-none h-px w-full shrink-0"
              aria-hidden
            />
          </div>
        </div>
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className={cn(
          "fixed left-1/2 z-[60] w-[80%] max-w-[15rem] -translate-x-1/2",
          "rounded-full border-0 px-3.5 py-1.5 text-[0.8125rem] font-semibold leading-snug sm:max-w-[13rem] sm:px-4 sm:py-2 sm:text-sm",
          "transition-[background-color,box-shadow,backdrop-filter,opacity,color,text-shadow] duration-300 ease-out",
          fabAtRest
            ? [
                "bg-primary text-primary-foreground opacity-100 backdrop-blur-none",
                "shadow-[0_8px_28px_-4px_rgba(0,0,0,0.35)] dark:shadow-[0_8px_28px_-4px_rgba(0,0,0,0.55)]",
                "hover:bg-primary/92 active:bg-primary/88",
              ]
            : [
                // Ghost: primary-foreground on translucent primary reads as dark-on-dark in .dark — use foreground / light text.
                "border border-black/12 bg-primary/45 text-foreground shadow-[0_6px_28px_-6px_rgba(0,0,0,0.35)] backdrop-blur-xl",
                "dark:border-white/25 dark:bg-primary/35 dark:text-zinc-50 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.65)]",
                "[text-shadow:0_1px_2px_rgba(0,0,0,0.35)] dark:[text-shadow:0_1px_3px_rgba(0,0,0,0.75)]",
                "hover:bg-primary/58 hover:shadow-lg hover:backdrop-blur-xl",
                "dark:hover:bg-primary/50 dark:hover:text-zinc-50 dark:hover:[text-shadow:0_1px_3px_rgba(0,0,0,0.6)]",
              ],
          "disabled:opacity-50",
          "bottom-[calc(4.25rem+0.25rem+env(safe-area-inset-bottom))]",
        )}
      >
        {entryType === "income" ? t.addIncome : t.addExpenseCta}
      </Button>

      <AddCategoryDialog
        open={addCategoryOpen}
        onOpenChange={setAddCategoryOpen}
        title={entryType === "income" ? t.addIncomeSource : t.addCategory}
        description={entryType === "income" ? t.promptNewIncomeSource : t.promptNewCategoryName}
        confirmLabel={t.add}
        onConfirm={({ name, iconKey, color }) => {
          const id =
            entryType === "income"
              ? addIncomeSource(name, iconKey, color)
              : addExpenseCategory(name, iconKey, color);
          if (id) setCategoryId(id);
        }}
      />

      <AddNameDialog
        open={addMethodOpen}
        onOpenChange={setAddMethodOpen}
        title={addMethodKind === "destination" ? t.addDestinationAccount : t.addPaymentMethod}
        description={
          addMethodKind === "destination"
            ? t.promptNewDestinationAccount
            : t.addPaymentMethod
        }
        label={addMethodKind === "destination" ? t.destinationAccount : t.paymentMethod}
        placeholder={
          addMethodKind === "destination"
            ? t.destinationAccountPlaceholder
            : t.paymentPlaceholder
        }
        confirmLabel={t.add}
        onConfirm={(name) => {
          const id =
            addMethodKind === "destination"
              ? addDestinationAccount(name)
              : addPaymentMethod(name);
          if (id) setPaymentMethodId(id);
          return id;
        }}
      />

      <ManagePaymentMethodsDialog
        open={manageMethodsOpen}
        onOpenChange={setManageMethodsOpen}
        kind={addMethodKind}
        items={addMethodKind === "destination" ? destinationAccounts : paymentMethods}
        selectedId={paymentMethodId}
        onSelectId={setPaymentMethodId}
        title={addMethodKind === "destination" ? "ניהול חשבונות יעד" : "ניהול אמצעי תשלום"}
        description={
          addMethodKind === "destination"
            ? "עריכה ומחיקה של חשבונות יעד להכנסות."
            : "עריכה ומחיקה של אמצעי תשלום להוצאות."
        }
        onAdd={(name) =>
          addMethodKind === "destination"
            ? addDestinationAccount(name)
            : addPaymentMethod(name)
        }
        onUpdate={(id, patch) => {
          if (addMethodKind === "destination") updateDestinationAccount(id, patch);
          else updatePaymentMethod(id, patch);
        }}
        onDelete={(id, moveToId) => {
          if (addMethodKind === "destination") deleteDestinationAccount(id, moveToId);
          else deletePaymentMethod(id, moveToId);
        }}
        usageCount={(() => {
          const m = new Map<string, number>();
          for (const e of expenses) {
            if (addMethodKind === "destination") {
              if (e.type !== "income") continue;
            } else {
              if (e.type !== "expense") continue;
            }
            m.set(e.paymentMethodId, (m.get(e.paymentMethodId) ?? 0) + 1);
          }
          return m;
        })()}
      />
    </form>
  );
}
