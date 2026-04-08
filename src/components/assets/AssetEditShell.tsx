import { useEffect, useState } from "react";
import { Landmark, TrendingUp, Wallet } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CurrencyGlyph } from "@/components/expense/FinanceGlyphs";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useI18n } from "@/context/I18nContext";
import { currencyOptionLabel } from "@/lib/format";
import type { AssetAccount, CurrencyDef } from "@/data/mock";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { hebrewMonthYearLabel, type YearMonth } from "@/lib/month";
import { localizedAssetTypeName } from "@/lib/defaultEntityLabels";
import { cn } from "@/lib/utils";
import type { AssetTypeOption } from "@/context/AssetsContext";

function AssetTypeGlyph({ typeId }: { typeId: string }) {
  const cls = "size-5 shrink-0";
  if (typeId === "portfolio")
    return <TrendingUp className={cn(cls, "text-sky-600/85 dark:text-sky-400/90")} aria-hidden />;
  if (typeId === "pension")
    return <Landmark className={cn(cls, "text-violet-600/85 dark:text-violet-400/90")} aria-hidden />;
  return <Wallet className={cn(cls, "text-emerald-600/85 dark:text-emerald-400/90")} aria-hidden />;
}

type AssetEditShellProps = {
  asset: AssetAccount | null;
  currencies: CurrencyDef[];
  assetTypes: AssetTypeOption[];
  /** חודש התצוגה הנוכחי במסך הנכסים — לא משתנה כשמזיזים את תאריך היתרה */
  snapshotMonth: YearMonth;
  onOpenChange: (open: boolean) => void;
  onSave: (
    id: string,
    balance: number,
    currency: string,
    name: string,
    balanceDate: string,
    assetTypeId: string,
  ) => void | Promise<void>;
  /** Whether this base id has DB rows outside `snapshotMonth`. */
  probeAssetRowsOutsideMonth: (id: string) => Promise<boolean>;
  /** Remove rows for this asset in `snapshotMonth` only. Return whether it succeeded. */
  onRemoveFromMonth: (id: string) => Promise<boolean>;
  /** Delete all rows for this logical asset (all months). */
  onDeletePermanently: (id: string) => void;
};

export function AssetEditShell({
  asset,
  currencies,
  assetTypes,
  snapshotMonth,
  onOpenChange,
  onSave,
  probeAssetRowsOutsideMonth,
  onRemoveFromMonth,
  onDeletePermanently,
}: AssetEditShellProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { t, dir, lang } = useI18n();
  const [balanceInput, setBalanceInput] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [name, setName] = useState("");
  const [assetTypeId, setAssetTypeId] = useState<string>("liquid");
  const [entryIso, setEntryIso] = useState(`${snapshotMonth}-01`);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteProbeLoading, setDeleteProbeLoading] = useState(false);
  const [hasRowsOutsideMonth, setHasRowsOutsideMonth] = useState<boolean | null>(null);

  useEffect(() => {
    if (!asset) return;
    setBalanceInput(formatNumericInput(String(asset.balance)));
    setCurrency(asset.currency ?? "ILS");
    setName(asset.name ?? "");
    setAssetTypeId(asset.type ?? "liquid");
  }, [asset]);

  useEffect(() => {
    if (!asset) return;
    const d =
      asset.balanceDate && /^\d{4}-\d{2}-\d{2}$/.test(asset.balanceDate)
        ? asset.balanceDate
        : `${snapshotMonth}-01`;
    setEntryIso(d);
  }, [asset, snapshotMonth]);

  useEffect(() => {
    if (!deleteDialogOpen || !asset) return;
    let cancelled = false;
    setDeleteProbeLoading(true);
    setHasRowsOutsideMonth(null);
    void (async () => {
      try {
        const h = await probeAssetRowsOutsideMonth(asset.id);
        if (!cancelled) setHasRowsOutsideMonth(h);
      } catch {
        if (!cancelled) setHasRowsOutsideMonth(true);
      } finally {
        if (!cancelled) setDeleteProbeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deleteDialogOpen, asset, probeAssetRowsOutsideMonth]);

  const monthLabel =
    lang === "he" ? hebrewMonthYearLabel(snapshotMonth) : snapshotMonth;

  if (!asset) return null;

  const typeAccent =
    assetTypes.find((x) => x.id === assetTypeId)?.color?.trim() ?? "#94a3b8";

  const body = (
    <div className="space-y-4">
      <DatePickerField
        id="asset-edit-balance-date"
        label={t.assetBalanceEntryMonth}
        value={entryIso}
        onChange={(iso) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) setEntryIso(iso);
        }}
        triggerClassName="h-12 min-h-12 rounded-xl border border-input bg-background px-3.5 py-2.5 ps-3"
      />
      <div className="space-y-2">
        <Label htmlFor="asset-edit-type">{t.assetSnapshotType}</Label>
        <div className="flex items-center gap-3">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted/50"
            style={
              /^#[0-9a-fA-F]{6}$/.test(typeAccent)
                ? { backgroundColor: `${typeAccent}22` }
                : undefined
            }
          >
            <AssetTypeGlyph typeId={assetTypeId} />
          </div>
          <Select value={assetTypeId} onValueChange={setAssetTypeId}>
            <SelectTrigger id="asset-edit-type" className="min-h-11 flex-1 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {assetTypes.map((opt) => {
                const label = localizedAssetTypeName(opt.id, opt.name, lang);
                return (
                  <SelectItem key={opt.id} value={opt.id} textValue={label}>
                    <SelectItemText>{label}</SelectItemText>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-edit-name">{t.assetSnapshotName}</Label>
        <Input
          id="asset-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-edit-balance">{t.assetSnapshotBalance}</Label>
        <Input
          id="asset-edit-balance"
          type="text"
          inputMode="decimal"
          dir="ltr"
          className="tabular-nums"
          value={balanceInput}
          onChange={(e) => setBalanceInput(formatNumericInput(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-edit-currency">{t.assetSnapshotCurrency}</Label>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger id="asset-edit-currency" className="w-full">
            <div className="flex min-w-0 items-center gap-2">
              <CurrencyGlyph
                iconKey={currencies.find((c) => c.code === currency)?.iconKey ?? "ils"}
                className="size-3.5"
              />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent position="popper">
            {currencies.map((c) => {
              const label = currencyOptionLabel(c);
              return (
                <SelectItem key={c.code} value={c.code} textValue={label}>
                  <SelectItemText>{label}</SelectItemText>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        className="w-full"
        onClick={() => {
          void (async () => {
            const parsed = parseNumericInput(balanceInput);
            if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(entryIso)) return;
            const nextType = assetTypeId.trim() || asset.type;
            await Promise.resolve(
              onSave(
                asset.id,
                Math.round(parsed * 100) / 100,
                currency,
                name.trim() || asset.name,
                entryIso,
                nextType,
              ),
            );
            onOpenChange(false);
          })();
        }}
      >
        {t.saveChanges}
      </Button>
      <Button
        type="button"
        variant="destructive"
        className="w-full"
        onClick={() => setDeleteDialogOpen(true)}
      >
        {t.assetDeleteButton}
      </Button>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setHasRowsOutsideMonth(null);
            setDeleteProbeLoading(false);
          }
        }}
      >
        <AlertDialogContent dir={dir} className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.assetDeleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {deleteProbeLoading ? (
                  <p>{lang === "he" ? "בודקים נתונים…" : "Checking stored months…"}</p>
                ) : hasRowsOutsideMonth ? (
                  <>
                    <p>{t.assetDeleteDialogChoose}</p>
                    <p className="font-medium text-foreground">
                      {lang === "he" ? "חודש בתצוגה: " : "Month on screen: "}
                      {monthLabel}
                    </p>
                  </>
                ) : (
                  <p>{t.assetDeleteDialogSimple}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            {!deleteProbeLoading && hasRowsOutsideMonth === true ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    void (async () => {
                      const ok = await onRemoveFromMonth(asset.id);
                      if (ok) {
                        setDeleteDialogOpen(false);
                        onOpenChange(false);
                      }
                    })();
                  }}
                >
                  <span className="block text-center">
                    {t.assetDeleteThisMonthOnly}
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {t.assetDeleteThisMonthOnlyHint}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    onDeletePermanently(asset.id);
                    setDeleteDialogOpen(false);
                    onOpenChange(false);
                  }}
                >
                  <span className="block text-center">
                    {t.assetDeletePermanently}
                    <span className="mt-0.5 block text-xs font-normal opacity-90">
                      {t.assetDeletePermanentlyHint}
                    </span>
                  </span>
                </Button>
                <AlertDialogCancel className="w-full sm:mt-0">{t.assetDeleteCancel}</AlertDialogCancel>
              </>
            ) : !deleteProbeLoading && hasRowsOutsideMonth === false ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    onDeletePermanently(asset.id);
                    setDeleteDialogOpen(false);
                    onOpenChange(false);
                  }}
                >
                  {t.assetDeletePermanently}
                </Button>
                <AlertDialogCancel className="w-full sm:mt-0">{t.assetDeleteCancel}</AlertDialogCancel>
              </>
            ) : (
              <AlertDialogCancel className="w-full sm:mt-0">{t.assetDeleteCancel}</AlertDialogCancel>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent dir={dir}>
          <DialogHeader>
            <DialogTitle>{t.assetEditTitle}</DialogTitle>
            <DialogDescription>{t.assetEditSubtitle}</DialogDescription>
          </DialogHeader>
          <div className="p-2">{body}</div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent dir={dir}>
        <SheetHeader>
          <SheetTitle>{t.assetEditTitle}</SheetTitle>
          <SheetDescription>{t.assetEditSubtitle}</SheetDescription>
        </SheetHeader>
        <div className="mt-2 p-2">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
