/**
 * All app data keys (localStorage) except theme — used for "clear all" and bulk removal.
 * Theme stays so the UI does not flash or reset appearance.
 */
export const EXPANDY_APP_DATA_STORAGE_KEYS = [
  "expandy-expenses-v1",
  "expandy-income-sources-v1",
  "expandy-income-category-overrides-v1",
  "expandy-destination-accounts-v1",
  "expandy-expense-categories-v1",
  "expandy-expense-category-overrides-v1",
  "expandy-recurring-income-skips-v1",
  "expandy-currencies-v1",
  "expandy-payment-methods-v1",
  "expandy-assets-v1",
  "expandy-asset-name-presets-v1",
  "expandy-asset-types-v1",
  "expandy-category-budgets-v1",
  "expandy-deleted-builtin-expense-cats-v1",
  "expandy-deleted-builtin-income-cats-v1",
  "expandy-quick-access-count-v1",
] as const;

export function removeExpandyAppDataKeys(): void {
  for (const key of EXPANDY_APP_DATA_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
