import { useMemo, useState } from "react";
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
import {
  DEFAULT_CURRENCY,
  MOCK_DESTINATION_ACCOUNTS,
  MOCK_INCOME_SOURCES,
} from "@/data/mock";
import { useI18n } from "@/context/I18nContext";
import { currencyOptionLabel, formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { formatLocalIsoDate } from "@/lib/month";
import { CurrencyGlyph } from "./FinanceGlyphs";
import { ExpenseFormFields } from "./ExpenseFormFields";
import { AddCategoryDialog } from "./AddCategoryDialog";
import { AddNameDialog } from "@/components/common/AddNameDialog";
import { ManagePaymentMethodsDialog } from "./ManagePaymentMethodsDialog";
import { MOCK_PAYMENT_METHODS } from "@/data/mock";

export function ExpenseEntryForm() {
  const { t, dir } = useI18n();
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
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [entryType, setEntryType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState<string>(
    expenseCategories[0]?.id ?? "",
  );
  const [paymentMethodId, setPaymentMethodId] = useState<string>(
    paymentMethods[0]?.id ?? "",
  );
  const [installments, setInstallments] = useState(1);
  const [recurringMonthly, setRecurringMonthly] = useState(false);
  const [note, setNote] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [txDate, setTxDate] = useState(() => formatLocalIsoDate(new Date()));
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addMethodOpen, setAddMethodOpen] = useState(false);
  const [addMethodKind, setAddMethodKind] = useState<"payment" | "destination">(
    "payment",
  );
  const [manageMethodsOpen, setManageMethodsOpen] = useState(false);

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
    const parsed = parseNumericInput(amount);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      setHint(t.amountInvalid);
      return;
    }
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
    });
    if (!result.ok) {
      setHint(result.error);
      return;
    }
    setAmount("");
    setNote("");
    setInstallments(1);
    setRecurringMonthly(false);
    setHint("ההוצאה נשמרה בהצלחה בענן.");
    setTimeout(() => setHint(null), 3200);
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col" dir={dir}>
      {/* Top hero */}
      <div className="space-y-6 pb-6 pt-1">
        <div className="grid grid-cols-2 rounded-2xl border border-border/70 bg-muted/30 p-1">
          <button
            type="button"
            className={[
              "h-10 rounded-xl text-sm font-medium transition-colors",
              entryType === "expense"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            onClick={() => {
              setEntryType("expense");
              setCategoryId(expenseCategories[0]?.id ?? "");
              setPaymentMethodId(paymentMethods[0]?.id ?? "");
            }}
          >
            {t.entryExpense}
          </button>
          <button
            type="button"
            className={[
              "h-10 rounded-xl text-sm font-medium transition-colors",
              entryType === "income"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            onClick={() => {
              setEntryType("income");
              setCategoryId(MOCK_INCOME_SOURCES[0]?.id ?? "");
              setPaymentMethodId(MOCK_DESTINATION_ACCOUNTS[0]?.id ?? "");
              setInstallments(1);
            }}
          >
            {t.entryIncome}
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-end justify-center gap-3 px-1">
            <Input
              id="entry-amount"
              inputMode="decimal"
              placeholder={t.amountPlaceholder}
              value={amount}
              onChange={(e) => setAmount(formatNumericInput(e.target.value))}
              dir="ltr"
              className="h-auto w-full border-0 bg-transparent px-2 py-2 text-center text-6xl font-bold tabular-nums tracking-tight shadow-none placeholder:text-center focus-visible:ring-0"
              autoComplete="transaction-amount"
            />
          </div>
          <div className="flex justify-center">
            <Select value={currency} onValueChange={onCurrencySelect}>
              <SelectTrigger className="h-10 w-[min(100%,14rem)] rounded-full border-border/70 bg-background/60">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <CurrencyGlyph iconKey={currencyMeta.iconKey} className="size-4" />
                  <SelectValue placeholder={currencyOptionLabel(currencyMeta)} />
                </div>
              </SelectTrigger>
              <SelectContent position="popper">
                {currencyOptions.map((c) => {
                  const label = currencyOptionLabel(c);
                  return (
                    <SelectItem key={c.code} value={c.code} textValue={label}>
                      <SelectItemText>{label}</SelectItemText>
                    </SelectItem>
                  );
                })}
                <>
                  <SelectSeparator />
                  <SelectItem value="__add_currency__" textValue={t.addCurrency}>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <SelectItemText>{t.addCurrency}</SelectItemText>
                    </span>
                  </SelectItem>
                </>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Middle scrollable details */}
      <div className="flex-1 overflow-auto px-1 pb-6">
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
          showDate
          date={txDate}
          onDateChange={setTxDate}
          onHint={setHint}
          showAmountCurrency={false}
          layout="list"
          categoryPicker="grid"
          onReorderCategories={
            entryType === "income"
              ? reorderIncomeSources
              : reorderExpenseCategories
          }
          quickAccessCount={quickAccessCount}
          onQuickAccessCountChange={setQuickAccessCount}
        />
        {hint ? (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            {hint}
          </p>
        ) : null}
      </div>

      {/* Bottom sticky action */}
      <div className="sticky bottom-0 bg-background pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button type="submit" className="h-12 w-full text-base">
          {entryType === "income" ? t.addIncome : t.addExpenseCta}
        </Button>
      </div>

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
        builtInIds={
          addMethodKind === "destination"
            ? new Set(MOCK_DESTINATION_ACCOUNTS.map((m) => m.id))
            : new Set(MOCK_PAYMENT_METHODS.map((m) => m.id))
        }
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
