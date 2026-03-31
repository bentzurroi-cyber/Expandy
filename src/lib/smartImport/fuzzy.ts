import { normalizeOptionName } from "@/lib/normalize";

/** Normalized Levenshtein similarity in [0, 1]. */
export function stringSimilarity(a: string, b: string): number {
  const s = normalizeOptionName(a);
  const t = normalizeOptionName(b);
  if (!s.length && !t.length) return 1;
  if (!s.length || !t.length) return 0;
  const d = levenshtein(s, t);
  const maxLen = Math.max(s.length, t.length);
  return 1 - d / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cur = dp[j]!;
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        const next = Math.min(prev + 1, dp[j]! + 1, dp[j - 1]! + 1);
        dp[j] = next;
      }
      prev = cur;
    }
  }
  return dp[n]!;
}

export type FuzzyCandidate = { id: string; label: string };

/**
 * Best match by exact normalized name, then substring, then similarity ≥ threshold.
 */
export function fuzzyMatchId(
  raw: string,
  candidates: FuzzyCandidate[],
  opts?: { threshold?: number },
): { id: string; kind: "exact" | "substring" | "similar" } | null {
  const threshold = opts?.threshold ?? 0.55;
  const n = normalizeOptionName(raw);
  if (!n) return null;

  for (const c of candidates) {
    if (normalizeOptionName(c.label) === n) return { id: c.id, kind: "exact" };
  }

  let bestSub: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const cn = normalizeOptionName(c.label);
    if (cn.includes(n) || n.includes(cn)) {
      const score = Math.min(n.length, cn.length) / Math.max(n.length, cn.length);
      if (!bestSub || score > bestSub.score) bestSub = { id: c.id, score };
    }
  }
  if (bestSub && bestSub.score >= 0.35) return { id: bestSub.id, kind: "substring" };

  let best: { id: string; sim: number } | null = null;
  for (const c of candidates) {
    const sim = stringSimilarity(raw, c.label);
    if (!best || sim > best.sim) best = { id: c.id, sim };
  }
  if (best && best.sim >= threshold) return { id: best.id, kind: "similar" };

  return null;
}
