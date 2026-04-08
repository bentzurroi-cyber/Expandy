import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Info, Pencil, Plus, Trash2 } from "lucide-react";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { IconPicker } from "@/components/settings/IconPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePickerField } from "@/components/expense/DatePickerField";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetsContext";
import { useSavingsGoals, type SavingsGoal } from "@/context/SavingsGoalsContext";
import { useI18n } from "@/context/I18nContext";
import { localizedAssetTypeName } from "@/lib/defaultEntityLabels";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { formatIlsWholeCeil } from "@/lib/format";
import { normalizeHoldingAssetType } from "@/lib/savingsGoalHolding";
import { defaultSavingsGoalColor } from "@/lib/savingsGoalUi";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HOLDING_SELECT_NONE = "__holding_none__";

/** Radix Select needs a concrete value; disabled so user must pick 1–5. */
const COMPASS_UNSET = "__compass_unset__";

const COMPASS_RANKS = [1, 2, 3, 4, 5] as const;

function storedCompassRank(p: number): number {
  if (p >= 1 && p <= 5) return p;
  return 3;
}

function InfoHint({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ariaLabel}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-w-[min(19rem,calc(100vw-2rem))] text-sm leading-relaxed"
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={16}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

type FormState = {
  name: string;
  isInvestmentPortfolio: boolean;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string;
  compassPriority: string;
  targetDate: string;
  color: string;
  icon: string;
  holdingAssetType: string;
};

const emptyForm = (): FormState => ({
  name: "",
  isInvestmentPortfolio: false,
  targetAmount: "",
  currentAmount: "",
  monthlyContribution: "",
  compassPriority: "",
  targetDate: "",
  color: defaultSavingsGoalColor(false),
  icon: "piggy-bank",
  holdingAssetType: "",
});

function goalToForm(g: SavingsGoal): FormState {
  const inv = g.isInvestmentPortfolio;
  return {
    name: g.name,
    isInvestmentPortfolio: inv,
    targetAmount:
      inv || g.targetMode === "open"
        ? ""
        : formatNumericInput(String(g.targetAmount)),
    currentAmount: inv ? "" : formatNumericInput(String(g.currentAmount)),
    monthlyContribution: g.monthlyMode === "surplus" ? "" : formatNumericInput(String(g.monthlyContribution)),
    compassPriority: String(storedCompassRank(g.priority)),
    targetDate: g.targetDate ?? "",
    color: g.color,
    icon: g.icon,
    holdingAssetType: g.holdingAssetType ?? "",
  };
}

/** Add / edit / delete savings goals — used under Settings → Finance. */
export function SavingsGoalsManagement() {
  const { t, dir, lang } = useI18n();
  const { profile } = useAuth();
  const { assetTypes } = useAssets();
  const { goals, loading, addGoal, updateGoal, deleteGoal } = useSavingsGoals();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const householdOk = useMemo(
    () => isValidHouseholdCode(normalizeHouseholdCode(profile?.household_id ?? "")),
    [profile?.household_id],
  );

  const holdingTypeIds = useMemo(() => new Set(assetTypes.map((x) => x.id)), [assetTypes]);

  const compassSelectValue = useMemo(() => {
    const v = form.compassPriority.trim();
    return v === "1" || v === "2" || v === "3" || v === "4" || v === "5" ? v : COMPASS_UNSET;
  }, [form.compassPriority]);

  const priorityOwnerByRank = useMemo(() => {
    const m = new Map<number, string>();
    for (const g of goals) {
      if (editingId && g.id === editingId) continue;
      const r = storedCompassRank(g.priority);
      if (r >= 1 && r <= 5 && !m.has(r)) m.set(r, g.name);
    }
    return m;
  }, [editingId, goals]);

  const editingSelfCompassRank = useMemo(() => {
    if (!editingId) return null;
    const g = goals.find((x) => x.id === editingId);
    return g ? storedCompassRank(g.priority) : null;
  }, [editingId, goals]);

  const holdingSelectValue = useMemo(() => {
    const raw = form.holdingAssetType.trim();
    return raw === "" ? HOLDING_SELECT_NONE : raw;
  }, [form.holdingAssetType]);

  const holdingSelectDisplay = useMemo(() => {
    if (holdingSelectValue === HOLDING_SELECT_NONE) return t.savingsGoalHoldingUnspecified;
    const at = assetTypes.find((a) => a.id === holdingSelectValue);
    return at ? localizedAssetTypeName(at.id, at.name, lang) : holdingSelectValue;
  }, [assetTypes, holdingSelectValue, lang, t.savingsGoalHoldingUnspecified]);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((g: SavingsGoal) => {
    setEditingId(g.id);
    setForm(goalToForm(g));
    setDialogOpen(true);
  }, []);

  const submit = useCallback(async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error(t.savingsGoalNameRequired);
      return;
    }

    const inv = form.isInvestmentPortfolio;
    let targetMode: "fixed" | "open";
    let targetN = 0;
    if (inv) {
      targetMode = "open";
      targetN = 0;
    } else {
      const rawT = form.targetAmount.trim();
      const parsedT = rawT ? parseNumericInput(rawT) : null;
      const openByEmpty =
        !rawT ||
        parsedT == null ||
        !Number.isFinite(parsedT) ||
        parsedT <= 0;
      if (openByEmpty) {
        targetMode = "open";
        targetN = 0;
      } else {
        targetMode = "fixed";
        targetN = parsedT!;
      }
    }

    const currentN = inv
      ? editingId
        ? (goals.find((g) => g.id === editingId)?.currentAmount ?? 0)
        : 0
      : (() => {
          const current = parseNumericInput(form.currentAmount);
          return current != null && Number.isFinite(current) ? Math.max(0, current) : 0;
        })();

    const monthlyRaw = form.monthlyContribution.trim();
    let monthlyN = 0;
    let monthlyMode: "fixed" | "surplus";
    if (!monthlyRaw) {
      monthlyMode = "surplus";
      monthlyN = 0;
    } else {
      const monthly = parseNumericInput(monthlyRaw);
      if (monthly == null || !Number.isFinite(monthly) || monthly < 0) {
        toast.error(t.savingsGoalMonthlyInvalid);
        return;
      }
      monthlyN = monthly;
      monthlyMode = "fixed";
    }

    const rank = Number.parseInt(form.compassPriority.trim(), 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 5) {
      toast.error(t.savingsGoalPriorityRequired);
      return;
    }
    const priorityN = rank;
    for (const g of goals) {
      if (editingId && g.id === editingId) continue;
      if (storedCompassRank(g.priority) === priorityN) {
        toast.error(t.savingsGoalPriorityTakenByGoal.replace("{{name}}", g.name));
        return;
      }
    }

    const targetDate =
      form.targetDate.trim().length >= 8 ? form.targetDate.trim().slice(0, 10) : null;

    const holdingRaw = normalizeHoldingAssetType(form.holdingAssetType);
    const existingGoal = editingId ? goals.find((g) => g.id === editingId) : undefined;
    let holding = "";
    if (holdingRaw) {
      if (holdingTypeIds.has(holdingRaw)) {
        holding = holdingRaw;
      } else if (existingGoal?.holdingAssetType === holdingRaw) {
        holding = holdingRaw;
      } else {
        toast.error(t.savingsGoalHoldingPickValid);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name,
        targetAmount: targetN,
        currentAmount: currentN,
        monthlyContribution: monthlyN,
        targetDate,
        isInvestmentPortfolio: inv,
        color: form.color,
        icon: form.icon,
        priority: priorityN,
        holdingAssetType: holding,
        targetMode,
        monthlyMode,
      };
      if (editingId) {
        const res = await updateGoal(editingId, payload);
        if (res.ok) {
          setDialogOpen(false);
          toast.success(t.savingsGoalSaved);
        }
      } else {
        const res = await addGoal(payload);
        if (res.ok) {
          setDialogOpen(false);
          toast.success(t.savingsGoalSaved);
        }
      }
    } finally {
      setSaving(false);
    }
  }, [addGoal, editingId, form, goals, holdingTypeIds, t, updateGoal]);

  const confirmDelete = useCallback(async () => {
    if (!deleteId) return;
    const res = await deleteGoal(deleteId);
    if (res.ok) toast.success(t.savingsGoalDeleted);
    setDeleteId(null);
  }, [deleteGoal, deleteId, t]);

  if (!householdOk) {
    return (
      <Card className="rounded-2xl border-border/80 bg-zinc-100 p-1 shadow-none dark:bg-zinc-900">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t.settingsFinancialManagement}</CardTitle>
          <CardDescription>{t.savingsGoalsHouseholdRequired}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card className="rounded-2xl border-border/80 bg-zinc-100 p-1 shadow-none dark:bg-zinc-900">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{t.settingsFinancialManagement}</CardTitle>
            <CardDescription>{t.settingsFinancialManagementDesc}</CardDescription>
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0 gap-1.5" onClick={openAdd}>
            <Plus className="size-4" aria-hidden />
            {t.savingsGoalAdd}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t.savingsGoalsLoading}</p>
          ) : goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.savingsGoalsEmpty}</p>
          ) : (
            <ul className="space-y-2">
              {goals.map((g) => {
                const openT = g.targetMode === "open" || g.isInvestmentPortfolio;
                const accent = g.color;
                const targetTypeLine = openT
                  ? t.savingsGoalTargetModeOpen
                  : t.savingsGoalTargetModeFixed;
                const compassRank = String(storedCompassRank(g.priority));
                const holdingLabel = (() => {
                  const h = g.holdingAssetType.trim();
                  if (!h) return t.savingsGoalHoldingUnspecified;
                  const at = assetTypes.find((x) => x.id === h);
                  return at ? localizedAssetTypeName(at.id, at.name, lang) : h;
                })();
                return (
                  <li
                    key={g.id}
                    className={cn(
                      "flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-background/40 px-5 py-4 sm:px-6 sm:py-5",
                    )}
                    style={{
                      borderColor: `${accent}40`,
                      backgroundColor: `${accent}10`,
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex size-10 shrink-0 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: `${accent}22`,
                          color: accent,
                        }}
                        aria-hidden
                      >
                        <CategoryGlyph iconKey={g.icon} className="size-4" />
                      </div>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium leading-snug">{g.name}</p>
                        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
                          <span dir="ltr" className="tabular-nums">
                            {formatIlsWholeCeil(g.currentAmount)}
                          </span>
                          <span aria-hidden>•</span>
                          <span>{targetTypeLine}</span>
                        </p>
                        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <span>{t.savingsGoalCompassPriorityShort.replace("{{n}}", compassRank)}</span>
                          <span aria-hidden>•</span>
                          <span className="truncate">{holdingLabel}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground"
                        onClick={() => openEdit(g)}
                        aria-label={t.savingsGoalEdit}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground"
                        onClick={() => setDeleteId(g.id)}
                        aria-label={t.savingsGoalDelete}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[min(92vh,44rem)] max-w-md gap-0 overflow-y-auto p-0" dir={dir}>
          <DialogHeader className="space-y-1 border-b border-border/50 px-5 py-4 text-start">
            <DialogTitle className="text-lg">
              {editingId ? t.savingsGoalEditTitle : t.savingsGoalAddTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="sgm-name" className="text-sm">
                {t.savingsGoalFieldName}
              </Label>
              <Input
                id="sgm-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-11"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 px-3 py-3">
              <Label htmlFor="sgm-inv" className="text-sm font-medium">
                {t.savingsGoalFieldInvestment}
              </Label>
              <Switch
                id="sgm-inv"
                checked={form.isInvestmentPortfolio}
                onCheckedChange={(c) => {
                  const on = c === true;
                  setForm((f) => {
                    const next: FormState = {
                      ...f,
                      isInvestmentPortfolio: on,
                      targetAmount: on ? "" : f.targetAmount,
                      currentAmount: on ? "" : f.currentAmount,
                    };
                    if (!on && editingId) {
                      const g = goals.find((x) => x.id === editingId);
                      if (g) {
                        next.currentAmount = formatNumericInput(String(g.currentAmount));
                        if (g.targetMode === "fixed") {
                          next.targetAmount = formatNumericInput(String(g.targetAmount));
                        }
                      }
                    }
                    return next;
                  });
                }}
                aria-label={t.savingsGoalFieldInvestment}
              />
            </div>

            {form.isInvestmentPortfolio ? (
              <div className="flex items-start gap-2 rounded-xl border border-border/35 bg-muted/15 px-4 py-3.5">
                <InfoHint ariaLabel={t.savingsGoalOpenAccumulationAria}>
                  {t.savingsGoalOpenAccumulationHint}
                </InfoHint>
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {t.savingsGoalInvestmentOpenNote}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <Label htmlFor="sgm-target" className="text-sm">
                    {t.savingsGoalTargetAmountOptional}
                  </Label>
                  <InfoHint ariaLabel={t.savingsGoalOpenAccumulationAria}>
                    {t.savingsGoalOpenAccumulationHint}
                  </InfoHint>
                  <InfoHint ariaLabel={t.savingsGoalTargetAmountAria}>
                    {t.savingsGoalTargetAmountHint}
                  </InfoHint>
                </div>
                <Input
                  id="sgm-target"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 tabular-nums"
                  value={form.targetAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, targetAmount: formatNumericInput(e.target.value) }))
                  }
                />
              </div>
            )}

            {!form.isInvestmentPortfolio ? (
              <div className="space-y-1.5">
                <Label htmlFor="sgm-current" className="text-sm">
                  {t.savingsGoalFieldCurrent}
                </Label>
                <Input
                  id="sgm-current"
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 tabular-nums"
                  value={form.currentAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, currentAmount: formatNumericInput(e.target.value) }))
                  }
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="sgm-monthly" className="text-sm">
                  {t.savingsGoalMonthlyDepositShort}
                </Label>
                <InfoHint ariaLabel={t.savingsGoalMonthlyDepositAria}>
                  {t.savingsGoalMonthlyDepositHint}
                </InfoHint>
              </div>
              <Input
                id="sgm-monthly"
                inputMode="decimal"
                dir="ltr"
                className="h-11 tabular-nums"
                value={form.monthlyContribution}
                placeholder={t.savingsGoalMonthlyPlaceholderOptional}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    monthlyContribution: formatNumericInput(e.target.value),
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="sgm-compass-pri" className="text-sm">
                  {t.savingsGoalCompassPriorityLabel}
                </Label>
                <InfoHint ariaLabel={t.savingsGoalCompassPriorityAria}>
                  {t.savingsGoalCompassPriorityHint}
                </InfoHint>
              </div>
              <Select
                value={compassSelectValue}
                onValueChange={(v) => {
                  if (v === COMPASS_UNSET) return;
                  setForm((f) => ({ ...f, compassPriority: v }));
                }}
              >
                <SelectTrigger id="sgm-compass-pri" className="h-11" aria-label={t.savingsGoalCompassPriorityLabel}>
                  <SelectValue placeholder={t.savingsGoalPriorityPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={COMPASS_UNSET} disabled>
                    <SelectItemText>{t.savingsGoalPriorityPlaceholder}</SelectItemText>
                  </SelectItem>
                  {COMPASS_RANKS.map((n) => {
                    const taken = priorityOwnerByRank.has(n);
                    const isSelf = editingSelfCompassRank === n;
                    const disabled = taken && !isSelf;
                    const ownerName = priorityOwnerByRank.get(n) ?? "";
                    const title = disabled
                      ? t.savingsGoalPriorityTakenByGoal.replace("{{name}}", ownerName)
                      : undefined;
                    return (
                      <SelectItem
                        key={n}
                        value={String(n)}
                        disabled={disabled}
                        title={title}
                      >
                        <SelectItemText>{String(n)}</SelectItemText>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sgm-holding" className="text-sm">
                {t.savingsGoalFieldHoldingType}
              </Label>
              {assetTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.savingsGoalNoAssetTypesHint}</p>
              ) : (
                <Select
                  value={holdingSelectValue}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      holdingAssetType: v === HOLDING_SELECT_NONE ? "" : v,
                    }))
                  }
                >
                  <SelectTrigger id="sgm-holding" className="h-11" aria-label={t.savingsGoalFieldHoldingType}>
                    <SelectValue placeholder={t.savingsGoalHoldingUnspecified}>
                      {holdingSelectDisplay}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HOLDING_SELECT_NONE}>
                      <SelectItemText>{t.savingsGoalHoldingUnspecified}</SelectItemText>
                    </SelectItem>
                    {holdingSelectValue !== HOLDING_SELECT_NONE &&
                    !assetTypes.some((a) => a.id === holdingSelectValue) ? (
                      <SelectItem value={holdingSelectValue}>
                        <SelectItemText>{holdingSelectValue}</SelectItemText>
                      </SelectItem>
                    ) : null}
                    {assetTypes.map((at) => (
                      <SelectItem key={at.id} value={at.id}>
                        <SelectItemText>
                          {localizedAssetTypeName(at.id, at.name, lang)}
                        </SelectItemText>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <DatePickerField
              id="sgm-target-date"
              label={t.savingsGoalFieldTargetDate}
              value={form.targetDate}
              onChange={(iso) => setForm((f) => ({ ...f, targetDate: iso ?? "" }))}
            />

            <div className="space-y-2">
              <Label className="text-sm">{t.pickIcon}</Label>
              <IconPicker value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sgm-color" className="text-sm">
                {t.savingsGoalFieldColor}
              </Label>
              <Input
                id="sgm-color"
                type="color"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="h-11 w-full max-w-[5.5rem] cursor-pointer px-2"
                aria-label={t.savingsGoalFieldColor}
              />
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 border-t border-border/50 px-5 py-4">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => setDialogOpen(false)}>
              {t.savingsGoalCancel}
            </Button>
            <Button type="button" className="flex-1 sm:flex-none" onClick={() => void submit()} disabled={saving}>
              {saving ? "…" : t.savingsGoalSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.savingsGoalDeleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.savingsGoalDeleteDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.savingsGoalCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t.savingsGoalDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
