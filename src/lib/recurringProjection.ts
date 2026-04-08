import type { Expense } from "@/data/mock";
import { projectedRecurringId } from "@/lib/expenseIds";

function clampDayForMonth(year: number, month1to12: number, day: number): number {
  const last = new Date(year, month1to12, 0).getDate();
  return Math.max(1, Math.min(last, day));
}

/** Valid rows for projection + listing (same guards as History). */
function validExpensesForProjection(expenses: Expense[]): Expense[] {
  return expenses.filter(
    (e) =>
      e &&
      typeof e.id === "string" &&
      typeof e.date === "string" &&
      typeof e.categoryId === "string" &&
      typeof e.paymentMethodId === "string" &&
      typeof e.amount === "number" &&
      Number.isFinite(e.amount),
  );
}

export type MergeProjectedRecurringOptions =
  | {
      mode: "explicitMonths";
      /** YYYY-MM list to materialize into (e.g. one month, or 12 months of a year). */
      months: string[];
      /** First day of this month is the horizon anchor (matches History). */
      viewAnchorYm: string;
      /** When true, skip months more than 12 months after the anchor (ALL_TIME only). */
      capHorizonFromAnchor: boolean;
    }
  | {
      mode: "monthsFromData";
      /** Derive target months from existing row dates only (History “all time”). */
      viewAnchorYm: string;
      capHorizonFromAnchor: boolean;
    };

/**
 * Expenses array + virtual projected recurring instances (same rules as History).
 * Does not mutate global state — safe for synchronous dashboard summaries.
 */
export function mergeProjectedRecurringExpenses(
  expenses: Expense[],
  recurringIncomeSkips: Record<string, string[]>,
  options: MergeProjectedRecurringOptions,
): Expense[] {
  const valid = validExpensesForProjection(expenses);
  const out = [...valid];
  const ids = new Set(out.map((e) => e.id));
  const templates = valid.filter((e) => e.recurringMonthly === true);

  const [vy, vm] = options.viewAnchorYm.split("-").map(Number);
  const viewDate =
    Number.isFinite(vy) && Number.isFinite(vm)
      ? new Date(vy, vm - 1, 1)
      : new Date();

  const targetYms: string[] =
    options.mode === "explicitMonths"
      ? options.months
      : [...new Set(valid.map((e) => e.date.slice(0, 7)))];

  for (const tmpl of templates) {
    const baseYm = tmpl.date.slice(0, 7);
    const [by, bm] = baseYm.split("-").map(Number);
    if (!Number.isFinite(by) || !Number.isFinite(bm)) continue;
    const baseDate = new Date(by, bm - 1, 1);
    for (const ym of targetYms) {
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const [ty, tm] = ym.split("-").map(Number);
      const targetDate = new Date(ty, tm - 1, 1);
      const monthsFromBase =
        (targetDate.getFullYear() - baseDate.getFullYear()) * 12 +
        (targetDate.getMonth() - baseDate.getMonth());
      const monthsFromView =
        (targetDate.getFullYear() - viewDate.getFullYear()) * 12 +
        (targetDate.getMonth() - viewDate.getMonth());
      if (monthsFromBase < 0) continue;
      if (options.capHorizonFromAnchor && monthsFromView > 12) continue;
      if (ym === baseYm) continue;
      const skips = new Set(recurringIncomeSkips[tmpl.id] ?? []);
      if (skips.has(ym)) continue;
      const id = projectedRecurringId(tmpl.id, ym);
      if (ids.has(id)) continue;
      const srcDay = Number(tmpl.date.slice(8, 10)) || 1;
      const safeDay = clampDayForMonth(ty, tm, srcDay);
      const noteTrim = typeof tmpl.note === "string" ? tmpl.note.trim() : "";
      out.push({
        ...tmpl,
        id,
        date: `${ym}-${String(safeDay).padStart(2, "0")}`,
        recurringMonthly: false,
        installments: 1,
        installmentIndex: 1,
        note: noteTrim,
      });
      ids.add(id);
    }
  }
  return out;
}
