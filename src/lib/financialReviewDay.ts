/**
 * Calendar day in `year`/`monthIndex` (0–11) when the review reminder should fire.
 * If `reviewDay` is 31 but the month has 30 days, returns 30 (last valid day).
 */
export function effectiveReviewCalendarDay(
  reviewDay: number,
  year: number,
  monthIndex: number,
): number {
  const d = Math.floor(Number(reviewDay));
  if (d < 1) return 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(d, daysInMonth);
}

/**
 * True when today is the effective review day: `review_day` clamped to this month's length
 * (e.g. 31 → 30 in April, 28 in February in non-leap years).
 */
export function isFinancialReviewDayToday(reviewDay: number | null | undefined): boolean {
  if (reviewDay == null || !Number.isFinite(reviewDay)) return false;
  const d = Math.floor(Number(reviewDay));
  if (d < 1 || d > 31) return false;
  const now = new Date();
  const target = effectiveReviewCalendarDay(d, now.getFullYear(), now.getMonth());
  return now.getDate() === target;
}

export function dismissStorageKey(ymd: string): string {
  return `expandy-fr-banner-dismiss-${ymd}`;
}

/** Local calendar YYYY-MM-DD for one dismiss per calendar day. */
export function todayYmdLocal(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
