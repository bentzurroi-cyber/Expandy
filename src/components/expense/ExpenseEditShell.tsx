import { useEffect, useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import {
  DEFAULT_CURRENCY,
  type EntryType,
  type Expense,
} from "@/data/mock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ExpenseFormFields } from "./ExpenseFormFields";
import { AddNameDialog } from "@/components/common/AddNameDialog";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ExpenseEditShellProps = {
  expense: Expense | null;
  onOpenChange: (open: boolean) => void;
};

export function ExpenseEditShell({
  expense,
  onOpenChange,
}: ExpenseEditShellProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { t } = useI18n();
  const {
    updateExpense,
    removeExpense,
    expenseCategories,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    currencies,
    addExpenseCategory,
    addIncomeSource,
    addPaymentMethod,
    addDestinationAccount,
    addCustomCurrency,
  } = useExpenses();

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [installments, setInstallments] = useState(1);
  const [recurringMonthly, setRecurringMonthly] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [addMethodOpen, setAddMethodOpen] = useState(false);
  const [addMethodKind, setAddMethodKind] = useState<"payment" | "destination">(
    "payment",
  );

  useEffect(() => {
    if (!expense) return;
    setAmount(formatNumericInput(String(expense.amount)));
    setCurrency(expense.currency);
    setCategoryId(expense.categoryId);
    setPaymentMethodId(expense.paymentMethodId);
    setEntryType(expense.type);
    setInstallments(expense.installments);
    setRecurringMonthly(expense.recurringMonthly);
    setDate(expense.date);
    setNote(expense.note);
    setHint(null);
  }, [expense]);

  function handleSave() {
    if (!expense) return;
    const parsed = parseNumericInput(amount);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      setHint(t.amountInvalid);
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setHint(t.dateInvalid);
      return;
    }
    updateExpense(expense.id, {
      amount: Math.round(parsed * 100) / 100,
      currency,
      categoryId,
      paymentMethodId,
      type: entryType,
      installments: Math.max(1, Math.floor(installments)),
      recurringMonthly,
      date,
      note: note.trim(),
    });
    setHint(null);
    onOpenChange(false);
  }

  function handleDelete() {
    if (!expense) return;
    removeExpense(expense.id);
    onOpenChange(false);
  }

  if (!expense) {
    return null;
  }

  const form = (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <Label htmlFor="edit-amount-direct">{t.amountAndCurrency}</Label>
        <Input
          id="edit-amount-direct"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(formatNumericInput(e.target.value))}
          dir="ltr"
          className="tabular-nums"
        />
      </div>
      <ExpenseFormFields
        idPrefix="edit"
        amount={amount}
        onAmountChange={(next) => setAmount(formatNumericInput(next))}
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
        recurringMonthly={recurringMonthly}
        onInstallmentsChange={(next) => {
          setInstallments(next);
          if (next > 1) setRecurringMonthly(false);
        }}
        onRecurringMonthlyChange={(next) => {
          setRecurringMonthly(next);
          if (next) setInstallments(1);
        }}
        categoryOptions={
          entryType === "income" ? incomeSources : expenseCategories
        }
        methods={
          entryType === "income" ? destinationAccounts : paymentMethods
        }
        currencies={currencies}
        onAddExpenseCategory={() => {
          const name = window.prompt(t.promptNewCategoryName) ?? "";
          const id = addExpenseCategory(name);
          if (id) setCategoryId(id);
        }}
        onAddIncomeSource={() => {
          const name = window.prompt(t.promptNewIncomeSource) ?? "";
          const id = addIncomeSource(name);
          if (id) setCategoryId(id);
        }}
        onAddDestinationAccount={() => {
          setAddMethodKind("destination");
          setAddMethodOpen(true);
        }}
        onAddPaymentMethod={() => {
          setAddMethodKind("payment");
          setAddMethodOpen(true);
        }}
        onAddCurrency={() => {
          const name = window.prompt(t.promptNewCurrencyName) ?? "";
          const code = addCustomCurrency(name);
          if (code) setCurrency(code);
        }}
        showDate
        date={date}
        onDateChange={setDate}
        onHint={setHint}
        layout="list"
        categoryPicker="select"
      />
      {hint ? (
        <p className="text-sm text-muted-foreground" role="status">
          {hint}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 pt-2">
        <Button type="button" size="lg" className="w-full" onClick={handleSave}>
          {t.saveChanges}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" className="w-full">
              מחק
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>האם אתה בטוח?</AlertDialogTitle>
              <AlertDialogDescription>
                האם אתה בטוח שברצונך למחוק רשומה זו? פעולה זו אינה ניתנת לביטול.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>מחק</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );

  const addMethodDialog = (
    <AddNameDialog
      open={addMethodOpen}
      onOpenChange={setAddMethodOpen}
      title={
        addMethodKind === "destination"
          ? t.addDestinationAccount
          : t.addPaymentMethod
      }
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
  );

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.editExpenseTitle}</DialogTitle>
            <DialogDescription>{t.editExpenseSubtitle}</DialogDescription>
          </DialogHeader>
          <div className="w-full box-border p-4 md:p-6">
            {form}
            {addMethodDialog}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t.editExpenseTitle}</SheetTitle>
          <SheetDescription>{t.editExpenseSubtitle}</SheetDescription>
        </SheetHeader>
        <div className="mt-2 w-full box-border p-5 overscroll-contain md:p-6">
          {form}
          {addMethodDialog}
        </div>
      </SheetContent>
    </Sheet>
  );
}
