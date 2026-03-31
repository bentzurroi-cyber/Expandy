import type { Category, EntryType } from "@/data/mock";
import { MOCK_CATEGORIES, MOCK_INCOME_SOURCES } from "@/data/mock";

/**
 * Resolves label + icon for a transaction row. Falls back to built-in mock lists
 * when the id was removed from the user's list (e.g. deleted default income source).
 */
export function resolveTransactionCategory(
  categoryId: unknown,
  type: unknown,
  expenseCategories: Category[],
  incomeSources: Category[],
): Category | null {
  const id = typeof categoryId === "string" ? categoryId : "";
  const resolvedType: EntryType = type === "income" ? "income" : "expense";
  const primary = resolvedType === "income" ? incomeSources : expenseCategories;
  const mockFallback = resolvedType === "income" ? MOCK_INCOME_SOURCES : MOCK_CATEGORIES;
  const cross = resolvedType === "income" ? expenseCategories : incomeSources;

  const fromPrimary = primary.find((c) => c.id === id);
  if (fromPrimary) return fromPrimary;

  const fromMock = mockFallback.find((c) => c.id === id);
  if (fromMock) return fromMock;

  const fromCross = cross.find((c) => c.id === id);
  return fromCross ?? null;
}
