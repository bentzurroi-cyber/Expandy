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
] as const;

export function pickRandomImportCategoryColor(): string {
  const pool = IMPORT_CATEGORY_COLOR_POOL;
  return pool[Math.floor(Math.random() * pool.length)] ?? "#14b8a6";
}
