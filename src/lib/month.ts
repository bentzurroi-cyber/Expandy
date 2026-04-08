/** YYYY-MM */
export type YearMonth = `${number}-${number}`;

export function formatYearMonth(d: Date): YearMonth {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}` as YearMonth;
}

export function parseYearMonth(key: YearMonth): { y: number; m: number } {
  const [ys, ms] = key.split("-");
  return { y: Number(ys), m: Number(ms) };
}

/** Previous calendar month (e.g. 2026-03 → 2026-02). */
export function previousYearMonth(ym: YearMonth): YearMonth {
  const { y, m } = parseYearMonth(ym);
  const d = new Date(y, m - 2, 1);
  return formatYearMonth(d);
}

/** תווית עברית לחודש, למשל "מרץ 2026" */
export function hebrewMonthYearLabel(key: YearMonth): string {
  const { y, m } = parseYearMonth(key);
  const names = [
    "ינואר",
    "פברואר",
    "מרץ",
    "אפריל",
    "מאי",
    "יוני",
    "יולי",
    "אוגוסט",
    "ספטמבר",
    "אוקטובר",
    "נובמבר",
    "דצמבר",
  ];
  const name = names[m - 1] ?? String(m);
  return `${name} ${y}`;
}

export function collectYearMonthsFromExpenses(dates: string[]): YearMonth[] {
  const set = new Set<YearMonth>();
  for (const d of dates) {
    if (d.length >= 7) set.add(d.slice(0, 7) as YearMonth);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

/** YYYY-MM-DD לפי אזור הזמן המקומי */
export function formatLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Today's calendar day projected into `ym`, clamped to that month's length.
 * Keeps month-close ledger lines in the **closed** month (reviewMonth), not the current calendar month.
 */
export function isoDateInYearMonth(ym: YearMonth, ref: Date = new Date()): string {
  const { y, m } = parseYearMonth(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(ref.getDate(), lastDay);
  return `${ym}-${String(day).padStart(2, "0")}`;
}

/** YYYY-MM-DD מקומי — לבחירת תאריך בלוח שנה */
export function parseLocalIsoDate(iso: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** n חודשים אחרונים כולל החודש הנוכחי (סדר כרונולוגי מהישן לחדש) */
export function lastNYearMonths(n: number, from: Date = new Date()): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(from.getFullYear(), from.getMonth() - i, 1);
    out.push(formatYearMonth(x));
  }
  return out;
}

export const ALL_TIME_EXPORT = "__all_time__";

/** תווית קצרה לציר X, למשל 03/26 */
export function monthYearShort(ym: YearMonth): string {
  const [y, m] = ym.split("-");
  return `${m}/${y.slice(2)}`;
}

export function addMonthsToIsoDate(iso: string, offset: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1 + offset, d ?? 1);
  return formatLocalIsoDate(date);
}
