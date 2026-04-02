import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetsContext";
import { useFxTick } from "@/context/FxContext";
import { useExpenses } from "@/context/ExpensesContext";
import { useI18n } from "@/context/I18nContext";
import { supabase } from "@/lib/supabase";
import { DEFAULT_CURRENCY } from "@/data/mock";
import { convertToILS, prefetchFxRate } from "@/lib/fx";
import { localizedAssetTypeName } from "@/lib/defaultEntityLabels";
import { formatCurrencyCompact, formatIls, formatIlsCompact, isShekelCurrency } from "@/lib/format";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import {
  formatYearMonth,
  hebrewMonthYearLabel,
  monthYearShort,
  parseLocalIsoDate,
  type YearMonth,
} from "@/lib/month";
import { toast } from "sonner";

const ASSET_TYPE_ACCENTS: Record<string, string> = {
  liquid: "#22c55e",
  portfolio: "#3b82f6",
  pension: "#a855f7",
};

const ASSET_NET_EXCLUDE_STORAGE_KEY = "expandy-assets-net-exclude-type-v1";

function readGuestAssetNetExclude(): string {
  try {
    return localStorage.getItem(ASSET_NET_EXCLUDE_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function AssetsView({ isActive = true }: { isActive?: boolean }) {
  const fxTick = useFxTick();
  const { t, dir, lang } = useI18n();
  const { user, profile, refreshProfile } = useAuth();
  const { currencies } = useExpenses();
  const [activeExcludeTypeId, setActiveExcludeTypeId] = useState(
    readGuestAssetNetExclude,
  );
  const profileAssetExcludeTypeId = profile?.assets_total_exclude_type_id?.trim() ?? "";
  const savedDefaultExcludeTypeId = user?.id
    ? profileAssetExcludeTypeId
    : readGuestAssetNetExclude();
  const isDefaultSelection =
    (activeExcludeTypeId || "") === (savedDefaultExcludeTypeId || "");

  useEffect(() => {
    if (!isActive) return;
    if (user?.id) {
      setActiveExcludeTypeId(profileAssetExcludeTypeId);
    } else {
      setActiveExcludeTypeId(readGuestAssetNetExclude());
    }
  }, [isActive, user?.id, profileAssetExcludeTypeId]);

  const saveAssetsTotalDefault = useCallback(async () => {
    const v = (activeExcludeTypeId || "").trim();
    if (user?.id) {
      const { error } = await supabase
        .from("profiles")
        .update({ assets_total_exclude_type_id: v })
        .eq("id", user.id);
      if (error) {
        const errMsg = String(error?.message ?? "");
        const errCode =
          (error as unknown as { code?: string })?.code ?? "UNKNOWN";
        console.error(
          "[Assets] Failed to persist assets_total_exclude_type_id",
          "message:",
          errMsg,
          "code:",
          errCode,
          "userId:",
          user.id,
        );
        toast.info(t.assetNetWorthExcludeSavedLocally);
        return;
      }
      await refreshProfile();
      toast.success(
        lang === "he"
          ? "נשמר כברירת מחדל."
          : "Saved as default.",
      );
      return;
    }
    try {
      if (v) localStorage.setItem(ASSET_NET_EXCLUDE_STORAGE_KEY, v);
      else localStorage.removeItem(ASSET_NET_EXCLUDE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    toast.success(
      lang === "he"
        ? "נשמר כברירת מחדל."
        : "Saved as default.",
    );
  }, [
    activeExcludeTypeId,
    lang,
    refreshProfile,
    t.assetNetWorthExcludeSavedLocally,
    user?.id,
  ]);
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
  } = useAssets();

  const [addType, setAddType] = useState<string>("liquid");
  const [addName, setAddName] = useState("");
  const [addBalance, setAddBalance] = useState("");
  const [addCurrency, setAddCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [addFxPreviewTick, setAddFxPreviewTick] = useState(0);
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

  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      setAddType("liquid");
      setAddName("");
      setAddBalance("");
      setAddCurrency(DEFAULT_CURRENCY);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  const parsedAddBalance = useMemo(() => parseNumericInput(addBalance), [addBalance]);
  const rateDate = `${balanceEntryMonth}-01`;
  const addBalanceRounded =
    typeof parsedAddBalance === "number" && Number.isFinite(parsedAddBalance)
      ? Math.round(parsedAddBalance * 100) / 100
      : null;
  const addIlsPreview = useMemo(() => {
    if (addCurrency === "ILS" || addBalanceRounded == null) return null;
    return convertToILS(addBalanceRounded, addCurrency, rateDate);
  }, [addCurrency, addBalanceRounded, rateDate, addFxPreviewTick]);

  useEffect(() => {
    if (addCurrency === "ILS") return;
    if (addBalanceRounded == null || addBalanceRounded <= 0) return;

    let cancelled = false;
    void prefetchFxRate(addCurrency, rateDate).finally(() => {
      if (!cancelled) setAddFxPreviewTick((t) => t + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [addCurrency, addBalanceRounded, rateDate]);

  const namePresets = useMemo(() => assetNamePresetsFor(addType), [assetNamePresetsFor, addType]);

  const accentForAssetType = useCallback(
    (typeId: string) => {
      const row = assetTypes.find((x) => x.id === typeId);
      if (row?.color && /^#[0-9a-fA-F]{6}$/i.test(row.color)) return row.color;
      return ASSET_TYPE_ACCENTS[typeId] ?? "#94a3b8";
    },
    [assetTypes],
  );

  const assetSeries = useMemo(() => {
    const byName = new Map<string, { key: string; name: string; color: string; type: string }>();
    for (const snap of snapshots ?? []) {
      const accounts = Array.isArray(snap?.accounts) ? snap.accounts : [];
      for (const a of accounts) {
        if (!a || typeof a !== "object") continue;
        const rawName = typeof a.name === "string" ? a.name : "";
        const key = rawName.trim().toLowerCase();
        if (!key || byName.has(key)) continue;
        const typ = typeof a.type === "string" ? a.type : "";
        byName.set(key, {
          key,
          name: rawName.trim() || "—",
          color: accentForAssetType(typ),
          type: typ,
        });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [snapshots, accentForAssetType]);

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
      for (const typ of assetTypes ?? []) {
        if (typ?.id && next[typ.id] === undefined) next[typ.id] = true;
      }
      for (const key of Object.keys(next)) {
        if (!assetTypes?.some((x) => x?.id === key)) delete next[key];
      }
      return next;
    });
  }, [assetTypes]);

  const monthOptions = useMemo(() => {
    const cur = currentMonth;
    const from = (snapshots ?? []).map((s) => s?.ym).filter(Boolean) as YearMonth[];
    const uniq = new Set<YearMonth>([cur, ...from]);
    return [...uniq].sort((a, b) => b.localeCompare(a));
  }, [snapshots, currentMonth]);

  const monthOptionsAsc = useMemo(
    () => [...monthOptions].sort((a, b) => a.localeCompare(b)),
    [monthOptions],
  );

  const total = useMemo(
    () =>
      (currentAssets ?? []).reduce((sum, a) => {
        if (!a || typeof a.balance !== "number" || !Number.isFinite(a.balance)) return sum;
        const typ = typeof a.type === "string" ? a.type : "";
        if (activeExcludeTypeId && typ === activeExcludeTypeId) return sum;
        return sum + convertToILS(a.balance, a.currency ?? "ILS", `${currentMonth}-01`);
      }, 0),
    [currentAssets, currentMonth, fxTick, activeExcludeTypeId],
  );

  const currentSorted = useMemo(
    () =>
      [...(currentAssets ?? [])].sort((a, b) => {
        const ta = typeof a?.type === "string" ? a.type : "";
        const tb = typeof b?.type === "string" ? b.type : "";
        const typeCmp = ta.localeCompare(tb, "he");
        if (typeCmp !== 0) return typeCmp;
        const na = typeof a?.name === "string" ? a.name : "";
        const nb = typeof b?.name === "string" ? b.name : "";
        return na.localeCompare(nb, "he");
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
          const accounts = Array.isArray(s?.accounts) ? s.accounts : [];
          for (const a of accounts) {
            if (!a || typeof a !== "object") continue;
            const typ = typeof a.type === "string" ? a.type : "";
            if (assetTypeFilterOn[typ] === false) continue;
            const keyName = (typeof a.name === "string" ? a.name : "").trim().toLowerCase();
            if (!keyName || assetChartOn[keyName] === false) continue;
            const key = `asset_${keyName}`;
            const bal = typeof a.balance === "number" && Number.isFinite(a.balance) ? a.balance : 0;
            const v = convertToILS(bal, a.currency ?? "ILS", rateDate);
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
    const snap = snapshots?.find((s) => s?.ym === listViewYm);
    if (!snap || !Array.isArray(snap.accounts)) return [];
    const date = `${snap.ym}-01`;
    return snap.accounts
      .filter((a) => a != null && typeof a === "object")
      .filter((a) => assetTypeFilterOn[typeof a.type === "string" ? a.type : ""] !== false)
      .filter((a) => {
        const kn = (typeof a.name === "string" ? a.name : "").trim().toLowerCase();
        return kn ? assetChartOn[kn] !== false : true;
      })
      .map((a) => {
        const typ = typeof a.type === "string" ? a.type : "";
        const bal = typeof a.balance === "number" && Number.isFinite(a.balance) ? a.balance : 0;
        const nm = typeof a.name === "string" ? a.name : "—";
        return {
          key: `${a.id ?? "x"}-${nm}`,
          name: nm,
          value: convertToILS(bal, a.currency ?? "ILS", date),
          color: accentForAssetType(typ),
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [snapshots, listViewYm, assetTypeFilterOn, assetChartOn, fxTick, accentForAssetType]);

  const editingAsset = useMemo(
    () => currentAssets.find((a) => a.id === editingAssetId) ?? null,
    [currentAssets, editingAssetId],
  );

  const typeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const typ of assetTypes ?? []) {
      if (typ?.id && typeof typ.name === "string") m.set(typ.id, typ.name);
    }
    return m;
  }, [assetTypes]);

  async function onAddAsset() {
    const parsed = parseNumericInput(addBalance);
    if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return;
    const name = addName.trim();
    if (!name) {
      toast.error(t.assetNameRequired);
      return;
    }
    const balanceStored = Math.round(parsed * 100) / 100;
    const res = await addSnapshotAccount(balanceEntryMonth, {
      type: addType,
      name,
      balance: balanceStored,
      currency: addCurrency,
    });
    if (!res.ok) {
      toast.error(
        lang === "he" ? `שמירת נכס נכשלה: ${res.error}` : `Could not save asset: ${res.error}`,
      );
      return;
    }
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{t.totalNetWorth}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {formatIls(total)}
              </p>
            </div>
            <div className="w-full shrink-0 space-y-1.5 sm:max-w-[16rem]">
              <Label
                htmlFor="asset-net-scope"
                className="text-xs text-muted-foreground"
              >
                {t.assetNetWorthScopeLabel}
              </Label>
              <Select
                value={activeExcludeTypeId || "__all__"}
                onValueChange={(v) => {
                  setActiveExcludeTypeId(v === "__all__" ? "" : v);
                }}
              >
                <SelectTrigger id="asset-net-scope" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="__all__" textValue={t.assetNetWorthAllTypes}>
                    <SelectItemText>{t.assetNetWorthAllTypes}</SelectItemText>
                  </SelectItem>
                  {(assetTypes ?? [])
                    .filter((typ) => typ?.id)
                    .map((typ) => {
                      const id = typ.id;
                      const nm = typeof typ.name === "string" ? typ.name : id;
                      const label = `${t.assetNetWorthExcluding} ${localizedAssetTypeName(id, nm, lang)}`;
                      return (
                        <SelectItem key={id} value={id} textValue={label}>
                          <SelectItemText>{label}</SelectItemText>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              {!isDefaultSelection ? (
                <button
                  type="button"
                  onClick={() => {
                    void saveAssetsTotalDefault();
                  }}
                  className="text-start text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {t.assetNetWorthMakeDefault}
                </button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t.assetAddSection}</CardTitle>
          <CardDescription>{hebrewMonthYearLabel(balanceEntryMonth)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault();
              void onAddAsset();
            }}
          >
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
                triggerClassName="h-12 min-h-12 rounded-xl border border-input bg-background px-3.5 py-2.5 ps-3"
              />
            </div>
            <div className="space-y-2">
            <Label htmlFor="asset-add-type">{t.assetSnapshotType}</Label>
            <Select value={addType} onValueChange={setAddType}>
              <SelectTrigger id="asset-add-type" className="h-12 min-h-12 w-full px-3.5 py-2.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(assetTypes ?? []).map((type) => {
                  if (!type?.id) return null;
                  const nm = typeof type.name === "string" ? type.name : "";
                  return (
                    <SelectItem
                      key={type.id}
                      value={type.id}
                      textValue={localizedAssetTypeName(type.id, nm, lang)}
                    >
                      <SelectItemText>
                        {localizedAssetTypeName(type.id, nm, lang)}
                      </SelectItemText>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-add-name">{t.assetSnapshotName}</Label>
            <Input
              id="asset-add-name"
              name="asset-display-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={t.assetNamePickPlaceholder}
              autoComplete="on"
            />
            <div className="flex flex-wrap gap-2">
              {namePresets.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border border-border/70 bg-muted/30 px-3 py-1 text-sm leading-relaxed text-foreground hover:bg-accent/40"
                  onClick={() => setAddName(p.name)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:max-w-[28rem]">
            <div className="space-y-2">
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
            <div className="space-y-2">
              <Label htmlFor="asset-add-balance-ccy">
                {lang === "he" ? "מטבע הסכום" : "Balance currency"}
              </Label>
              <Select value={addCurrency} onValueChange={setAddCurrency}>
                <SelectTrigger id="asset-add-balance-ccy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {(["ILS", "USD", "EUR"] as const).map((code) => (
                    <SelectItem key={code} value={code} textValue={code}>
                      <SelectItemText>{code}</SelectItemText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {addCurrency !== "ILS" && addBalanceRounded != null ? (
                <div className="space-y-1">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {formatCurrencyCompact(addBalanceRounded, addCurrency, currencies)}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                    {addIlsPreview != null
                      ? lang === "he"
                        ? `בשקלים: ${formatIls(addIlsPreview)}`
                        : `In ILS: ${formatIls(addIlsPreview)}`
                      : null}
                  </p>
                </div>
              ) : addCurrency !== "ILS" ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {lang === "he"
                    ? "הסכום יומר לשקל לפי שער היום של תאריך הרישום."
                    : "Amount is converted to ILS using the rate for the entry date."}
                </p>
              ) : null}
            </div>
          </div>
          <Button type="submit" className="w-full">
            {t.assetAddButton}
          </Button>
          </form>
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
            currentSorted.map((a) => {
              const aid = typeof a?.id === "string" ? a.id : "";
              const atype = typeof a?.type === "string" ? a.type : "";
              const aname = typeof a?.name === "string" ? a.name : "—";
              const accent = accentForAssetType(atype);
              const bal =
                typeof a?.balance === "number" && Number.isFinite(a.balance) ? a.balance : 0;
              return (
                <button
                  key={aid || aname}
                  type="button"
                  onClick={() => aid && setEditingAssetId(aid)}
                  className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-start transition-colors hover:bg-accent/40"
                  style={{
                    borderColor: `${accent}55`,
                    backgroundImage: `linear-gradient(180deg, ${accent}12, transparent)`,
                  }}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-sm font-medium">{aname}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {localizedAssetTypeName(atype, typeNameById.get(atype) ?? atype, lang)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <p className="text-base font-semibold tabular-nums">
                      {formatIls(convertToILS(bal, a?.currency ?? "ILS", `${currentMonth}-01`))}
                    </p>
                    {a?.currency && !isShekelCurrency(a.currency, currencies) ? (
                      <p className="text-sm leading-relaxed tabular-nums text-muted-foreground">
                        {formatCurrencyCompact(bal, a.currency, currencies)}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{t.assetTrendTitle}</CardTitle>
          <CardDescription>{t.assetsTrendSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-0.5"
                role="group"
                aria-label={t.assetTrendModeGroup}
              >
                <button
                  type="button"
                  className={cn(
                    "min-h-9 rounded-md px-3 text-sm font-medium leading-relaxed transition-colors",
                    assetChartMode === "total"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={assetChartMode === "total"}
                  onClick={() => setAssetChartMode("total")}
                >
                  {t.totalNetWorth}
                </button>
                <button
                  type="button"
                  className={cn(
                    "min-h-9 rounded-md px-3 text-sm font-medium leading-relaxed transition-colors",
                    assetChartMode === "assets"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={assetChartMode === "assets"}
                  onClick={() => setAssetChartMode("assets")}
                >
                  {t.assetChartFilterAssets}
                </button>
              </div>
              <Popover open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="shrink-0">
                    {t.historyToolbarFilters}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(95vw,30rem)] space-y-4 p-4" dir={dir}>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed font-medium text-muted-foreground">{t.assetChartFilterTypes}</p>
                    <div className="flex flex-wrap gap-2">
                      {(assetTypes ?? []).map((typ) => {
                        if (!typ?.id) return null;
                        const on = assetTypeFilterOn[typ.id] !== false;
                        return (
                          <button
                            key={typ.id}
                            type="button"
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-sm leading-relaxed",
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
                            {typeof typ.name === "string" ? typ.name : typ.id}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed font-medium text-muted-foreground">{t.assetChartFilterAssets}</p>
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
            </div>
            <label className="inline-flex shrink-0 items-center gap-2 text-sm leading-relaxed text-muted-foreground">
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
                    tickFormatter={(v) => {
                      const n = Number(v);
                      if (!Number.isFinite(n)) return "0";
                      return formatIlsCompact(n).replace("₪", "");
                    }}
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
                          {ym ? <p className="text-sm leading-relaxed text-muted-foreground">{hebrewMonthYearLabel(ym)}</p> : null}
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
                  <SelectTrigger className="min-h-10 w-[11rem]">
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
              <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
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
        onSave={(id, balance, currency, name) => {
          setBalance(id, balance);
          setAccountCurrency(id, currency);
          updateAccountMeta(id, { name });
        }}
        onDelete={(id) => {
          deleteAccount(id);
          setEditingAssetId(null);
        }}
      />
    </div>
  );
}
