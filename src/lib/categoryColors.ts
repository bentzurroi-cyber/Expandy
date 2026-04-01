/** Distinct palette for categories created from CSV import (Tailwind-aligned hex). */
export const IMPORT_CATEGORY_COLOR_POOL = [
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#eab308", // yellow-500
  "#f43f5e", // rose-500
  "#06b6d4", // cyan-500
  "#a855f7", // purple-500
  "#ef4444", // red-500
  "#10b981", // emerald-500
  "#84cc16", // lime-500
  "#f59e0b", // amber-500
  "#6366f1", // indigo-500
] as const;

export function pickRandomImportCategoryColor(): string {
  const pool = IMPORT_CATEGORY_COLOR_POOL;
  return pool[Math.floor(Math.random() * pool.length)] ?? "#14b8a6";
}

function hexToRgb(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return [r, g, b];
}

function colorDistance(a: string, b: string): number {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return 0;
  const dr = ar[0] - br[0];
  const dg = ar[1] - br[1];
  const db = ar[2] - br[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function pickDistinctImportCategoryColor(existingColors: string[]): string {
  const normalizedExisting = existingColors.map((c) => c.trim().toLowerCase());
  const available = IMPORT_CATEGORY_COLOR_POOL.filter(
    (c) => !normalizedExisting.includes(c.toLowerCase()),
  );
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)] ?? IMPORT_CATEGORY_COLOR_POOL[0];
  }
  // If pool is exhausted, pick the color farthest (on average) from current set.
  let best: string = IMPORT_CATEGORY_COLOR_POOL[0] ?? "#14b8a6";
  let bestScore = -1;
  for (const candidate of IMPORT_CATEGORY_COLOR_POOL) {
    const score =
      existingColors.length === 0
        ? 1
        : existingColors.reduce((sum, c) => sum + colorDistance(candidate, c), 0) /
          existingColors.length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
