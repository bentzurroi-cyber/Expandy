import { useEffect, useState } from "react";
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
import { formatYearMonth, parseLocalIsoDate } from "@/lib/month";

type AssetEditShellProps = {
  asset: AssetAccount | null;
  currencies: CurrencyDef[];
  onOpenChange: (open: boolean) => void;
  month: `${number}-${number}`;
  onMonthChange: (month: `${number}-${number}`) => void;
  onSave: (id: string, balance: number, currency: string, name: string, color: string) => void;
  onDelete: (id: string) => void;
};

export function AssetEditShell({
  asset,
  currencies,
  onOpenChange,
  month,
  onMonthChange,
  onSave,
  onDelete,
}: AssetEditShellProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { t, dir } = useI18n();
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#94a3b8");

  useEffect(() => {
    if (!asset) return;
    setBalance(formatNumericInput(String(asset.balance)));
    setCurrency(asset.currency ?? "ILS");
    setName(asset.name ?? "");
    setColor(asset.color ?? "#94a3b8");
  }, [asset]);

  if (!asset) return null;

  const body = (
    <div className="space-y-4">
      <DatePickerField
        id="asset-edit-month"
        label={t.assetBalanceEntryMonth}
        value={`${month}-01`}
        onChange={(iso) => {
          const d = parseLocalIsoDate(iso);
          if (d) onMonthChange(formatYearMonth(d));
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="asset-edit-name">{t.assetSnapshotName}</Label>
        <Input
          id="asset-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="asset-edit-color">{dir === "rtl" ? "צבע" : "Color"}</Label>
        <Input
          id="asset-edit-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-16 p-1"
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
          value={balance}
          onChange={(e) => setBalance(formatNumericInput(e.target.value))}
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
          const parsed = parseNumericInput(balance);
          if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return;
          onSave(
            asset.id,
            Math.round(parsed * 100) / 100,
            currency,
            name.trim() || asset.name,
            color,
          );
          onOpenChange(false);
        }}
      >
        {t.saveChanges}
      </Button>
      <Button
        type="button"
        variant="destructive"
        className="w-full"
        onClick={() => {
          onDelete(asset.id);
          onOpenChange(false);
        }}
      >
        {dir === "rtl" ? "מחק" : "Delete"}
      </Button>
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
