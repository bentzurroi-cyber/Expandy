/** שערי המרה לשקל — Frankfurter (HTTPS) עם נפילה לשערים סטטיים */

const STATIC_RATES_TO_ILS: Record<string, number> = {
  ILS: 1,
  USD: 3.65,
  EUR: 3.95,
  GBP: 4.6,
  CHF: 4.1,
  JPY: 0.024,
};

const FRANKFURTER_URLS = [
  (d: string, from: string) =>
    `https://api.frankfurter.dev/v1/${d}?from=${encodeURIComponent(from)}&to=ILS`,
  (d: string, from: string) =>
    `https://api.frankfurter.app/v1/${d}?from=${encodeURIComponent(from)}&to=ILS`,
  (d: string, from: string) =>
    `https://api.frankfurter.app/${d}?from=${encodeURIComponent(from)}&to=ILS`,
] as const;

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

async function fetchFrankfurterRateOnce(url: string, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, {
    signal,
    method: "GET",
    mode: "cors",
    credentials: "omit",
    redirect: "follow",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("invalid JSON");
  }
  const ils = (data as { rates?: { ILS?: number } })?.rates?.ILS;
  if (typeof ils !== "number" || !Number.isFinite(ils) || ils <= 0) {
    throw new Error("missing ILS rate");
  }
  return ils;
}

async function fetchFrankfurterRate(from: string, date: string): Promise<number> {
  const d = normalizeDate(date);
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    let lastErr: unknown = null;
    for (const buildUrl of FRANKFURTER_URLS) {
      try {
        return await fetchFrankfurterRateOnce(buildUrl(d, from), ctrl.signal);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    window.clearTimeout(t);
  }
}

/** Loads the ILS rate for an ISO currency on a given date into the cache (Frankfurter + static fallback). */
export async function prefetchFxRate(currency: string, date: string): Promise<number> {
  try {
    return await resolveRate(currency, normalizeDate(date));
  } catch {
    return staticRate(currency);
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
  try {
    const uniq = new Map<string, { date: string; currency: string }>();
    for (const p of pairs) {
      if (!p.currency || p.currency === "ILS") continue;
      const key = cacheKey(p.date, p.currency);
      if (rateCache.has(key)) continue;
      uniq.set(key, p);
    }
    await Promise.all(
      [...uniq.values()].map((p) =>
        resolveRate(p.currency, p.date).catch(() => staticRate(p.currency)),
      ),
    );
  } catch {
    /* כל זוג ייפול בנפרד ל-static דרך resolveRate */
  }
}

export function getFxRateSync(currency: string, date: string): number {
  try {
    if (!currency || currency === "ILS") return 1;
    const key = cacheKey(date, currency);
    return rateCache.get(key) ?? staticRate(currency);
  } catch {
    return staticRate(currency);
  }
}

export function convertToILS(
  amount: number,
  currency: string,
  date: string,
): number {
  try {
    const n = Number(amount);
    if (!Number.isFinite(n)) return 0;
    return n * getFxRateSync(currency, date);
  } catch {
    return 0;
  }
}
