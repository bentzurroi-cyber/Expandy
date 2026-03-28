import type { Category, EntryType } from "@/data/mock";
import { MOCK_CATEGORIES, MOCK_INCOME_SOURCES } from "@/data/mock";

/**
 * Resolves label + icon for a transaction row. Falls back to built-in mock lists
 * when the id was removed from the user's list (e.g. deleted default income source).
 */
export function resolveTransactionCategory(
  categoryId: string,
  type: EntryType,
  expenseCategories: Category[],
  incomeSources: Category[],
): Category | null {
  const primary = type === "income" ? incomeSources : expenseCategories;
  const mockFallback = type === "income" ? MOCK_INCOME_SOURCES : MOCK_CATEGORIES;
  const cross = type === "income" ? expenseCategories : incomeSources;

  const fromPrimary = primary.find((c) => c.id === categoryId);
  if (fromPrimary) return fromPrimary;

  const fromMock = mockFallback.find((c) => c.id === categoryId);
  if (fromMock) return fromMock;

  const fromCross = cross.find((c) => c.id === categoryId);
  return fromCross ?? null;
}
