import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Fingerprint, Info, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { useSavingsGoals } from "@/context/SavingsGoalsContext";
import { useAssets, type AssetTypeOption } from "@/context/AssetsContext";
import { useAuth } from "@/context/AuthContext";
import { useI18n, type Language } from "@/context/I18nContext";
import { localizedAssetTypeName } from "@/lib/defaultEntityLabels";
import { fireSavingsGoalConfetti } from "@/lib/goalConfetti";
import { formatIlsWholeCeil } from "@/lib/format";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { darkenHex6 } from "@/lib/savingsGoalUi";
import { cn } from "@/lib/utils";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import { toast } from "sonner";
import type { SavingsGoal } from "@/context/SavingsGoalsContext";

const LONG_PRESS_MS = 500;

function holdingTypeLabel(
  assetTypes: AssetTypeOption[],
  lang: Language,
  g: SavingsGoal,
  unspecified: string,
): string {
  const h = g.holdingAssetType.trim();
  if (!h) return unspecified;
  const opt = assetTypes.find((x) => x.id === h);
  return opt ? localizedAssetTypeName(opt.id, opt.name, lang) : h;
}

function GoalTooltipStatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-fit flex-col items-end gap-0.5 text-right" dir="rtl">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="inline-flex min-h-fit items-baseline justify-end gap-1 text-sm font-medium tabular-nums leading-snug text-foreground">
        {value}
      </span>
    </div>
  );
}

export function SavingsGoalsAssetsCollapsible() {
  const { t, dir, lang } = useI18n();
  const { profile } = useAuth();
  const { assetTypes } = useAssets();
  const { goals, loading, depositAmount, updateGoal } = useSavingsGoals();
  const [open, setOpen] = useState(true);
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const [depositingId, setDepositingId] = useState<string | null>(null);
  const [invDepositGoalId, setInvDepositGoalId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [amountByGoal, setAmountByGoal] = useState<Record<string, string>>({});
  const [customOpenByGoal, setCustomOpenByGoal] = useState<Record<string, boolean>>({});
  const longPressTimerRef = useRef<Record<string, number>>({});
  const skipNextClickRef = useRef<Record<string, boolean>>({});

  const householdOk = useMemo(
    () => isValidHouseholdCode(normalizeHouseholdCode(profile?.household_id ?? "")),
    [profile?.household_id],
  );

  useEffect(() => {
    if (!celebrateId) return;
    const tmr = window.setTimeout(() => setCelebrateId(null), 900);
    return () => window.clearTimeout(tmr);
  }, [celebrateId]);

  useEffect(() => {
    setAmountByGoal((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!goals.some((g) => g.id === id)) delete next[id];
      }
      return next;
    });
    setCustomOpenByGoal((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!goals.some((g) => g.id === id)) delete next[id];
      }
      return next;
    });
    setExpandedId((id) => (id && goals.some((g) => g.id === id) ? id : null));
  }, [goals]);

  const clearLongPress = useCallback((goalId: string) => {
    const tid = longPressTimerRef.current[goalId];
    if (tid != null) {
      window.clearTimeout(tid);
      delete longPressTimerRef.current[goalId];
    }
  }, []);

  const confirmInvTransfer = useCallback(async () => {
    const id = invDepositGoalId;
    if (!id) return;
    setInvDepositGoalId(null);
    const res = await updateGoal(id, { monthlyInvestmentTransferAck: true });
    if (res.ok) {
      void fireSavingsGoalConfetti();
      setCelebrateId(id);
    }
  }, [invDepositGoalId, updateGoal]);

  const openCustomAmount = useCallback((goalId: string, monthlyCeil: number) => {
    setCustomOpenByGoal((p) => ({ ...p, [goalId]: true }));
    setAmountByGoal((p) => ({
      ...p,
      [goalId]: formatNumericInput(String(Math.max(1, monthlyCeil))),
    }));
  }, []);

  const runDeposit = useCallback(
    async (id: string, amount: number) => {
      const g = goals.find((x) => x.id === id);
      if (!g) return;
      const add = Math.ceil(amount);
      if (!Number.isFinite(add) || add <= 0) {
        toast.error(t.savingsGoalDepositAmountInvalid);
        return;
      }
      setDepositingId(id);
      try {
        const res = await depositAmount(id, add);
        if (res.ok) {
          setCustomOpenByGoal((p) => ({ ...p, [id]: false }));
          setAmountByGoal((p) => {
            const next = { ...p };
            delete next[id];
            return next;
          });
          toast.success(t.savingsGoalDepositedToast);
          if (g.isInvestmentPortfolio) {
            setInvDepositGoalId(id);
            return;
          }
          if (res.reachedTarget) void fireSavingsGoalConfetti();
          setCelebrateId(id);
        } else if (res.error === "Invalid amount") {
          toast.error(t.savingsGoalDepositAmountInvalid);
        }
      } finally {
        setDepositingId(null);
      }
    },
    [depositAmount, goals, t],
  );

  const onDepositDefault = useCallback(
    async (id: string) => {
      const g = goals.find((x) => x.id === id);
      if (!g) return;
      if (g.monthlyMode === "surplus") {
        openCustomAmount(id, 1);
        return;
      }
      const add = Math.ceil(g.monthlyContribution);
      if (add <= 0) {
        toast.error(t.savingsGoalDepositDisabled);
        return;
      }
      await runDeposit(id, add);
    },
    [goals, openCustomAmount, runDeposit, t],
  );

  const onDepositCustom = useCallback(
    async (id: string) => {
      const raw = amountByGoal[id] ?? "";
      const parsed = parseNumericInput(raw);
      if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
        toast.error(t.savingsGoalDepositAmountInvalid);
        return;
      }
      await runDeposit(id, parsed);
    },
    [amountByGoal, runDeposit, t],
  );

  if (!householdOk) return null;

  return (
    <>
      <div
        className="rounded-2xl border border-border/25 bg-muted/[0.04] shadow-none backdrop-blur-[2px]"
        dir={dir}
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-6 py-5 text-start transition-colors hover:bg-muted/20"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <p className="text-base font-semibold tracking-tight">{t.savingsGoalsCollapseTitle}</p>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {open ? (
          <div className="border-t border-border/20 px-5 pb-8 pt-4 sm:px-8">
            {loading ? (
              <p className="py-6 text-sm text-muted-foreground">{t.savingsGoalsLoading}</p>
            ) : goals.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t.savingsGoalsEmptyAssetsHint}</p>
            ) : (
              <ul className="space-y-10 pt-6">
                {goals.map((g) => {
                  const rtl = dir === "rtl";
                  const accent = g.color;
                  const openTarget = g.targetMode === "open";
                  const surplusMonthly = g.monthlyMode === "surplus";
                  const customOpen = customOpenByGoal[g.id] === true;
                  const rawCustom = amountByGoal[g.id] ?? "";
                  const parsedCustom = parseNumericInput(rawCustom);
                  const previewAdd =
                    customOpen &&
                    parsedCustom != null &&
                    Number.isFinite(parsedCustom) &&
                    parsedCustom > 0
                      ? parsedCustom
                      : 0;
                  const effCur = g.currentAmount + previewAdd;
                  const effMonthly = g.monthlyCurrent + previewAdd;
                  // For open-ended goals we present cumulative total as opening balance + all month deposits.
                  const totalAccumulatedOpen = Math.round((g.currentAmount + effMonthly) * 100) / 100;
                  const target = g.targetAmount;
                  const mc = g.monthlyContribution;
                  const overallPctRaw =
                    !openTarget && target > 0 ? (effCur / target) * 100 : 0;
                  const overallPct = Math.min(100, Math.max(0, overallPctRaw));
                  const monthlyRatio =
                    !surplusMonthly && mc > 0
                      ? Math.min(1, Math.max(0, effMonthly / mc))
                      : 0;
                  const monthlyMet = !surplusMonthly && mc > 0 && effMonthly >= mc;
                  const transferAck =
                    g.isInvestmentPortfolio && g.monthlyInvestmentTransferAck;
                  const monthlyHighlight =
                    !surplusMonthly && mc > 0 && (monthlyMet || transferAck);
                  const monthlySegDark = darkenHex6(accent, 0.4);
                  const defaultDepositCeil = Math.max(0, Math.ceil(mc));
                  const pctDisplay =
                    !openTarget && target > 0
                      ? Math.min(100, Math.round((effCur / target) * 100))
                      : 0;
                  const overallComplete =
                    !openTarget && target > 0 && effCur >= target;
                  const expanded = expandedId === g.id;

                  const depositLabel = surplusMonthly
                    ? t.savingsGoalDepositSurplusMonthly
                    : defaultDepositCeil > 0
                      ? t.savingsGoalDepositWithAmount.replace(
                          "{{amount}}",
                          formatIlsWholeCeil(defaultDepositCeil),
                        )
                      : t.savingsGoalDepositConfirm;

                  const plannedTooltipValue = surplusMonthly
                    ? t.savingsGoalTooltipPlannedSurplus
                    : mc > 0
                      ? formatIlsWholeCeil(mc)
                      : t.savingsGoalTooltipPlannedNone;
                  const totalTooltipValue = openTarget ? (
                    <>
                      {formatIlsWholeCeil(totalAccumulatedOpen)}{" "}
                      <span className="font-medium text-muted-foreground">
                        ({t.savingsGoalTooltipOpenNoPct})
                      </span>
                    </>
                  ) : (
                    <>
                      {formatIlsWholeCeil(effCur)}{" "}
                      <span className="font-medium text-muted-foreground">({pctDisplay}%)</span>
                    </>
                  );
                  const holdingName = holdingTypeLabel(
                    assetTypes,
                    lang,
                    g,
                    t.savingsGoalHoldingUnspecified,
                  );

                  return (
                    <li
                      key={g.id}
                      className={cn(
                        "rounded-2xl border border-border/15 bg-muted/[0.02] px-5 py-6 pb-8 transition-colors sm:px-7 sm:py-8 sm:pb-10",
                        "hover:bg-muted/[0.28]",
                      )}
                    >
                      <div className="flex items-start gap-5 sm:gap-6">
                        <div
                          className={cn(
                            "relative flex shrink-0 items-center justify-center rounded-full transition-all duration-500",
                            overallComplete
                              ? "size-11 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 ring-2 ring-emerald-300/80 dark:from-emerald-500 dark:via-emerald-600 dark:to-teal-700 dark:ring-emerald-400/45"
                              : "size-9",
                          )}
                          style={
                            overallComplete
                              ? undefined
                              : {
                                  backgroundColor: `${accent}20`,
                                  color: accent,
                                }
                          }
                          aria-hidden
                        >
                          {overallComplete ? (
                            <Check
                              className="size-6 text-white drop-shadow-sm"
                              strokeWidth={2.75}
                            />
                          ) : (
                            <CategoryGlyph iconKey={g.icon} className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-5">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-start text-base font-semibold tracking-tight text-foreground hover:underline-offset-2"
                              onClick={() =>
                                setExpandedId((id) => (id === g.id ? null : g.id))
                              }
                            >
                              {g.name}
                            </button>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 items-center justify-center rounded-full p-1 text-muted-foreground outline-none ring-offset-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={t.savingsGoalStatsInfoAria}
                                >
                                  <Info className="size-4" aria-hidden />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                dir="rtl"
                                align="end"
                                side="bottom"
                                sideOffset={12}
                                className="z-[12000] w-[min(20rem,calc(100vw-2.5rem))] min-h-fit max-h-none overflow-visible border border-border/60 px-4 pb-4 pt-3 text-right shadow-lg"
                              >
                                <span className="flex min-h-fit flex-col gap-3">
                                  <GoalTooltipStatRow
                                    label={t.savingsGoalTooltipRowMonthSaved}
                                    value={formatIlsWholeCeil(effMonthly)}
                                  />
                                  <GoalTooltipStatRow
                                    label={t.savingsGoalTooltipRowPlanned}
                                    value={plannedTooltipValue}
                                  />
                                  {!openTarget ? (
                                    <GoalTooltipStatRow
                                      label={t.savingsGoalTooltipRowTotal}
                                      value={totalTooltipValue}
                                    />
                                  ) : null}
                                  <GoalTooltipStatRow
                                    label={t.savingsGoalTooltipRowHolding}
                                    value={<span className="break-words text-right">{holdingName}</span>}
                                  />
                                  {transferAck ? (
                                    <p className="border-t border-border/50 pt-2 text-right text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                      {t.savingsGoalTransferAckShort}
                                    </p>
                                  ) : null}
                                </span>
                              </PopoverContent>
                            </Popover>
                          </div>

                          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.08]">
                            {openTarget ? (
                              !surplusMonthly && mc > 0 ? (
                                <div
                                  className={cn(
                                    "absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width]",
                                    rtl ? "right-0" : "left-0",
                                    celebrateId === g.id
                                      ? "animate-savings-bar-pulse"
                                      : "animate-savings-bar-idle",
                                  )}
                                  style={{
                                    width: `${monthlyRatio * 100}%`,
                                    backgroundColor: monthlyHighlight
                                      ? "#10b981"
                                      : monthlySegDark,
                                  }}
                                >
                                  {monthlyHighlight ? (
                                    <Check
                                      className={cn(
                                        "text-white drop-shadow-sm",
                                        transferAck && !monthlyMet ? "size-3" : "size-2.5",
                                      )}
                                      strokeWidth={3}
                                      aria-hidden
                                    />
                                  ) : null}
                                </div>
                              ) : null
                            ) : (
                              <div
                                className={cn(
                                  "absolute inset-y-0 overflow-hidden rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width]",
                                  rtl ? "right-0" : "left-0",
                                  celebrateId === g.id
                                    ? "animate-savings-bar-pulse"
                                    : "animate-savings-bar-idle",
                                )}
                                style={{ width: `${overallPct}%` }}
                              >
                                <div
                                  className="absolute inset-0"
                                  style={{ backgroundColor: accent, opacity: 0.88 }}
                                  aria-hidden
                                />
                                {!overallComplete && !surplusMonthly && mc > 0 ? (
                                  <div
                                    className={cn(
                                      "absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                      rtl ? "right-0" : "left-0",
                                    )}
                                    style={{
                                      width: `${monthlyRatio * 100}%`,
                                      backgroundColor: monthlyHighlight
                                        ? "#10b981"
                                        : monthlySegDark,
                                    }}
                                  >
                                    {monthlyHighlight ? (
                                      <Check
                                        className={cn(
                                          "text-white drop-shadow-sm",
                                          transferAck && !monthlyMet ? "size-3" : "size-2.5",
                                        )}
                                        strokeWidth={3}
                                        aria-hidden
                                      />
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          {expanded ? (
                            <div className="space-y-1.5 text-xs tabular-nums leading-relaxed text-muted-foreground">
                              {openTarget ? (
                                <p>
                                  <span className="text-foreground/85">{t.savingsGoalTargetModeOpen}</span>
                                  {": "}
                                  {formatIlsWholeCeil(totalAccumulatedOpen)}
                                </p>
                              ) : overallComplete ? (
                                <p>
                                  {t.savingsGoalCardFootlineGoalComplete
                                    .replace("{{totCur}}", formatIlsWholeCeil(effCur))
                                    .replace("{{totTot}}", formatIlsWholeCeil(target))
                                    .replace("{{pct}}", String(pctDisplay))}
                                </p>
                              ) : surplusMonthly ? (
                                <p>
                                  <span className="text-foreground/85">{t.savingsGoalMonthlyModeSurplus}</span>
                                  {" · "}
                                  <span className="text-foreground/85">{t.savingsGoalMonthActualLabel}</span>{" "}
                                  {formatIlsWholeCeil(effMonthly)}
                                </p>
                              ) : mc > 0 ? (
                                <>
                                  <p>
                                    <span className="text-foreground/85">{t.savingsGoalMonthActualLabel}</span>{" "}
                                    {formatIlsWholeCeil(effMonthly)}
                                    <span className="mx-2 opacity-40">·</span>
                                    <span className="text-foreground/85">{t.savingsGoalMonthPlannedLabel}</span>{" "}
                                    {formatIlsWholeCeil(mc)}
                                  </p>
                                  <p>
                                    <span className="text-foreground/85">{t.savingsGoalTotalTowardGoal}</span>{" "}
                                    {formatIlsWholeCeil(effCur)} / {formatIlsWholeCeil(target)}
                                    <span className="ms-1 opacity-70">({pctDisplay}%)</span>
                                  </p>
                                </>
                              ) : (
                                <p>
                                  {t.savingsGoalCardFootlineTotalOnly
                                    .replace("{{totCur}}", formatIlsWholeCeil(effCur))
                                    .replace("{{totTot}}", formatIlsWholeCeil(target))
                                    .replace("{{pct}}", String(pctDisplay))}
                                </p>
                              )}
                              <p>
                                <span className="text-foreground/85">{t.savingsGoalFieldHoldingType}</span>
                                {": "}
                                {holdingTypeLabel(assetTypes, lang, g, t.savingsGoalHoldingUnspecified)}
                              </p>
                              {transferAck ? (
                                <p className="font-medium text-emerald-600 dark:text-emerald-400">
                                  {t.savingsGoalTransferAckShort}
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          {!overallComplete ? (
                            <div className="pt-2">
                              {!customOpen ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="inline-flex h-11 w-full max-w-full items-center justify-center gap-2.5 rounded-xl px-4 text-sm font-medium"
                                  disabled={depositingId === g.id}
                                  title={t.savingsGoalDepositHoldCustomHint}
                                  aria-label={`${depositLabel}. ${t.savingsGoalDepositHoldCustomHint}. ${t.savingsGoalDepositLongPressAria}`}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    clearLongPress(g.id);
                                    longPressTimerRef.current[g.id] = window.setTimeout(() => {
                                      delete longPressTimerRef.current[g.id];
                                      skipNextClickRef.current[g.id] = true;
                                      openCustomAmount(g.id, defaultDepositCeil);
                                    }, LONG_PRESS_MS);
                                  }}
                                  onPointerUp={() => clearLongPress(g.id)}
                                  onPointerLeave={() => clearLongPress(g.id)}
                                  onPointerCancel={() => clearLongPress(g.id)}
                                  onContextMenu={(e) => e.preventDefault()}
                                  onClick={() => {
                                    if (skipNextClickRef.current[g.id]) {
                                      delete skipNextClickRef.current[g.id];
                                      return;
                                    }
                                    void onDepositDefault(g.id);
                                  }}
                                >
                                  <span className="min-w-0 flex-1 truncate text-center">{depositLabel}</span>
                                  <Fingerprint className="size-4 shrink-0 opacity-80" aria-hidden />
                                </Button>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    dir="ltr"
                                    className="h-9 min-w-[7rem] flex-1 tabular-nums"
                                    value={rawCustom}
                                    onChange={(e) =>
                                      setAmountByGoal((p) => ({
                                        ...p,
                                        [g.id]: formatNumericInput(e.target.value),
                                      }))
                                    }
                                    aria-label={t.savingsGoalDepositAmountLabel}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 shrink-0 gap-1"
                                    disabled={depositingId === g.id}
                                    onClick={() => void onDepositCustom(g.id)}
                                  >
                                    <Check className="size-3.5" aria-hidden />
                                    {t.savingsGoalDepositConfirm}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-9 shrink-0 text-muted-foreground"
                                    aria-label={t.cancel}
                                    onClick={() => {
                                      setCustomOpenByGoal((p) => ({ ...p, [g.id]: false }));
                                      setAmountByGoal((p) => {
                                        const next = { ...p };
                                        delete next[g.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={invDepositGoalId != null}
        onOpenChange={(o) => {
          if (!o) setInvDepositGoalId(null);
        }}
      >
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.savingsGoalInvestmentTransferTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.savingsGoalInvestmentTransferDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t.savingsGoalInvestmentTransferNo}</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => void confirmInvTransfer()}>
              {t.savingsGoalInvestmentTransferYes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
