import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import {
  fetchFinancialReviewSnapshots,
  isMonthlySnapshotV2,
  type FinancialReviewSnapshotRow,
} from "@/lib/financialReviewSnapshot";
import { formatIlsWholeCeil } from "@/lib/format";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { hebrewMonthYearLabel, type YearMonth } from "@/lib/month";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FinancialReviewArchivePanel() {
  const { profile } = useAuth();
  const { t, dir, lang } = useI18n();
  const [rows, setRows] = useState<FinancialReviewSnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYm, setSelectedYm] = useState<YearMonth | "">("");

  const householdId = useMemo(
    () => normalizeHouseholdCode(profile?.household_id ?? ""),
    [profile?.household_id],
  );

  const load = useCallback(async () => {
    if (!isValidHouseholdCode(householdId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await fetchFinancialReviewSnapshots(householdId);
    setRows(list);
    setSelectedYm((prev) => {
      if (prev && list.some((r) => r.review_month === prev)) return prev;
      return list[0]?.review_month ?? "";
    });
    setLoading(false);
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => rows.find((r) => r.review_month === selectedYm) ?? null,
    [rows, selectedYm],
  );

  const p = selected?.payload;
  const advice =
    lang === "he" ? p?.adviceHe ?? "" : p?.adviceEn ?? p?.adviceHe ?? "";

  const incomeCeil = p ? Math.ceil(p.incomeIls) : 0;
  const expenseCeil = p ? Math.ceil(p.expenseIls) : 0;
  const barMax = Math.max(incomeCeil, expenseCeil, 1);
  const incomeBarPct = incomeCeil > 0 ? Math.min(100, (incomeCeil / barMax) * 100) : 0;
  const expenseBarPct = expenseCeil > 0 ? Math.min(100, (expenseCeil / barMax) * 100) : 0;

  const v2 = p && isMonthlySnapshotV2(p) ? p : null;

  if (!isValidHouseholdCode(householdId)) return null;

  if (loading) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground" dir={dir}>
        {lang === "he" ? "טוען…" : "Loading…"}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-16 text-center text-sm leading-relaxed text-muted-foreground" dir={dir}>
        {t.historyReviewsEmpty}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-10 py-2" dir={dir}>
      <div className="space-y-2">
        <Label htmlFor="fr-archive-month" className="text-xs font-medium text-muted-foreground">
          {t.historyReviewsSelectMonth}
        </Label>
        <Select value={selectedYm} onValueChange={(v) => setSelectedYm(v as YearMonth)}>
          <SelectTrigger id="fr-archive-month" className="h-11 rounded-2xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {rows.map((r) => {
              const label =
                lang === "he" ? hebrewMonthYearLabel(r.review_month) : r.review_month;
              return (
                <SelectItem key={r.id} value={r.review_month} textValue={label}>
                  <SelectItemText>{label}</SelectItemText>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {p ? (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">{t.financialReviewArchiveTitle}</h3>
            <p className="text-xs text-muted-foreground">
              {t.financialReviewArchiveClosedAt}{" "}
              <span className="tabular-nums text-foreground/80">
                {new Date(p.closedAt).toLocaleString(lang === "he" ? "he-IL" : "en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </p>
          </div>

          <div className="rounded-3xl border border-border/40 bg-gradient-to-b from-muted/25 to-background px-5 py-7">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t.financialReviewBalanceCardTitle}
            </p>
            <div className="mt-6 space-y-5">
              {incomeCeil <= 0 ? (
                <p className="text-sm text-muted-foreground">{t.financialReviewNoIncomeNote}</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t.financialReviewChartIncome}</span>
                    <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatIlsWholeCeil(p.incomeIls)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full bg-emerald-500/75"
                      style={{ width: `${incomeBarPct}%` }}
                    />
                  </div>
                  {v2 != null && v2.incomeManualOverrideIls != null ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t.financialReviewArchiveManualIncomeNote
                        .replace(
                          "{{fromTx}}",
                          formatIlsWholeCeil(v2.incomeFromTransactionsIls ?? 0),
                        )
                        .replace("{{final}}", formatIlsWholeCeil(v2.incomeIls))}
                    </p>
                  ) : null}
                </div>
              )}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.financialReviewChartExpense}</span>
                  <span className="tabular-nums text-rose-700/90 dark:text-rose-400">
                    {formatIlsWholeCeil(p.expenseIls)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-rose-400/75"
                    style={{ width: `${expenseBarPct}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 border-t border-border/30 pt-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.summaryNet}</p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold tabular-nums",
                  p.incomeIls - p.expenseIls >= 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-700/90 dark:text-rose-400",
                )}
              >
                {formatIlsWholeCeil(p.incomeIls - p.expenseIls)}
              </p>
            </div>
          </div>

          {v2 && v2.topExpenseCategories.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t.financialReviewArchiveTopExpenseTitle}
              </p>
              <ul className="flex flex-col gap-3">
                {v2.topExpenseCategories.map((c, idx) => (
                  <li
                    key={`${c.categoryId}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 px-3 py-3"
                  >
                    <span className="text-xs text-muted-foreground">{idx + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-rose-800/85 dark:text-rose-300/90">
                      {formatIlsWholeCeil(c.amountIls)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {advice ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{advice}</p>
          ) : null}

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t.financialReviewStepAssets}
            </p>
            <ul className="flex flex-col gap-3">
              {p.assets.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.type}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground" dir="ltr">
                    {a.currency === "ILS"
                      ? formatIlsWholeCeil(a.balance)
                      : `${a.balance} ${a.currency}`}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {v2 && v2.savingsGoalsStatus.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t.financialReviewArchiveGoalsTitle}
              </p>
              <ul className="flex flex-col gap-3">
                {v2.savingsGoalsStatus.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-2xl border border-border/40 px-4 py-3 text-sm"
                  >
                    <p className="font-medium text-foreground">{g.name}</p>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {t.savingsGoalFieldCurrent}: {formatIlsWholeCeil(g.currentAmount)} /{" "}
                      {formatIlsWholeCeil(g.targetAmount)} · {t.savingsGoalMonthlyBarCaption}{" "}
                      {formatIlsWholeCeil(g.monthlyCurrent)} / {formatIlsWholeCeil(g.monthlyContribution)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
