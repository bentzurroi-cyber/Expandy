/** שערי המרה לשקל — Frankfurter עם נפילה לשערים סטטיים */

const STATIC_RATES_TO_ILS: Record<string, number> = {
  ILS: 1,
  USD: 3.6,
  EUR: 4.0,
};

const rateCache = new Map<string, number>();
const inflight = new Map<string, Promise<number>>();

function normalizeDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return iso.slice(0, 10);
}

function cacheKey(date: string, currency: string): string {
  return `${normalizeDate(date)}|${currency}`;
}

function staticRate(currency: string): number {
  return STATIC_RATES_TO_ILS[currency] ?? 1;
}

async function fetchFrankfurterRate(
  from: string,
  date: string,
): Promise<number> {
  const d = normalizeDate(date);
  const url = `https://api.frankfurter.app/${d}?from=${encodeURIComponent(from)}&to=ILS`;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates?: { ILS?: number } };
    const ils = data.rates?.ILS;
    if (typeof ils !== "number" || !Number.isFinite(ils)) {
      throw new Error("missing ILS rate");
    }
    return ils;
  } finally {
    window.clearTimeout(t);
  }
}

async function resolveRate(currency: string, date: string): Promise<number> {
  if (currency === "ILS") return 1;
  if (!/^[A-Z]{3}$/.test(currency)) {
    return staticRate(currency);
  }
  const key = cacheKey(date, currency);
  const hit = rateCache.get(key);
  if (hit != null) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const r = await fetchFrankfurterRate(currency, date);
      rateCache.set(key, r);
      return r;
    } catch {
      const fallback = staticRate(currency);
      rateCache.set(key, fallback);
      return fallback;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * טוען שערים לזוגות (תאריך, מטבע) — לשימוש מ-FxProvider.
 * מדלג על מטבעות מותאמים אישית (לא ISO של 3 אותיות).
 */
export async function warmupFxRates(
  pairs: ReadonlyArray<{ date: string; currency: string }>,
): Promise<void> {
  const uniq = new Map<string, { date: string; currency: string }>();
  for (const p of pairs) {
    if (!p.currency || p.currency === "ILS") continue;
    const key = cacheKey(p.date, p.currency);
    if (rateCache.has(key)) continue;
    uniq.set(key, p);
  }
  await Promise.all(
    [...uniq.values()].map((p) => resolveRate(p.currency, p.date)),
  );
}

export function getFxRateSync(currency: string, date: string): number {
  if (!currency || currency === "ILS") return 1;
  const key = cacheKey(date, currency);
  return rateCache.get(key) ?? staticRate(currency);
}

export function convertToILS(
  amount: number,
  currency: string,
  date: string,
): number {
  return amount * getFxRateSync(currency, date);
}
