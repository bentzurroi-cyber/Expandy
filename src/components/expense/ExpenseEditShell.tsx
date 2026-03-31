import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
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
import { isStandardUuid } from "@/lib/expenseIds";
import { MAX_RECEIPT_IMAGES, capReceiptUrls } from "@/lib/receiptConstants";
import { deleteReceiptObjectsByPublicUrls, uploadReceiptImage } from "@/lib/receiptUpload";
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

type ReceiptSlot =
  | { kind: "remote"; url: string }
  | { kind: "local"; file: File; key: string };

function receiptSlotsUnchanged(slots: ReceiptSlot[], baseline: string[]): boolean {
  if (slots.length !== baseline.length) return false;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.kind !== "remote" || s.url !== baseline[i]) return false;
  }
  return true;
}

export function ExpenseEditShell({
  expense,
  onOpenChange,
}: ExpenseEditShellProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { t, lang } = useI18n();
  const {
    updateExpenseAsync,
    waitForCloudContext,
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
  const [receiptSlots, setReceiptSlots] = useState<ReceiptSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!expense) return;
    setAmount(formatNumericInput(String(expense.amount)));
    setCurrency(
      typeof expense.currency === "string" && expense.currency.trim()
        ? expense.currency
        : DEFAULT_CURRENCY,
    );
    setCategoryId(
      typeof expense.categoryId === "string" ? expense.categoryId : "",
    );
    setPaymentMethodId(
      typeof expense.paymentMethodId === "string" ? expense.paymentMethodId : "",
    );
    setEntryType(expense.type === "income" ? "income" : "expense");
    setInstallments(
      typeof expense.installments === "number" && Number.isFinite(expense.installments)
        ? expense.installments
        : 1,
    );
    setRecurringMonthly(expense.recurringMonthly === true);
    setDate(typeof expense.date === "string" ? expense.date : "");
    setNote(typeof expense.note === "string" ? expense.note : "");
    setReceiptSlots(
      capReceiptUrls(expense.receiptUrls ?? []).map((url) => ({
        kind: "remote" as const,
        url,
      })),
    );
    setHint(null);
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  }, [expense]);

  const localPreviewByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of receiptSlots) {
      if (s.kind === "local") {
        m.set(s.key, URL.createObjectURL(s.file));
      }
    }
    return m;
  }, [receiptSlots]);

  useEffect(() => {
    return () => {
      for (const u of localPreviewByKey.values()) {
        URL.revokeObjectURL(u);
      }
    };
  }, [localPreviewByKey]);

  async function handleSave() {
    if (!expense || saving) return;
    const parsed = parseNumericInput(amount);
    if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
      setHint(t.amountInvalid);
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setHint(t.dateInvalid);
      return;
    }

    const baselineReceiptUrls = capReceiptUrls(expense.receiptUrls ?? []);

    if (!receiptSlotsUnchanged(receiptSlots, baselineReceiptUrls) && !isStandardUuid(expense.id)) {
      setHint(
        lang === "he"
          ? "שינוי קבלה זמין רק לתנועות שנשמרו בענן."
          : "Receipt changes only apply to cloud-saved transactions.",
      );
      return;
    }

    setSaving(true);
    try {
      let receiptUrlsPatch: string[] | null | undefined = undefined;
      let finalUrls: string[] = [];

      if (!receiptSlotsUnchanged(receiptSlots, baselineReceiptUrls)) {
        if (receiptSlots.length === 0) {
          receiptUrlsPatch = null;
          finalUrls = [];
        } else {
          const cloud = await waitForCloudContext();
          if (!cloud) {
            setHint(
              lang === "he"
                ? "אין חיבור לענן. נסה שוב בעוד רגע."
                : "No cloud connection. Try again shortly.",
            );
            return;
          }
          const results = await Promise.all(
            receiptSlots.map((slot, index) =>
              slot.kind === "remote"
                ? Promise.resolve<{ ok: true; url: string } | { ok: false; error: string }>({
                    ok: true,
                    url: slot.url,
                  })
                : uploadReceiptImage({
                    householdId: cloud.householdId,
                    userId: cloud.userId,
                    expenseId: expense.id,
                    slotIndex: index,
                    file: slot.file,
                  }).then((up) =>
                    "error" in up ? { ok: false as const, error: up.error } : { ok: true as const, url: up.url },
                  ),
            ),
          );
          const urls: string[] = [];
          for (const r of results) {
            if (!r.ok) {
              setHint(
                lang === "he"
                  ? `העלאת קבלה נכשלה: ${r.error}`
                  : `Receipt upload failed: ${r.error}`,
              );
              return;
            }
            const u = r.url.trim();
            if (!u) {
              setHint(
                lang === "he"
                  ? "לא התקבל קישור לתמונה אחרי ההעלאה."
                  : "No image URL returned after upload.",
              );
              return;
            }
            urls.push(u);
          }
          finalUrls = capReceiptUrls(urls);
          receiptUrlsPatch = finalUrls;
        }
      }

      const patch = {
        amount: Math.round(parsed * 100) / 100,
        currency,
        categoryId,
        paymentMethodId,
        type: entryType,
        installments: Math.max(1, Math.floor(installments)),
        recurringMonthly,
        date,
        note: note.trim(),
        ...(receiptUrlsPatch !== undefined ? { receiptUrls: receiptUrlsPatch } : {}),
      };

      const result = await updateExpenseAsync(expense.id, patch);
      if (!result.ok) {
        setHint(result.error);
        return;
      }

      if (!receiptSlotsUnchanged(receiptSlots, baselineReceiptUrls)) {
        const toDelete = baselineReceiptUrls.filter((u) => !finalUrls.includes(u));
        if (toDelete.length) {
          const del = await deleteReceiptObjectsByPublicUrls(toDelete);
          if (del.error) {
            console.warn("[ExpenseEdit] Storage cleanup after receipt change failed", del.error);
          }
        }
      }

      setHint(null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!expense) return;
    const res = await removeExpense(expense.id);
    if (!res.ok) {
      setHint(res.error);
      return;
    }
    onOpenChange(false);
  }

  if (!expense) {
    return null;
  }

  const form = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-2">
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

      <div className="space-y-2 rounded-xl border border-border/60 bg-muted/10 p-3">
        <p className="text-sm font-medium leading-relaxed text-foreground">
          {t.receiptAttachmentLabel}
        </p>
        <input
          ref={receiptInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            const list = e.target.files;
            if (!list?.length) return;
            setReceiptSlots((prev) => {
              const next = [...prev];
              for (const f of list) {
                if (next.length >= MAX_RECEIPT_IMAGES) break;
                if (!f.type.startsWith("image/")) continue;
                next.push({
                  kind: "local",
                  file: f,
                  key: crypto.randomUUID(),
                });
              }
              return next;
            });
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          {receiptSlots.map((slot, idx) => {
            const src =
              slot.kind === "remote"
                ? slot.url
                : localPreviewByKey.get(slot.key) ?? "";
            return (
              <div
                key={slot.kind === "remote" ? `r-${slot.url}-${idx}` : slot.key}
                className="relative inline-flex rounded-lg bg-background/40 p-1 ring-1 ring-border/50"
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className="h-20 w-20 rounded-md object-cover"
                  />
                ) : null}
                <div className="absolute end-0.5 top-0.5 flex gap-0.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="size-7 rounded-full shadow-md"
                    aria-label={t.receiptRemoveAria}
                    onClick={() => {
                      setReceiptSlots((prev) => prev.filter((_, i) => i !== idx));
                    }}
                  >
                    <X className="size-3.5 stroke-[2.5]" aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {receiptSlots.length < MAX_RECEIPT_IMAGES ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => receiptInputRef.current?.click()}
          >
            {receiptSlots.length ? (
              <Upload className="size-4 opacity-80" aria-hidden />
            ) : (
              <ImagePlus className="size-4 opacity-80" aria-hidden />
            )}
            {receiptSlots.length ? t.receiptReplace : t.receiptChooseFile}
          </Button>
        ) : null}
      </div>

      {hint ? (
        <p className="text-sm text-muted-foreground" role="status">
          {hint}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-2 border-t border-border/60 bg-background pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? t.saveInProgress : t.saveChanges}
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
                <AlertDialogAction onClick={() => void handleDelete()}>מחק</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
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
      <SheetContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="shrink-0 border-b border-border/60 px-5 pb-3 pt-4">
          <SheetTitle>{t.editExpenseTitle}</SheetTitle>
          <SheetDescription>{t.editExpenseSubtitle}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-2 overscroll-contain">
          {form}
          {addMethodDialog}
        </div>
      </SheetContent>
    </Sheet>
  );
}
