import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Pencil } from "lucide-react";
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
      initialRows: AssetImportRow[];
      onConfirm: (rows: AssetImportRow[]) => Promise<{ ok: true } | { ok: false; error: string }>;
    })
  | (Base & {
      mode: "incomes";
      incomeSources: Category[];
      destinationAccounts: PaymentMethod[];
      currencyToCode: (raw: string) => string;
      initialRows: IncomeImportRow[];
      onConfirm: (rows: IncomeImportRow[]) => Promise<{ ok: true } | { ok: false; error: string }>;
    })
  | (Base & {
      mode: "expenses";
      expenseCategories: Category[];
      paymentMethods: PaymentMethod[];
      currencyToCode: (raw: string) => string;
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
              labels={labels}
              onEditRow={editAssetReadyRow}
            />
          ) : (
            <IncomesReviewBody
              ready={readyIncomes}
              attention={attentionIncomes}
              incomeSources={props.mode === "incomes" ? props.incomeSources : props.expenseCategories}
              destinationAccounts={props.mode === "incomes" ? props.destinationAccounts : props.paymentMethods}
              onPatch={patchIncome}
              onApplyRow={applyIncomeRow}
              labels={labels}
              onEditRow={editIncomeReadyRow}
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
  onEditRow,
  labels,
}: {
  ready: AssetImportRow[];
  attention: AssetImportRow[];
  assetTypes: AssetTypeOption[];
  onPatch: (id: string, patch: Partial<AssetImportRow>) => void;
  onApplyRow: (id: string) => void;
  onEditRow: (id: string) => void;
  labels: Base["labels"];
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden />
          {labels.ready} ({ready.length})
        </h3>
        {ready.length === 0 ? (
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4" aria-hidden />
          {labels.attention} ({attention.length})
        </h3>
        {attention.length === 0 ? (
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
                    <Label className="text-xs">{labels.raw} — תאריך</Label>
                    <DatePickerField
                      id={`asset-import-date-${r.clientId}`}
                      label={labels.raw}
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
                  <div className="space-y-1">
                    <Label className="text-xs">מטבע (קוד / סימול)</Label>
                    <Input
                      dir="ltr"
                      value={r.currency}
                      onChange={(e) => onPatch(r.clientId, { currency: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Button type="button" variant="secondary" onClick={() => onApplyRow(r.clientId)}>
                      {labels.applyRow}
                    </Button>
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
  onEditRow,
  labels,
}: {
  ready: IncomeImportRow[];
  attention: IncomeImportRow[];
  incomeSources: Category[];
  destinationAccounts: PaymentMethod[];
  onPatch: (id: string, patch: Partial<IncomeImportRow>) => void;
  onApplyRow: (id: string) => void;
  onEditRow: (id: string) => void;
  labels: Base["labels"];
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden />
          {labels.ready} ({ready.length})
        </h3>
        {ready.length === 0 ? (
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4" aria-hidden />
          {labels.attention} ({attention.length})
        </h3>
        {attention.length === 0 ? (
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
                    {labels.issues}: {r.issues.join(" · ")}
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">תאריך</Label>
                    <DatePickerField
                      id={`income-import-date-${r.clientId}`}
                      label={labels.raw}
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
                    <Button type="button" variant="secondary" onClick={() => onApplyRow(r.clientId)}>
                      {labels.applyRow}
                    </Button>
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

