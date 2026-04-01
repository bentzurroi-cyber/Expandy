import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerField } from "@/components/expense/DatePickerField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssetTypeOption } from "@/context/AssetsContext";
import type { Category, PaymentMethod } from "@/data/mock";
import {
  revalidateAssetRow,
  revalidateIncomeRow,
  type AssetImportRow,
  type IncomeImportRow,
} from "@/lib/smartImport/buildRows";
import { formatNumericInput } from "@/lib/numericInput";
import { normalizeOptionName } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Base = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumps when a new file is parsed so row state resets. */
  sessionId: string;
  dir: "rtl" | "ltr";
  labels: {
    title: string;
    ready: string;
    attention: string;
    confirm: string;
    cancel: string;
    raw: string;
    mustFix: string;
    noReady: string;
    importing: string;
    issues: string;
    applyRow: string;
    editRow: string;
    categoryLabel: string;
    accountLabel: string;
  };
};

type Props =
  | (Base & {
      mode: "assets";
      assetTypes: AssetTypeOption[];
      onCreateAssetType?: (name: string) => Promise<string | null> | string | null;
      initialRows: AssetImportRow[];
      onConfirm: (rows: AssetImportRow[]) => Promise<{ ok: true } | { ok: false; error: string }>;
    })
  | (Base & {
      mode: "incomes";
      incomeSources: Category[];
      destinationAccounts: PaymentMethod[];
      currencyToCode: (raw: string) => string;
      onCreateCategory?: (name: string) => Promise<string | null> | string | null;
      onCreateAccount?: (name: string) => Promise<string | null> | string | null;
      initialRows: IncomeImportRow[];
      onConfirm: (rows: IncomeImportRow[]) => Promise<{ ok: true } | { ok: false; error: string }>;
    })
  | (Base & {
      mode: "expenses";
      expenseCategories: Category[];
      paymentMethods: PaymentMethod[];
      currencyToCode: (raw: string) => string;
      onCreateCategory?: (name: string) => Promise<string | null> | string | null;
      onCreateAccount?: (name: string) => Promise<string | null> | string | null;
      initialRows: IncomeImportRow[];
      onConfirm: (rows: IncomeImportRow[]) => Promise<{ ok: true } | { ok: false; error: string }>;
    });

export function ImportReviewModal(props: Props) {
  const { open, onOpenChange, sessionId, dir, labels } = props;
  const [assetRows, setAssetRows] = useState<AssetImportRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeImportRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (props.mode === "assets") {
      setAssetRows(props.initialRows.map((r) => ({ ...r, amount: formatNumericInput(r.amount) })));
    } else {
      setIncomeRows(props.initialRows.map((r) => ({ ...r, amount: formatNumericInput(r.amount) })));
    }
    // Reset only when a new file/session is opened (not on every parent render).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId scopes the import batch
  }, [open, sessionId]);

  const readyAssets = useMemo(
    () => assetRows.filter((r) => r.status === "ready"),
    [assetRows],
  );
  const attentionAssets = useMemo(
    () => assetRows.filter((r) => r.status === "attention"),
    [assetRows],
  );
  const readyIncomes = useMemo(
    () => incomeRows.filter((r) => r.status === "ready"),
    [incomeRows],
  );
  const attentionIncomes = useMemo(
    () => incomeRows.filter((r) => r.status === "attention"),
    [incomeRows],
  );

  const patchAsset = useCallback(
    (clientId: string, patch: Partial<AssetImportRow>) => {
      if (props.mode !== "assets") return;
      setAssetRows((prev) =>
        prev.map((r) => {
          if (r.clientId !== clientId) return r;
          return {
            ...r,
            ...patch,
            status: "attention",
          };
        }),
      );
    },
    [props],
  );

  const patchIncome = useCallback(
    (clientId: string, patch: Partial<IncomeImportRow>) => {
      if (props.mode !== "incomes" && props.mode !== "expenses") return;
      setIncomeRows((prev) =>
        prev.map((r) => {
          if (r.clientId !== clientId) return r;
          return {
            ...r,
            ...patch,
            status: "attention",
          };
        }),
      );
    },
    [props],
  );

  const applyAssetRow = useCallback(
    (clientId: string) => {
      if (props.mode !== "assets") return;
      setAssetRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? revalidateAssetRow({ ...r }, props.assetTypes)
            : r,
        ),
      );
    },
    [props],
  );

  const bulkApplyAssetTypeLabel = useCallback(
    (rawLabel: string, typeId: string) => {
      if (props.mode !== "assets") return;
      const normalized = normalizeOptionName(rawLabel);
      if (!normalized || !typeId) return;
      setAssetRows((prev) =>
        prev.map((r) => {
          const rowLabel = normalizeOptionName(r.typeLabel);
          if (r.typeId || rowLabel !== normalized) return r;
          return revalidateAssetRow({ ...r, typeId }, props.assetTypes);
        }),
      );
    },
    [props],
  );

  const applyIncomeRow = useCallback(
    (clientId: string) => {
      if (props.mode !== "incomes" && props.mode !== "expenses") return;
      setIncomeRows((prev) =>
        prev.map((r) =>
          r.clientId === clientId
            ? revalidateIncomeRow(
                { ...r },
                props.mode === "incomes" ? props.incomeSources : props.expenseCategories,
                props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods,
                props.currencyToCode,
              )
            : r,
        ),
      );
    },
    [props],
  );

  const bulkApplyCategoryLabel = useCallback(
    (rawLabel: string, categoryId: string) => {
      if (props.mode !== "incomes" && props.mode !== "expenses") return;
      const normalized = normalizeOptionName(rawLabel);
      if (!normalized || !categoryId) return;
      const categories = props.mode === "incomes" ? props.incomeSources : props.expenseCategories;
      const destinations =
        props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods;
      setIncomeRows((prev) =>
        prev.map((r) => {
          const rowLabel = normalizeOptionName(r.categoryLabel);
          if (r.categoryId || rowLabel !== normalized) return r;
          return revalidateIncomeRow(
            { ...r, categoryId },
            categories,
            destinations,
            props.currencyToCode,
          );
        }),
      );
    },
    [props],
  );

  const bulkApplyDestinationLabel = useCallback(
    (rawLabel: string, destinationId: string) => {
      if (props.mode !== "incomes" && props.mode !== "expenses") return;
      const normalized = normalizeOptionName(rawLabel);
      if (!normalized || !destinationId) return;
      const categories = props.mode === "incomes" ? props.incomeSources : props.expenseCategories;
      const destinations =
        props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods;
      setIncomeRows((prev) =>
        prev.map((r) => {
          const rowLabel = normalizeOptionName(r.destinationLabel);
          if (r.destinationId || rowLabel !== normalized) return r;
          return revalidateIncomeRow(
            { ...r, destinationId },
            categories,
            destinations,
            props.currencyToCode,
          );
        }),
      );
    },
    [props],
  );

  const editIncomeReadyRow = useCallback((clientId: string) => {
    setIncomeRows((prev) =>
      prev.map((r) =>
        r.clientId === clientId ? { ...r, status: "attention" as const } : r,
      ),
    );
  }, []);

  const editAssetReadyRow = useCallback((clientId: string) => {
    setAssetRows((prev) =>
      prev.map((r) =>
        r.clientId === clientId ? { ...r, status: "attention" as const } : r,
      ),
    );
  }, []);

  async function handleConfirm() {
    if (props.mode === "assets") {
      const normalized = assetRows.map((r) =>
        revalidateAssetRow({ ...r }, props.assetTypes),
      );
      const ready = normalized.filter((r) => r.status === "ready");
      const attention = normalized.filter((r) => r.status === "attention");
      setAssetRows(normalized);
      if (!ready.length || attention.length) {
        toast.error(labels.mustFix, { id: "import-review-status" });
        return;
      }
      setBusy(true);
      try {
        const res = await props.onConfirm(ready);
        if (res.ok) onOpenChange(false);
        else toast.error(res.error, { id: "import-review-status" });
      } finally {
        setBusy(false);
      }
    } else {
      const normalized = incomeRows.map((r) =>
        revalidateIncomeRow(
          { ...r },
          props.mode === "incomes" ? props.incomeSources : props.expenseCategories,
          props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods,
          props.currencyToCode,
        ),
      );
      const ready = normalized.filter((r) => r.status === "ready");
      const attention = normalized.filter((r) => r.status === "attention");
      setIncomeRows(normalized);
      if (!ready.length || attention.length) {
        toast.error(labels.mustFix, { id: "import-review-status" });
        return;
      }
      setBusy(true);
      try {
        const res = await props.onConfirm(ready);
        if (res.ok) onOpenChange(false);
        else toast.error(res.error, { id: "import-review-status" });
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={dir}
        className="flex max-h-[min(92dvh,880px)] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-start">
          <DialogTitle className="text-lg">{labels.title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {props.mode === "assets"
              ? `${labels.ready} · ${readyAssets.length} · ${labels.attention} · ${attentionAssets.length}`
              : `${labels.ready} · ${readyIncomes.length} · ${labels.attention} · ${attentionIncomes.length}`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {props.mode === "assets" ? (
            <AssetsReviewBody
              ready={readyAssets}
              attention={attentionAssets}
              assetTypes={props.assetTypes}
              onPatch={patchAsset}
              onApplyRow={applyAssetRow}
              onBulkApplyTypeLabel={bulkApplyAssetTypeLabel}
              onCreateType={props.onCreateAssetType}
              labels={labels}
              onEditRow={editAssetReadyRow}
              onRemoveRow={(id) =>
                setAssetRows((prev) => prev.filter((row) => row.clientId !== id))
              }
            />
          ) : (
            <IncomesReviewBody
              ready={readyIncomes}
              attention={attentionIncomes}
              incomeSources={props.mode === "incomes" ? props.incomeSources : props.expenseCategories}
              destinationAccounts={props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods}
              onPatch={patchIncome}
              onApplyRow={applyIncomeRow}
              onBulkApplyCategoryLabel={bulkApplyCategoryLabel}
              onBulkApplyDestinationLabel={bulkApplyDestinationLabel}
              onCreateCategory={props.onCreateCategory}
              onCreateAccount={props.onCreateAccount}
              labels={labels}
              onEditRow={editIncomeReadyRow}
              onRemoveRow={(id) =>
                setIncomeRows((prev) => prev.filter((row) => row.clientId !== id))
              }
            />
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {attentionAssets.length > 0 || attentionIncomes.length > 0
              ? labels.mustFix
              : readyAssets.length === 0 && readyIncomes.length === 0
                ? labels.noReady
                : null}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {labels.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy || (props.mode === "assets" ? attentionAssets.length > 0 : attentionIncomes.length > 0)}
            >
              {busy ? labels.importing : labels.confirm}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetsReviewBody({
  ready,
  attention,
  assetTypes,
  onPatch,
  onApplyRow,
  onBulkApplyTypeLabel,
  onCreateType,
  onEditRow,
  onRemoveRow,
  labels,
}: {
  ready: AssetImportRow[];
  attention: AssetImportRow[];
  assetTypes: AssetTypeOption[];
  onPatch: (id: string, patch: Partial<AssetImportRow>) => void;
  onApplyRow: (id: string) => void;
  onBulkApplyTypeLabel: (rawLabel: string, typeId: string) => void;
  onCreateType?: (name: string) => Promise<string | null> | string | null;
  onEditRow: (id: string) => void;
  onRemoveRow: (id: string) => void;
  labels: Base["labels"];
}) {
  const unresolvedTypeGroups = useMemo(() => {
    const byLabel = new Map<string, { label: string; count: number }>();
    for (const row of attention) {
      if (row.typeId) continue;
      const label = row.typeLabel.trim();
      if (!label) continue;
      const key = normalizeOptionName(label);
      const cur = byLabel.get(key);
      if (cur) cur.count += 1;
      else byLabel.set(key, { label, count: 1 });
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
  }, [attention]);
  const [bulkTypeChoice, setBulkTypeChoice] = useState<Record<string, string>>({});
  const [bulkTypeDraft, setBulkTypeDraft] = useState<Record<string, string>>({});
  const [bulkTypeMode, setBulkTypeMode] = useState<Record<string, "existing" | "new">>({});
  const [creatingAllTypes, setCreatingAllTypes] = useState(false);
  const [bulkCurrency, setBulkCurrency] = useState("ILS");
  const [showReady, setShowReady] = useState(false);
  const [showAttention, setShowAttention] = useState(true);
  const isHebrew = /[\u0590-\u05FF]/.test(labels.title);
  const createdToast = isHebrew ? "נוצר ונשמר בהצלחה" : "Created and saved successfully";
  const missingCurrencyRows = useMemo(
    () => attention.filter((r) => !r.currency.trim()),
    [attention],
  );

  return (
    <div className="space-y-8">
      {unresolvedTypeGroups.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">
            {isHebrew ? "טיפול מרוכז בסוגי נכסים לא מזוהים" : "Bulk fix for unknown asset types"}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!onCreateType || creatingAllTypes}
              onClick={async () => {
                if (!onCreateType) return;
                setCreatingAllTypes(true);
                try {
                  for (const group of unresolvedTypeGroups) {
                    const key = normalizeOptionName(group.label);
                    const draftLabel = (bulkTypeDraft[key] ?? group.label).trim() || group.label;
                    const existing = assetTypes.find(
                      (t) => normalizeOptionName(t.name) === normalizeOptionName(draftLabel),
                    );
                    if (existing?.id) {
                      onBulkApplyTypeLabel(group.label, existing.id);
                      continue;
                    }
                    const createdId = await onCreateType(draftLabel);
                    if (createdId) {
                      onBulkApplyTypeLabel(group.label, createdId);
                      toast.success(createdToast);
                    }
                  }
                } finally {
                  setCreatingAllTypes(false);
                }
              }}
            >
              {isHebrew ? "צור את כל הסוגים והחל" : "Create all types and apply"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isHebrew
                ? "בכמות מידע גדולה הפעולה עשויה לקחת מעט זמן."
                : "With large datasets this action may take a little longer."}
            </span>
          </div>
          <ul className="space-y-2">
            {unresolvedTypeGroups.map((group) => {
              const key = normalizeOptionName(group.label);
              const choice = bulkTypeChoice[key] ?? "__none__";
              const draftLabel = bulkTypeDraft[key] ?? group.label;
              const mode = bulkTypeMode[key] ?? "new";
              return (
                <li key={key} className="rounded-lg border border-border/60 bg-background/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{group.label}</p>
                    <span className="text-xs text-muted-foreground">
                      {isHebrew ? `${group.count} שורות` : `${group.count} rows`}
                    </span>
                  </div>
                  <div className="mb-2 inline-flex rounded-md border border-border/70 bg-muted/20 p-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "existing" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setBulkTypeMode((prev) => ({ ...prev, [key]: "existing" }))}
                    >
                      {isHebrew ? "בחר קיים" : "Pick existing"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "new" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setBulkTypeMode((prev) => ({ ...prev, [key]: "new" }))}
                    >
                      {isHebrew ? "שם חדש" : "New name"}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={draftLabel}
                      onChange={(e) => {
                        setBulkTypeMode((prev) => ({ ...prev, [key]: "new" }));
                        setBulkTypeDraft((prev) => ({ ...prev, [key]: e.target.value }));
                      }}
                      placeholder={isHebrew ? "שם סוג חדש" : "New type name"}
                      className="w-full sm:flex-1"
                      disabled={mode !== "new"}
                    />
                    <Select
                      value={choice}
                      onValueChange={(v) => {
                        setBulkTypeMode((prev) => ({ ...prev, [key]: "existing" }));
                        setBulkTypeChoice((prev) => ({ ...prev, [key]: v }));
                      }}
                      disabled={mode !== "existing"}
                    >
                      <SelectTrigger className="w-full sm:flex-1">
                        <SelectValue placeholder={isHebrew ? "בחירת סוג קיים" : "Choose existing type"} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {assetTypes.map((t) => (
                          <SelectItem key={`${key}-${t.id}`} value={t.id} textValue={t.name}>
                            <SelectItemText>{t.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={mode !== "existing" || choice === "__none__"}
                      onClick={() => onBulkApplyTypeLabel(group.label, choice)}
                    >
                      {isHebrew ? "החל על כל השורות" : "Apply to all rows"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!onCreateType || mode !== "new"}
                      onClick={async () => {
                        if (!onCreateType) return;
                        const createdId = await onCreateType(draftLabel.trim() || group.label);
                        if (createdId) {
                          onBulkApplyTypeLabel(group.label, createdId);
                          toast.success(createdToast);
                        }
                      }}
                    >
                      {isHebrew ? "צור סוג והחל" : "Create type & apply"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {missingCurrencyRows.length > 3 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">
            {isHebrew ? "תיקון מרוכז למטבע חסר" : "Bulk fix for missing currency"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isHebrew
              ? "יש כמה שורות בלי מטבע. אפשר להגדיר מטבע אחד לכולן בלחיצה."
              : "Several rows have no currency. You can apply one currency to all at once."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              dir="ltr"
              value={bulkCurrency}
              onChange={(e) => setBulkCurrency(e.target.value.toUpperCase())}
              placeholder="ILS / USD / EUR"
              className="w-full sm:flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const next = bulkCurrency.trim().toUpperCase();
                if (!next) return;
                for (const row of missingCurrencyRows) {
                  onPatch(row.clientId, { currency: next });
                  onApplyRow(row.clientId);
                }
              }}
            >
              {isHebrew ? "החל על כל השורות החסרות" : "Apply to all missing rows"}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden />
            {labels.ready} ({ready.length})
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowReady((v) => !v)}>
            {showReady ? (isHebrew ? "הסתר" : "Hide") : isHebrew ? "הצג" : "Show"}
          </Button>
        </div>
        {!showReady ? null : ready.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            {ready.map((r) => (
              <li key={r.clientId} className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <span className="font-medium">{r.dateIso}</span>
                <span>{r.name}</span>
                <span>{formatNumericInput(r.amount)}</span>
                <span className="text-muted-foreground">
                  {assetTypes.find((t) => t.id === r.typeId)?.name ?? r.typeLabel}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
                  onClick={() => onEditRow(r.clientId)}
                  aria-label={labels.editRow}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-destructive"
                  onClick={() => onRemoveRow(r.clientId)}
                  aria-label={isHebrew ? "הסר שורה" : "Remove row"}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" aria-hidden />
            {labels.attention} ({attention.length})
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAttention((v) => !v)}
          >
            {showAttention ? (isHebrew ? "הסתר" : "Hide") : isHebrew ? "הצג" : "Show"}
          </Button>
        </div>
        {!showAttention ? null : attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-4">
            {attention.map((r) => (
              <li
                key={r.clientId}
                className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-4 dark:border-amber-500/25 dark:bg-amber-500/10"
              >
                <p className="mb-2 text-xs font-medium text-muted-foreground">{labels.raw}</p>
                <pre className="mb-3 max-h-24 overflow-auto rounded-md bg-background/80 p-2 text-xs leading-relaxed">
                  {JSON.stringify(r.raw)}
                </pre>
                {r.issues.length > 0 ? (
                  <p className="mb-3 text-xs text-destructive">
                    {labels.issues}: {r.issues.join(" · ")}
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">תאריך</Label>
                    <DatePickerField
                      id={`asset-import-date-${r.clientId}`}
                      label="תאריך"
                      value={r.dateIso.length >= 10 ? r.dateIso.slice(0, 10) : ""}
                      onChange={(iso) => onPatch(r.clientId, { dateIso: iso })}
                      variant="row"
                      hideLabel
                      triggerClassName="h-11 rounded-md border border-input bg-background px-3 py-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">סכום</Label>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) =>
                        onPatch(r.clientId, {
                          amount: formatNumericInput(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatNumericInput(r.amount)}
                    </p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">שם</Label>
                    <Input
                      value={r.name}
                      onChange={(e) => onPatch(r.clientId, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">סוג נכס</Label>
                    <Select
                      value={r.typeId ?? "__none__"}
                      onValueChange={(v) => {
                        const typeId = v === "__none__" ? null : v;
                        const label = assetTypes.find((t) => t.id === typeId)?.name ?? r.typeLabel;
                        onPatch(r.clientId, { typeId, typeLabel: label });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="בחרו סוג" />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {assetTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id} textValue={t.name}>
                            <SelectItemText>{t.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">{isHebrew ? "שם סוג חדש" : "New type name"}</Label>
                    <Input
                      value={r.typeLabel}
                      onChange={(e) => onPatch(r.clientId, { typeLabel: e.target.value, typeId: null })}
                      placeholder={isHebrew ? "הקלידו שם סוג" : "Enter type name"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">מטבע (קוד / סימול)</Label>
                    <Input
                      dir="ltr"
                      value={r.currency}
                      onChange={(e) => onPatch(r.clientId, { currency: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => onApplyRow(r.clientId)}>
                        {labels.applyRow}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onRemoveRow(r.clientId)}
                      >
                        {isHebrew ? "הסר שורה" : "Remove row"}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IncomesReviewBody({
  ready,
  attention,
  incomeSources,
  destinationAccounts,
  onPatch,
  onApplyRow,
  onBulkApplyCategoryLabel,
  onBulkApplyDestinationLabel,
  onCreateCategory,
  onCreateAccount,
  onEditRow,
  onRemoveRow,
  labels,
}: {
  ready: IncomeImportRow[];
  attention: IncomeImportRow[];
  incomeSources: Category[];
  destinationAccounts: PaymentMethod[];
  onPatch: (id: string, patch: Partial<IncomeImportRow>) => void;
  onApplyRow: (id: string) => void;
  onBulkApplyCategoryLabel: (rawLabel: string, categoryId: string) => void;
  onBulkApplyDestinationLabel: (rawLabel: string, destinationId: string) => void;
  onCreateCategory?: (name: string) => Promise<string | null> | string | null;
  onCreateAccount?: (name: string) => Promise<string | null> | string | null;
  onEditRow: (id: string) => void;
  onRemoveRow: (id: string) => void;
  labels: Base["labels"];
}) {
  const unresolvedCategoryGroups = useMemo(() => {
    const byLabel = new Map<string, { label: string; count: number }>();
    for (const row of attention) {
      if (row.categoryId) continue;
      const label = row.categoryLabel.trim();
      if (!label) continue;
      const key = normalizeOptionName(label);
      const cur = byLabel.get(key);
      if (cur) cur.count += 1;
      else byLabel.set(key, { label, count: 1 });
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
  }, [attention]);
  const [bulkCategoryChoice, setBulkCategoryChoice] = useState<Record<string, string>>({});
  const [bulkCategoryDraft, setBulkCategoryDraft] = useState<Record<string, string>>({});
  const [bulkCategoryMode, setBulkCategoryMode] = useState<
    Record<string, "existing" | "new">
  >({});
  const [creatingCategoryKey, setCreatingCategoryKey] = useState<string | null>(null);
  const [creatingAll, setCreatingAll] = useState(false);
  const unresolvedDestinationGroups = useMemo(() => {
    const byLabel = new Map<string, { label: string; count: number }>();
    for (const row of attention) {
      if (row.destinationId) continue;
      const label = row.destinationLabel.trim();
      if (!label) continue;
      const key = normalizeOptionName(label);
      const cur = byLabel.get(key);
      if (cur) cur.count += 1;
      else byLabel.set(key, { label, count: 1 });
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "he"));
  }, [attention]);
  const [bulkDestinationChoice, setBulkDestinationChoice] = useState<Record<string, string>>({});
  const [bulkDestinationDraft, setBulkDestinationDraft] = useState<Record<string, string>>({});
  const [bulkDestinationMode, setBulkDestinationMode] = useState<
    Record<string, "existing" | "new">
  >({});
  const [creatingDestinationKey, setCreatingDestinationKey] = useState<string | null>(null);
  const [creatingAllDestinations, setCreatingAllDestinations] = useState(false);
  const [bulkCurrency, setBulkCurrency] = useState("ILS");
  const [showReady, setShowReady] = useState(false);
  const [showAttention, setShowAttention] = useState(true);
  const isHebrew = /[\u0590-\u05FF]/.test(labels.title);
  const isIncomeMode = /income/i.test(labels.title);
  const accountEntityHe = isIncomeMode ? "חשבונות יעד" : "אמצעי תשלום";
  const accountEntitySingleHe = isIncomeMode ? "חשבון יעד" : "אמצעי תשלום";
  const accountEntityEn = isIncomeMode ? "destination accounts" : "payment methods";
  const accountEntitySingleEn = isIncomeMode ? "destination account" : "payment method";
  const createdToast = isHebrew ? "נוצר ונשמר בהצלחה" : "Created and saved successfully";
  const normalizeIssueText = useCallback(
    (issue: string): string => {
      if (isIncomeMode) return issue;
      if (isHebrew) {
        if (issue.includes("חשבון יעד")) return issue.replace(/חשבון יעד/g, "אמצעי תשלום");
      } else if (/destination account/i.test(issue)) {
        return issue.replace(/destination account/gi, "payment method");
      }
      return issue;
    },
    [isHebrew, isIncomeMode],
  );
  const missingCurrencyRows = useMemo(
    () =>
      attention.filter(
        (r) =>
          !r.currency.trim() ||
          r.issues.some((issue) => issue.includes("מטבע") || /currency/i.test(issue)),
      ),
    [attention],
  );

  return (
    <div className="space-y-8">
      {unresolvedCategoryGroups.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">
            {isHebrew ? "טיפול מרוכז בקטגוריות לא מזוהות" : "Bulk fix for unknown categories"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isHebrew
              ? "בחרו קטגוריה קיימת או צרו קטגוריה חדשה - והשיוך יחול אוטומטית על כל השורות עם אותו שם."
              : "Choose an existing category or create a new one, and apply it to all rows with the same label."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!onCreateCategory || creatingAll}
              onClick={async () => {
                if (!onCreateCategory) return;
                setCreatingAll(true);
                try {
                  for (const group of unresolvedCategoryGroups) {
                    const key = normalizeOptionName(group.label);
                    const draftLabel = (bulkCategoryDraft[key] ?? group.label).trim() || group.label;
                    const existing = incomeSources.find(
                      (c) => normalizeOptionName(c.name) === normalizeOptionName(draftLabel),
                    );
                    if (existing?.id) {
                      onBulkApplyCategoryLabel(group.label, existing.id);
                      continue;
                    }
                    const createdId = await onCreateCategory(draftLabel);
                    if (createdId) {
                      onBulkApplyCategoryLabel(group.label, createdId);
                      toast.success(createdToast);
                    }
                  }
                } finally {
                  setCreatingAll(false);
                }
              }}
            >
              {isHebrew ? "צור את כל הקטגוריות והחל" : "Create all categories and apply"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isHebrew
                ? "בכמות מידע גדולה הפעולה עשויה לקחת מעט זמן."
                : "With large datasets this action may take a little longer."}
            </span>
          </div>
          <ul className="space-y-2">
            {unresolvedCategoryGroups.map((group) => {
              const groupKey = normalizeOptionName(group.label);
              const choice = bulkCategoryChoice[groupKey] ?? "__none__";
              const draftLabel = bulkCategoryDraft[groupKey] ?? group.label;
              const mode = bulkCategoryMode[groupKey] ?? "new";
              return (
                <li key={groupKey} className="rounded-lg border border-border/60 bg-background/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{group.label}</p>
                    <span className="text-xs text-muted-foreground">
                      {isHebrew ? `${group.count} שורות` : `${group.count} rows`}
                    </span>
                  </div>
                  <div className="mb-2 inline-flex rounded-md border border-border/70 bg-muted/20 p-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "existing" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() =>
                        setBulkCategoryMode((prev) => ({ ...prev, [groupKey]: "existing" }))
                      }
                    >
                      {isHebrew ? "בחר קיים" : "Pick existing"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "new" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() =>
                        setBulkCategoryMode((prev) => ({ ...prev, [groupKey]: "new" }))
                      }
                    >
                      {isHebrew ? "שם חדש" : "New name"}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={draftLabel}
                      onChange={(e) => {
                        setBulkCategoryMode((prev) => ({ ...prev, [groupKey]: "new" }));
                        setBulkCategoryDraft((prev) => ({ ...prev, [groupKey]: e.target.value }));
                      }}
                      placeholder={isHebrew ? "שם קטגוריה חדשה" : "New category name"}
                      className="w-full sm:flex-1"
                      disabled={mode !== "new"}
                    />
                    <Select
                      value={choice}
                      onValueChange={(v) => {
                        setBulkCategoryMode((prev) => ({ ...prev, [groupKey]: "existing" }));
                        setBulkCategoryChoice((prev) => ({
                          ...prev,
                          [groupKey]: v,
                        }));
                      }}
                      disabled={mode !== "existing"}
                    >
                      <SelectTrigger className="w-full sm:flex-1">
                        <SelectValue placeholder={isHebrew ? "בחירת קטגוריה קיימת" : "Choose existing category"} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {incomeSources.map((c) => (
                          <SelectItem key={`${group.label}-${c.id}`} value={c.id} textValue={c.name}>
                            <SelectItemText>{c.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={mode !== "existing" || choice === "__none__"}
                      onClick={() => onBulkApplyCategoryLabel(group.label, choice)}
                    >
                      {isHebrew ? "החל על כל השורות" : "Apply to all rows"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!onCreateCategory || creatingCategoryKey === groupKey || mode !== "new"}
                      onClick={async () => {
                        if (!onCreateCategory) return;
                        const key = groupKey;
                        setCreatingCategoryKey(key);
                        try {
                          const createdId = await onCreateCategory(draftLabel.trim() || group.label);
                          if (createdId) {
                            onBulkApplyCategoryLabel(group.label, createdId);
                            toast.success(createdToast);
                          }
                        } finally {
                          setCreatingCategoryKey((cur) => (cur === key ? null : cur));
                        }
                      }}
                    >
                      {isHebrew ? "צור קטגוריה והחל" : "Create category & apply"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {unresolvedDestinationGroups.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">
            {isHebrew
              ? `טיפול מרוכז ב${accountEntityHe} לא מזוהים`
              : `Bulk fix for unknown ${accountEntityEn}`}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isHebrew
              ? `בחרו ${accountEntitySingleHe} קיים או צרו ${accountEntitySingleHe} חדש - והשיוך יחול אוטומטית על כל השורות עם אותו שם.`
              : `Choose an existing ${accountEntitySingleEn} or create a new one, and apply it to all rows with the same label.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!onCreateAccount || creatingAllDestinations}
              onClick={async () => {
                if (!onCreateAccount) return;
                setCreatingAllDestinations(true);
                try {
                  for (const group of unresolvedDestinationGroups) {
                    const key = normalizeOptionName(group.label);
                    const draftLabel = (bulkDestinationDraft[key] ?? group.label).trim() || group.label;
                    const existing = destinationAccounts.find(
                      (d) => normalizeOptionName(d.name) === normalizeOptionName(draftLabel),
                    );
                    if (existing?.id) {
                      onBulkApplyDestinationLabel(group.label, existing.id);
                      continue;
                    }
                    const createdId = await onCreateAccount(draftLabel);
                    if (createdId) {
                      onBulkApplyDestinationLabel(group.label, createdId);
                      toast.success(createdToast);
                    }
                  }
                } finally {
                  setCreatingAllDestinations(false);
                }
              }}
            >
              {isHebrew
                ? `צור את כל ה${accountEntityHe} והחל`
                : `Create all ${accountEntityEn} and apply`}
            </Button>
          </div>
          <ul className="space-y-2">
            {unresolvedDestinationGroups.map((group) => {
              const groupKey = normalizeOptionName(group.label);
              const choice = bulkDestinationChoice[groupKey] ?? "__none__";
              const draftLabel = bulkDestinationDraft[groupKey] ?? group.label;
              const mode = bulkDestinationMode[groupKey] ?? "new";
              return (
                <li key={groupKey} className="rounded-lg border border-border/60 bg-background/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{group.label}</p>
                    <span className="text-xs text-muted-foreground">
                      {isHebrew ? `${group.count} שורות` : `${group.count} rows`}
                    </span>
                  </div>
                  <div className="mb-2 inline-flex rounded-md border border-border/70 bg-muted/20 p-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "existing" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() =>
                        setBulkDestinationMode((prev) => ({ ...prev, [groupKey]: "existing" }))
                      }
                    >
                      {isHebrew ? "בחר קיים" : "Pick existing"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "new" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setBulkDestinationMode((prev) => ({ ...prev, [groupKey]: "new" }))}
                    >
                      {isHebrew ? "שם חדש" : "New name"}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={draftLabel}
                      onChange={(e) => {
                        setBulkDestinationMode((prev) => ({ ...prev, [groupKey]: "new" }));
                        setBulkDestinationDraft((prev) => ({ ...prev, [groupKey]: e.target.value }));
                      }}
                      placeholder={isHebrew ? "שם חשבון חדש" : "New account name"}
                      className="w-full sm:flex-1"
                      disabled={mode !== "new"}
                    />
                    <Select
                      value={choice}
                      onValueChange={(v) => {
                        setBulkDestinationMode((prev) => ({ ...prev, [groupKey]: "existing" }));
                        setBulkDestinationChoice((prev) => ({ ...prev, [groupKey]: v }));
                      }}
                      disabled={mode !== "existing"}
                    >
                      <SelectTrigger className="w-full sm:flex-1">
                        <SelectValue placeholder={isHebrew ? "בחירת חשבון קיים" : "Choose existing account"} />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {destinationAccounts.map((d) => (
                          <SelectItem key={`${group.label}-${d.id}`} value={d.id} textValue={d.name}>
                            <SelectItemText>{d.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={mode !== "existing" || choice === "__none__"}
                      onClick={() => onBulkApplyDestinationLabel(group.label, choice)}
                    >
                      {isHebrew ? "החל על כל השורות" : "Apply to all rows"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!onCreateAccount || creatingDestinationKey === groupKey || mode !== "new"}
                      onClick={async () => {
                        if (!onCreateAccount) return;
                        setCreatingDestinationKey(groupKey);
                        try {
                          const createdId = await onCreateAccount(draftLabel.trim() || group.label);
                          if (createdId) {
                            onBulkApplyDestinationLabel(group.label, createdId);
                            toast.success(createdToast);
                          }
                        } finally {
                          setCreatingDestinationKey((cur) => (cur === groupKey ? null : cur));
                        }
                      }}
                    >
                      {isHebrew
                        ? `צור ${accountEntitySingleHe} והחל`
                        : `Create ${accountEntitySingleEn} & apply`}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {missingCurrencyRows.length > 3 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">
            {isHebrew ? "תיקון מרוכז למטבע חסר" : "Bulk fix for missing currency"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isHebrew
              ? "יש כמה שורות בלי מטבע. אפשר להגדיר מטבע אחד לכולן בלחיצה."
              : "Several rows have no currency. You can apply one currency to all at once."}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              dir="ltr"
              value={bulkCurrency}
              onChange={(e) => setBulkCurrency(e.target.value.toUpperCase())}
              placeholder="ILS / USD / EUR"
              className="w-full sm:flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const next = bulkCurrency.trim().toUpperCase();
                if (!next) return;
                for (const row of missingCurrencyRows) {
                  onPatch(row.clientId, { currency: next });
                  onApplyRow(row.clientId);
                }
              }}
            >
              {isHebrew ? "החל על כל השורות החסרות" : "Apply to all missing rows"}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" aria-hidden />
            {labels.ready} ({ready.length})
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowReady((v) => !v)}>
            {showReady ? (isHebrew ? "הסתר" : "Hide") : isHebrew ? "הצג" : "Show"}
          </Button>
        </div>
        {!showReady ? null : ready.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            {ready.map((r) => (
              <li key={r.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                <span className="font-medium">{r.dateIso}</span>
                <span>{formatNumericInput(r.amount)}</span>
                <span>{r.currency}</span>
                <span>{incomeSources.find((c) => c.id === r.categoryId)?.name ?? r.categoryLabel}</span>
                <span className="text-muted-foreground">
                  {destinationAccounts.find((d) => d.id === r.destinationId)?.name ?? r.destinationLabel}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
                  onClick={() => onEditRow(r.clientId)}
                  aria-label={labels.editRow}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-transparent bg-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-destructive"
                  onClick={() => onRemoveRow(r.clientId)}
                  aria-label={isHebrew ? "הסר שורה" : "Remove row"}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" aria-hidden />
            {labels.attention} ({attention.length})
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAttention((v) => !v)}
          >
            {showAttention ? (isHebrew ? "הסתר" : "Hide") : isHebrew ? "הצג" : "Show"}
          </Button>
        </div>
        {!showAttention ? null : attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-4">
            {attention.map((r) => (
              <li
                key={r.clientId}
                className={cn(
                  "rounded-xl border border-amber-500/35 bg-amber-500/5 p-4 dark:border-amber-500/25 dark:bg-amber-500/10",
                )}
              >
                <p className="mb-2 text-xs font-medium text-muted-foreground">{labels.raw}</p>
                <pre className="mb-3 max-h-24 overflow-auto rounded-md bg-background/80 p-2 text-xs leading-relaxed">
                  {JSON.stringify(r.raw)}
                </pre>
                {r.issues.length > 0 ? (
                  <p className="mb-3 text-xs text-destructive">
                    {labels.issues}: {r.issues.map(normalizeIssueText).join(" · ")}
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">תאריך</Label>
                    <DatePickerField
                      id={`income-import-date-${r.clientId}`}
                      label="תאריך"
                      value={r.dateIso.length >= 10 ? r.dateIso.slice(0, 10) : ""}
                      onChange={(iso) => onPatch(r.clientId, { dateIso: iso })}
                      variant="row"
                      hideLabel
                      triggerClassName="h-11 rounded-md border border-input bg-background px-3 py-2"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">סכום</Label>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) =>
                        onPatch(r.clientId, {
                          amount: formatNumericInput(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatNumericInput(r.amount)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">מטבע (קוד או סימול)</Label>
                    <Input
                      dir="ltr"
                      placeholder="ILS / ₪"
                      value={r.currency}
                      onChange={(e) => onPatch(r.clientId, { currency: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{labels.categoryLabel}</Label>
                    <Select
                      value={r.categoryId ?? "__none__"}
                      onValueChange={(v) => {
                        const categoryId = v === "__none__" ? null : v;
                        const cat = incomeSources.find((c) => c.id === categoryId);
                        onPatch(r.clientId, {
                          categoryId,
                          categoryLabel: cat?.name ?? "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="בחרו" />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {incomeSources.map((c) => (
                          <SelectItem key={c.id} value={c.id} textValue={c.name}>
                            <SelectItemText>{c.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">{isHebrew ? "שם קטגוריה חדש" : "New category name"}</Label>
                    <Input
                      value={r.categoryLabel}
                      onChange={(e) =>
                        onPatch(r.clientId, {
                          categoryLabel: e.target.value,
                          categoryId: null,
                        })
                      }
                      placeholder={isHebrew ? "הקלידו שם קטגוריה" : "Enter category name"}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">{labels.accountLabel}</Label>
                    <Select
                      value={r.destinationId ?? "__none__"}
                      onValueChange={(v) => {
                        const destinationId = v === "__none__" ? null : v;
                        const dest = destinationAccounts.find((d) => d.id === destinationId);
                        onPatch(r.clientId, {
                          destinationId,
                          destinationLabel: dest?.name ?? "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="בחרו" />
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[200]">
                        <SelectItem value="__none__" textValue="—">
                          <SelectItemText>—</SelectItemText>
                        </SelectItem>
                        {destinationAccounts.map((d) => (
                          <SelectItem key={d.id} value={d.id} textValue={d.name}>
                            <SelectItemText>{d.name}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">הערות</Label>
                    <Input value={r.note} onChange={(e) => onPatch(r.clientId, { note: e.target.value })} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => onApplyRow(r.clientId)}>
                        {labels.applyRow}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onRemoveRow(r.clientId)}
                      >
                        {isHebrew ? "הסר שורה" : "Remove row"}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

