import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AssetEditShell } from "@/components/assets/AssetEditShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { useAssets } from "@/context/AssetsContext";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import { DEFAULT_CURRENCY } from "@/data/mock";
import { convertToILS } from "@/lib/fx";
import { formatIls, formatIlsCompact } from "@/lib/format";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import {
  formatYearMonth,
  hebrewMonthYearLabel,
  monthYearShort,
  parseLocalIsoDate,
  type YearMonth,
} from "@/lib/month";

const ASSET_TYPE_ACCENTS: Record<string, string> = {
  liquid: "#22c55e",
  portfolio: "#3b82f6",
  pension: "#a855f7",
};

export function AssetsView() {
  const fxTick = useFxTick();
  const { t, dir } = useI18n();
  const { currencies } = useExpenses();
  const {
    snapshots,
    currentMonth,
    setCurrentMonth,
    currentAssets,
    setBalance,
    setAccountCurrency,
    updateAccountMeta,
    deleteAccount,
    addSnapshotAccount,
    assetTypes,
    assetNamePresetsFor,
    registerAssetName,
  } = useAssets();

  const [addType, setAddType] = useState<string>("liquid");
  const [addName, setAddName] = useState("");
  const [addBalance, setAddBalance] = useState("");
  const [addCurrency, setAddCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [balanceEntryMonth, setBalanceEntryMonth] = useState<YearMonth>(() =>
    formatYearMonth(new Date()),
  );
  const [assetChartOn, setAssetChartOn] = useState<Record<string, boolean>>(
    {},
  );
  const [assetTypeFilterOn, setAssetTypeFilterOn] = useState<Record<string, boolean>>({});
  const [chartViewMode, setChartViewMode] = useState<"chart" | "list">("chart");
  const [assetChartMode, setAssetChartMode] = useState<"total" | "assets">("total");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [rangeStartYm, setRangeStartYm] = useState<YearMonth | "all">("all");
  const [rangeEndYm, setRangeEndYm] = useState<YearMonth | "all">("all");
  const [listViewYm, setListViewYm] = useState<YearMonth>(() => formatYearMonth(new Date()));

  const namePresets = useMemo(() => assetNamePresetsFor(addType), [assetNamePresetsFor, addType]);

  const assetSeries = useMemo(() => {
    const byName = new Map<string, { key: string; name: string; color: string; type: string }>();
    for (const snap of snapshots) {
      for (const a of snap.accounts) {
        const key = a.name.trim().toLowerCase();
        if (byName.has(key)) continue;
        byName.set(key, {
          key,
          name: a.name,
          color: a.color ?? ASSET_TYPE_ACCENTS[a.type] ?? "#94a3b8",
          type: a.type,
        });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [snapshots]);

  useEffect(() => {
    setAssetChartOn((prev) => {
      const next = { ...prev };
      for (const asset of assetSeries) {
        if (next[asset.key] === undefined) next[asset.key] = true;
      }
      for (const k of Object.keys(next)) {
        if (!assetSeries.some((a) => a.key === k)) delete next[k];
      }
      return next;
    });
  }, [assetSeries]);

  useEffect(() => {
    setAssetTypeFilterOn((prev) => {
      const next = { ...prev };
      for (const t of assetTypes) {
        if (next[t.id] === undefined) next[t.id] = true;
      }
      for (const key of Object.keys(next)) {
        if (!assetTypes.some((t) => t.id === key)) delete next[key];
      }
      return next;
    });
  }, [assetTypes]);

  const monthOptions = useMemo(() => {
    const cur = currentMonth;
    const from = [...snapshots.map((s) => s.ym as YearMonth)];
    const uniq = new Set<YearMonth>([cur, ...from]);
    return [...uniq].sort((a, b) => b.localeCompare(a));
  }, [snapshots, currentMonth]);

  const monthOptionsAsc = useMemo(
    () => [...monthOptions].sort((a, b) => a.localeCompare(b)),
    [monthOptions],
  );

  const total = useMemo(
    () =>
      currentAssets.reduce(
        (sum, a) => sum + convertToILS(a.balance, a.currency ?? "ILS", `${currentMonth}-01`),
        0,
      ),
    [currentAssets, currentMonth, fxTick],
  );

  const currentSorted = useMemo(
    () =>
      [...currentAssets].sort((a, b) => {
        const typeCmp = a.type.localeCompare(b.type, "he");
        if (typeCmp !== 0) return typeCmp;
        return a.name.localeCompare(b.name, "he");
      }),
    [currentAssets],
  );

  const trendData = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.ym.localeCompare(b.ym))
        .filter((s) => (rangeStartYm === "all" ? true : s.ym >= rangeStartYm))
        .filter((s) => (rangeEndYm === "all" ? true : s.ym <= rangeEndYm))
        .map((s) => {
          const rateDate = `${s.ym}-01`;
          const valuesByAsset: Record<string, number> = {};
          let totalVisible = 0;
          for (const a of s.accounts) {
            if (assetTypeFilterOn[a.type] === false) continue;
            const keyName = a.name.trim().toLowerCase();
            if (assetChartOn[keyName] === false) continue;
            const key = `asset_${keyName}`;
            const v = convertToILS(a.balance, a.currency ?? "ILS", rateDate);
            valuesByAsset[key] = (valuesByAsset[key] ?? 0) + v;
            totalVisible += v;
          }
          return {
            ym: s.ym,
            label: monthYearShort(s.ym as YearMonth),
            value: totalVisible,
            ...valuesByAsset,
          };
        }),
    [snapshots, rangeStartYm, rangeEndYm, assetTypeFilterOn, assetChartOn, fxTick],
  );

  const listViewRows = useMemo(() => {
    const snap = snapshots.find((s) => s.ym === listViewYm);
    if (!snap) return [];
    const date = `${snap.ym}-01`;
    return snap.accounts
      .filter((a) => assetTypeFilterOn[a.type] !== false)
      .filter((a) => assetChartOn[a.name.trim().toLowerCase()] !== false)
      .map((a) => ({
        key: `${a.id}-${a.name}`,
        name: a.name,
        value: convertToILS(a.balance, a.currency ?? "ILS", date),
        color: a.color ?? ASSET_TYPE_ACCENTS[a.type] ?? "#94a3b8",
      }))
      .sort((a, b) => b.value - a.value);
  }, [snapshots, listViewYm, assetTypeFilterOn, assetChartOn, fxTick]);

  const editingAsset = useMemo(
    () => currentAssets.find((a) => a.id === editingAssetId) ?? null,
    [currentAssets, editingAssetId],
  );

  const typeNameById = useMemo(
    () => new Map(assetTypes.map((t) => [t.id, t.name] as const)),
    [assetTypes],
  );

  function onAddAsset() {
    const parsed = parseNumericInput(addBalance);
    if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return;
    const fallbackTypeName = typeNameById.get(addType) ?? t.assetDefaultNameGeneric;
    const name = addName.trim() || fallbackTypeName;
    addSnapshotAccount(balanceEntryMonth, {
      type: addType,
      name,
      balance: Math.round(parsed * 100) / 100,
      currency: addCurrency,
    });
    registerAssetName(addType, name);
    setAddName("");
    setAddBalance("");
    setAddCurrency(DEFAULT_CURRENCY);
  }

  return (
    <div className="flex flex-col gap-4" dir={dir}>
      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle>{t.assetsTitle}</CardTitle>
          <CardDescription>{t.assetsSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 space-y-2">
            <Label htmlFor="asset-month">{t.monthFilterLabel}</Label>
            <Select value={currentMonth} onValueChange={(v) => setCurrentMonth(v as YearMonth)}>
              <SelectTrigger id="asset-month" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {monthOptions.map((ym) => (
                  <SelectItem key={ym} value={ym} textValue={hebrewMonthYearLabel(ym)}>
                    <SelectItemText>{hebrewMonthYearLabel(ym)}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">{t.totalNetWorth}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatIls(total)}</p>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t.assetAddSection}</CardTitle>
          <CardDescription>{hebrewMonthYearLabel(balanceEntryMonth)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="max-w-[14rem]">
              <DatePickerField
                id="asset-balance-month"
                label={t.assetBalanceEntryMonth}
                value={`${balanceEntryMonth}-01`}
                onChange={(iso) => {
                  const d = parseLocalIsoDate(iso);
                  if (d) setBalanceEntryMonth(formatYearMonth(d));
                }}
              />
            </div>
            <div className="space-y-2">
            <Label htmlFor="asset-add-type">{t.assetSnapshotType}</Label>
            <Select value={addType} onValueChange={setAddType}>
              <SelectTrigger id="asset-add-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {assetTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id} textValue={type.name}>
                    <SelectItemText>{type.name}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-add-name">{t.assetSnapshotName}</Label>
            <Input
              id="asset-add-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={typeNameById.get(addType) ?? t.assetDefaultNameGeneric}
              list="asset-name-presets"
            />
            <datalist id="asset-name-presets">
              {namePresets.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-2">
              {namePresets.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border border-border/70 bg-muted/30 px-3 py-1 text-xs text-foreground hover:bg-accent/40"
                  onClick={() => setAddName(p.name)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:max-w-[16rem]">
            <Label htmlFor="asset-add-balance">{t.assetSnapshotBalance}</Label>
            <Input
              id="asset-add-balance"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="tabular-nums"
              value={addBalance}
              onChange={(e) => setAddBalance(formatNumericInput(e.target.value))}
            />
          </div>
          <Button type="button" className="w-full" onClick={onAddAsset}>
            {t.assetAddButton}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t.assetListSection}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {currentSorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.historyEmpty}</p>
          ) : (
            currentSorted.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setEditingAssetId(a.id)}
                    className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-start transition-colors hover:bg-accent/40"
                    style={{
                      borderColor: `${(a.color ?? ASSET_TYPE_ACCENTS[a.type] ?? "#94a3b8")}55`,
                      backgroundImage: `linear-gradient(180deg, ${
                        a.color ?? ASSET_TYPE_ACCENTS[a.type] ?? "#94a3b8"
                      }12, transparent)`,
                    }}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{typeNameById.get(a.type) ?? a.type}</p>
                </div>
                <p className="text-base font-semibold tabular-nums">
                  {formatIls(convertToILS(a.balance, a.currency ?? "ILS", `${currentMonth}-01`))}
                </p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t.assetTrendTitle}</CardTitle>
          <CardDescription>{t.assetsTrendSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Popover open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  סינון
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(95vw,30rem)] space-y-4 p-4" dir={dir}>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t.assetChartFilterTypes}</p>
                  <div className="flex flex-wrap gap-2">
                    {assetTypes.map((typ) => {
                      const on = assetTypeFilterOn[typ.id] !== false;
                      return (
                        <button
                          key={typ.id}
                          type="button"
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            on
                              ? "border-primary/60 bg-primary/10 text-foreground"
                              : "border-border/60 bg-muted/30 text-muted-foreground opacity-70",
                          )}
                          onClick={() => {
                            setAssetTypeFilterOn((p) => ({ ...p, [typ.id]: !on }));
                            setAssetChartOn((prev) => {
                              const next = { ...prev };
                              for (const asset of assetSeries) {
                                if (asset.type === typ.id) next[asset.key] = !on;
                              }
                              return next;
                            });
                          }}
                        >
                          {typ.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t.assetChartFilterAssets}</p>
                  <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-border/60 p-2">
                    {assetSeries.map((asset) => {
                      const on = assetChartOn[asset.key] !== false;
                      return (
                        <label key={asset.key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{asset.name}</span>
                          <Switch
                            checked={on}
                            onCheckedChange={(v) =>
                              setAssetChartOn((p) => ({ ...p, [asset.key]: Boolean(v) }))
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="asset-range-start">{t.assetChartRangeStart}</Label>
                    <Select
                      value={rangeStartYm}
                      onValueChange={(v) => setRangeStartYm(v as YearMonth | "all")}
                    >
                      <SelectTrigger id="asset-range-start" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all" textValue={t.exportAllTime}>
                          <SelectItemText>{t.exportAllTime}</SelectItemText>
                        </SelectItem>
                        {monthOptionsAsc.map((ym) => (
                          <SelectItem key={`start-${ym}`} value={ym} textValue={hebrewMonthYearLabel(ym)}>
                            <SelectItemText>{hebrewMonthYearLabel(ym)}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="asset-range-end">{t.assetChartRangeEnd}</Label>
                    <Select
                      value={rangeEndYm}
                      onValueChange={(v) => setRangeEndYm(v as YearMonth | "all")}
                    >
                      <SelectTrigger id="asset-range-end" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all" textValue={t.exportAllTime}>
                          <SelectItemText>{t.exportAllTime}</SelectItemText>
                        </SelectItem>
                        {monthOptions.map((ym) => (
                          <SelectItem key={`end-${ym}`} value={ym} textValue={hebrewMonthYearLabel(ym)}>
                            <SelectItemText>{hebrewMonthYearLabel(ym)}</SelectItemText>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Select value={assetChartMode} onValueChange={(v) => setAssetChartMode(v as "total" | "assets")}>
                <SelectTrigger className="h-8 w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="total" textValue={t.totalNetWorth}>
                    <SelectItemText>{t.totalNetWorth}</SelectItemText>
                  </SelectItem>
                  <SelectItem value="assets" textValue={t.assetChartFilterAssets}>
                    <SelectItemText>{t.assetChartFilterAssets}</SelectItemText>
                  </SelectItem>
                </SelectContent>
              </Select>
              <span>{chartViewMode === "chart" ? t.assetChartView : t.assetListView}</span>
              <Switch
                checked={chartViewMode === "list"}
                onCheckedChange={(v) => setChartViewMode(v ? "list" : "chart")}
              />
            </label>
          </div>
          {chartViewMode === "chart" ? (
            <div className="h-[220px] w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={50}
                    tickFormatter={(v) => formatIlsCompact(Number(v)).replace("₪", "")}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const points = payload.filter(
                        (p) => typeof p.value === "number" && Number.isFinite(p.value as number),
                      );
                      const v = points.reduce((sum, p) => sum + Number(p.value), 0);
                      const ym = (payload[0]?.payload as { ym?: YearMonth })?.ym;
                      return (
                        <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md" dir={dir}>
                          <p className="font-medium tabular-nums">{formatIlsCompact(v)}</p>
                          {ym ? <p className="text-xs text-muted-foreground">{hebrewMonthYearLabel(ym)}</p> : null}
                        </div>
                      );
                    }}
                  />
                  {assetChartMode === "total" ? (
                    <Line
                      key="total-net-worth"
                      type="monotone"
                      dataKey="value"
                      name={t.totalNetWorth}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ) : (
                    assetSeries
                      .filter((asset) => assetChartOn[asset.key] !== false)
                      .map((asset) => (
                        <Line
                          key={asset.key}
                          type="monotone"
                          dataKey={`asset_${asset.key}`}
                          name={asset.name}
                          stroke={asset.color}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls
                        />
                      ))
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70">
              <div className="border-b border-border/60 px-3 py-2">
                <p className="text-sm font-medium">
                  סה"כ שווי: {formatIls(listViewRows.reduce((s, r) => s + r.value, 0))}
                </p>
              </div>
              <div className="border-b border-border/60 px-3 py-2">
                <Select value={listViewYm} onValueChange={(v) => setListViewYm(v as YearMonth)}>
                  <SelectTrigger className="h-8 w-[11rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {monthOptions.map((ym) => (
                      <SelectItem key={`list-${ym}`} value={ym} textValue={hebrewMonthYearLabel(ym)}>
                        <SelectItemText>{hebrewMonthYearLabel(ym)}</SelectItemText>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <span>{t.assetSnapshotName}</span>
                <span>{t.totalNetWorth}</span>
              </div>
              <div className="max-h-[260px] overflow-auto">
                {listViewRows.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">{t.historyEmpty}</p>
                ) : (
                  listViewRows.map((row) => (
                    <div
                      key={row.key}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 border-s-2 px-3 py-2 text-sm"
                      style={{ backgroundColor: `${row.color}1A`, borderInlineStartColor: row.color }}
                    >
                      <span className="truncate">{row.name}</span>
                      <span className="tabular-nums">{formatIlsCompact(row.value)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AssetEditShell
        asset={editingAsset}
        currencies={currencies}
        month={currentMonth}
        onMonthChange={setCurrentMonth}
        onOpenChange={(open) => {
          if (!open) setEditingAssetId(null);
        }}
        onSave={(id, balance, currency, name, color) => {
          setBalance(id, balance);
          setAccountCurrency(id, currency);
          if (name != null || color != null) {
            updateAccountMeta(id, { name: name ?? undefined, color: color ?? undefined });
          }
        }}
        onDelete={(id) => {
          deleteAccount(id);
          setEditingAssetId(null);
        }}
      />
    </div>
  );
}
